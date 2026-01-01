import logging
from backend.generators import anthtropic_stream
import backend.utils as utils
import backend.config as config
import ollama

from functools import lru_cache
from typing import Annotated, Any, AsyncGenerator, Callable, Dict, List, Union
from typing import Optional
from fastapi import Depends, FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.dependencies import get_llama_streamer, get_ollama_streamer

from google import genai
from google.genai.errors import APIError
from openai import OpenAI, APIError
from anthropic import Anthropic 

from fastapi.middleware.cors import CORSMiddleware
from backend.constants import SYSTEM_PROMPT, SYSTEM_PROMPT_FOR_SNIPPETS

@lru_cache
def get_settings():
    return config.Settings()

client = None
settings = get_settings()

async def init_ollama_client(url: str):
    try:
        client = ollama.AsyncClient(host=url)
        await client.list()
        return client
    except Exception as e:
        logging.error(f"Failed to initialize Ollama client: {e}")
        client = None
        return client

app = FastAPI(
    title="Ollama Code Analysis API",
    description="An API endpoint to analyze code snippets using the Ollama LLM.",
    version="1.0.0",
)

origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  
    allow_credentials=True,  
    allow_methods=["*"],  
    allow_headers=["*"],  
)


class CodeAnalysisRequest(BaseModel):
    code: str = Field(..., description="The code snippet to be analyzed.")
    context: Optional[str] = Field(
        None, description="Optional context about the code's purpose."
    )

class APIKey(BaseModel):
    key: str = Field("", description="The encrypted key.")
    model_id: str = Field("", description="The model related to the key.")
    url: Optional[str] = Field("", description="Optional URL (only for local providers)")

class APIKeyPayload(BaseModel):
    data: Dict[str, List[APIKey]]

async def analyze_codesnippet_endpoint_llama_server(
    request_data: CodeAnalysisRequest,
    x_local_url: str | None,
    x_use_snippet_model: bool | None,
    x_local_snippet_model: str | None,
    x_local_alignment_model: str | None,
    llama_streamer = Callable[
        [str, dict[Any, Any]],  
        AsyncGenerator[str, None]
    ],
):

    if not (x_local_snippet_model and x_use_snippet_model and x_local_alignment_model and x_local_url):
        raise HTTPException(status_code=400, detail="Incomplete headers")

    payload = {
        "model": x_local_snippet_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT_FOR_SNIPPETS},
            {"role": "user", "content": request_data.code},
        ],
        "stream": True,
        "temperature": 0.5,
    }

    async def generate_stream() -> AsyncGenerator[str, None]:
        async for chunk in llama_streamer(x_local_url, payload):
            yield chunk

    return StreamingResponse(generate_stream(), media_type="text/plain")


async def analyze_codesnippet_endpoint_ollama(
    request_data: CodeAnalysisRequest,
    x_local_url: str | None,
    x_use_snippet_model: bool | None,
    x_local_snippet_model: str | None,
    x_local_alignment_model: str | None,
    ollama_streamer: Callable[
        [ollama.AsyncClient | None, str, str],  
        AsyncGenerator[str, None]
    ],
):

    if not (x_local_url and x_use_snippet_model != None and x_local_alignment_model and x_local_snippet_model):
        raise HTTPException(
            status_code=400,
            detail="One or more invalid headers!"
        )

    try:
        client = await init_ollama_client(x_local_url)
    except Exception as e:
        raise HTTPException(
            status_code=404,
            detail=f"Ollama client error: {e}"
        )

    model = x_local_snippet_model

    if not model:
        raise HTTPException(
            status_code=400,
            detail="No model provided"
        )

    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Ollama client is not initialized. Ensure Ollama is running and accessible.",
        )

    model_dict = await client.list()
    model_list = model_dict.get("models")

    model_list = [ m["name"] for m in model_list ]

    if model not in model_list:
        raise HTTPException(
            status_code=404,
            detail="Unavailable model"
        )

    full_prompt = f"{request_data.code}"
    
    async def generate_stream() -> AsyncGenerator[str, None]:
         async for chunk in ollama_streamer(client, full_prompt, x_local_snippet_model if x_use_snippet_model else x_local_alignment_model):
            yield chunk

    return StreamingResponse(
        generate_stream(), media_type="text/plain" 
    )

async def analyze_codesnippet_endpoint_gemini(
    request_data: CodeAnalysisRequest, 
    x_use_snippet_model: bool | None,
    x_cloud_api_key: str | None,
    x_cloud_encrypted_key: str | None,
    x_cloud_iv: str | None,
):

    api_key = ""

    if x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv and x_use_snippet_model != None:
        api_key = utils.decrypt_envelope(x_cloud_encrypted_key, x_cloud_iv, x_cloud_api_key, settings.RSA_PRIVATE_KEY)
    else:
        raise HTTPException(
            status_code=400,
            detail="Incomplete headers",
        )

    try:
        gclient = genai.Client(api_key=api_key)
    except Exception as e:
        logging.error(f"Failed to initialize Gemini client: {e}")
        gclient = None

    isSnippet = True if x_use_snippet_model == 'true' else False
    systemPrompt = SYSTEM_PROMPT_FOR_SNIPPETS if isSnippet else SYSTEM_PROMPT

    if gclient is None:
        raise HTTPException(
            status_code=503,
            detail="Gemini client is not initialized. Ensure GEMINI_API_KEY is set.",
        )

    user_content = ""

    if not isSnippet:
        user_content = f"\n{request_data.code}\n"
        if request_data.context:
            user_content += f"\nADDITIONAL CONTEXT:\n---\n{request_data.context}\n---"
    else:
        user_content = f"\n{request_data.code}\n"

    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            stream = gclient.models.generate_content_stream(
                model="gemini-2.5-flash",
                contents=[user_content],  
                config=genai.types.GenerateContentConfig(
                    system_instruction=systemPrompt, response_mime_type="text/plain"
                ),
            )

            for chunk in stream:
                if chunk.text:
                    yield chunk.text

        except APIError as e:
            logging.error(f"Gemini API Error: {e}")
            yield f"\n[API_ERROR] Gemini API Error: The service returned an error. Check your API key and quota status. Details: {e}"
        except Exception as e:
            logging.error(f"An unexpected server error occurred: {e}")
            yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"

    return StreamingResponse(generate_stream(), media_type="text/plain")

async def analyze_codesnippet_endpoint_chatgpt(
    request_data: CodeAnalysisRequest, 
    x_use_snippet_model: bool | None,
    x_cloud_api_key: str | None,
    x_cloud_encrypted_key: str | None,
    x_cloud_iv: str | None,
):

    api_key = ""
    if x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv:
        api_key = utils.decrypt_envelope(x_cloud_encrypted_key, x_cloud_iv, x_cloud_api_key, settings.RSA_PRIVATE_KEY)

    client = None
    try:
        # Initialize OpenAI Client
        client = OpenAI(api_key=api_key)
    except Exception as e:
        logging.error(f"Failed to initialize OpenAI client: {e}")
        client = None

    isSnippet = True if x_use_snippet_model == 'true' else False
    systemPrompt = SYSTEM_PROMPT_FOR_SNIPPETS if isSnippet else SYSTEM_PROMPT
    
    # Select appropriate model (e.g., gpt-4o or gpt-4o-mini)
    model_name = "gpt-4o-mini" if isSnippet else "gpt-4o"

    if client is None:
        raise HTTPException(
            status_code=503,
            detail="OpenAI client is not initialized. Ensure API key is valid.",
        )

    user_content = f"\n{request_data.code}\n"
    if not isSnippet and request_data.context:
        user_content += f"\nADDITIONAL CONTEXT:\n---\n{request_data.context}\n---"

    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            # OpenAI Streaming Logic
            stream = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": systemPrompt},
                    {"role": "user", "content": user_content}
                ],
                stream=True
            )

            for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except APIError as e:
            logging.error(f"OpenAI API Error: {e}")
            yield f"\n[API_ERROR] OpenAI API Error: {e}"
        except Exception as e:
            logging.error(f"An unexpected server error occurred: {e}")
            yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"

    return StreamingResponse(generate_stream(), media_type="text/plain")


async def analyze_codesnippet_endpoint_grok(
    request_data: CodeAnalysisRequest, 
    x_use_snippet_model: bool | None,
    x_cloud_api_key: str | None,
    x_cloud_encrypted_key: str | None,
    x_cloud_iv: str | None,
):

    api_key = ""
    if x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv:
        api_key = utils.decrypt_envelope(x_cloud_encrypted_key, x_cloud_iv, x_cloud_api_key, settings.RSA_PRIVATE_KEY)

    client = None
    try:
        # Initialize xAI Client (using OpenAI SDK)
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.x.ai/v1"
        )
    except Exception as e:
        logging.error(f"Failed to initialize Grok client: {e}")
        client = None

    isSnippet = True if x_use_snippet_model == 'true' else False
    systemPrompt = SYSTEM_PROMPT_FOR_SNIPPETS if isSnippet else SYSTEM_PROMPT
    
    # Current Grok beta model
    model_name = "grok-beta" 

    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Grok client is not initialized. Ensure API key is valid.",
        )

    user_content = f"\n{request_data.code}\n"
    if not isSnippet and request_data.context:
        user_content += f"\nADDITIONAL CONTEXT:\n---\n{request_data.context}\n---"

    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            stream = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": systemPrompt},
                    {"role": "user", "content": user_content}
                ],
                stream=True
            )

            for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content

        except APIError as e:
            logging.error(f"Grok API Error: {e}")
            yield f"\n[API_ERROR] Grok API Error: {e}"
        except Exception as e:
            logging.error(f"An unexpected server error occurred: {e}")
            yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"

    return StreamingResponse(generate_stream(), media_type="text/plain")


async def analyze_codesnippet_endpoint_claude(
    request_data: CodeAnalysisRequest, 
    x_use_snippet_model: bool | None,
    x_cloud_api_key: str | None,
    x_cloud_encrypted_key: str | None,
    x_cloud_iv: str | None,
):

    api_key = ""
    if x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv:
        api_key = utils.decrypt_envelope(x_cloud_encrypted_key, x_cloud_iv, x_cloud_api_key, settings.RSA_PRIVATE_KEY)

    client = None
    try:
        client = Anthropic(api_key=api_key)
    except Exception as e:
        logging.error(f"Failed to initialize Claude client: {e}")
        client = None

    isSnippet = True if x_use_snippet_model == 'true' else False
    systemPrompt = SYSTEM_PROMPT_FOR_SNIPPETS if isSnippet else SYSTEM_PROMPT
    
    model_name = "claude-3-haiku-20240307" if isSnippet else "claude-3-5-sonnet-20240620"

    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Claude client is not initialized. Ensure API key is valid.",
        )

    user_content = f"\n{request_data.code}\n"
    if not isSnippet and request_data.context:
        user_content += f"\nADDITIONAL CONTEXT:\n---\n{request_data.context}\n---"

    async def generate_stream() -> AsyncGenerator[str, None]:
         async for chunk in anthtropic_stream(client, systemPrompt, user_content, model_name):
            yield chunk

    return StreamingResponse(generate_stream(), media_type="text/plain")

REQUEST_MAP = {
    "analyze_codesnippet_srvllama": lambda a,b,c,d,e,f : analyze_codesnippet_endpoint_llama_server(a,b,c,d,e,f),
    "analyze_codesnippet_ollama": lambda a,b,c,d,e,f : analyze_codesnippet_endpoint_ollama(a,b,c,d,e,f),
    "analyze_codesnippet_gemini": lambda a,b,c,d,e : analyze_codesnippet_endpoint_gemini(a, b, c, d, e),
    "analyze_codesnippet_grok": lambda a,b,c,d,e : analyze_codesnippet_endpoint_grok(a,b,c,d,e),
    "analyze_codesnippet_claude": lambda a,b,c,d,e : analyze_codesnippet_endpoint_claude(a,b,c,d,e),
    "analyze_codesnippet_openai": lambda a,b,c,d,e : analyze_codesnippet_endpoint_chatgpt(a,b,c,d,e),
}

@app.post("/analyze", tags=["Proxy Route"])
async def analyze(
    request: Request,
    request_data: CodeAnalysisRequest,
    x_use_local_provider: Annotated[Union[str, None], Header()] = None,
    x_use_snippet_model: Annotated[Union[str, None], Header()] = None,
    x_default_local_provider: Annotated[Union[str, None], Header()] = None,
    x_default_cloud_provider: Annotated[Union[str, None], Header()] = None,
    x_local_url: Annotated[Union[str, None], Header()] = None,
    x_local_snippet_model: Annotated[Union[str, None], Header()] = None,
    x_local_alignment_model: Annotated[Union[str, None], Header()] = None,
    x_cloud_api_key: Annotated[Union[str, None], Header()] = None,
    x_cloud_encrypted_key: Annotated[Union[str, None], Header()] = None,
    x_cloud_iv: Annotated[Union[str, None], Header()] = None,
):

    if not (x_use_local_provider and x_use_snippet_model and
            x_default_cloud_provider and x_default_local_provider and
            x_local_alignment_model and x_local_snippet_model):
        raise HTTPException(
            status_code=400,
            detail="Incomplete headers"
        )

    useLocalProvider = True if x_use_local_provider == 'true' else False if x_use_local_provider == 'false' else None
    useSnippetModel = True if x_use_snippet_model == 'true' else False if x_use_local_provider == 'false' else None

    defaultLocalProvider = x_default_local_provider
    defaultCloudProvider = x_default_cloud_provider

    localUrl = x_local_url
    localSnippetModel = x_local_snippet_model
    localAlignmentModel = x_local_alignment_model

    cloudAPIKey = x_cloud_api_key if x_cloud_api_key else None
    cloudEncrpytedKey = x_cloud_encrypted_key if x_cloud_encrypted_key else None
    cloudIV = x_cloud_iv if x_cloud_iv else None

    streamer = get_ollama_streamer() if defaultLocalProvider == "ollama" else get_llama_streamer()

    if useLocalProvider:
        return await REQUEST_MAP[f"analyze_codesnippet_{defaultLocalProvider}"](
                request_data, 
                localUrl, 
                useSnippetModel, 
                localSnippetModel, 
                localAlignmentModel,
                streamer
            )
    else:
        return await REQUEST_MAP[f"analyze_codesnippet_{defaultCloudProvider}"](
                request_data,
                useSnippetModel, 
                cloudAPIKey, 
                cloudEncrpytedKey,
                cloudIV
            )



@app.get("/.well-known/rsa-key", tags=["RSA public key"])
async def get_rsa_public_key():
    return FileResponse(
        path="./rsa_public.pem",
        status_code=200,
        filename="rsa_public.pem"
    )
