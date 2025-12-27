import json
import logging
import httpx
import utils
import config
import ollama

from functools import lru_cache
from typing import Annotated, AsyncGenerator, Dict, List
from typing import Optional
from fastapi import Depends, FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from google import genai
from google.genai.errors import APIError
from fastapi.middleware.cors import CORSMiddleware
from constants import SYSTEM_PROMPT, SYSTEM_PROMPT_FOR_SNIPPETS, LLAMA_SERVER_URL

@lru_cache
def get_settings():
    return config.Settings()

try:
    client = ollama.AsyncClient()
except Exception as e:
    logging.error(f"Failed to initialize Ollama client: {e}")
    client = None

app = FastAPI(
    title="Ollama Code Analysis API",
    description="An API endpoint to analyze code snippets using the Ollama LLM.",
    version="1.0.0",
)

origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
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

@app.post("/analyze", tags=["Proxy Route"])
async def proxy_via_headers(request: Request):

    useLocalProvider = True if request.headers["x-use-local-provider"] == 'true' else False
    useSnippetModel = True if request.headers["x-use-snippet-model"] == 'true' else False
    defaultLocalProvider = request.headers["x-default-local-provider"]
    defaultCloudProvider = request.headers["x-default-cloud-provider"]

    if useLocalProvider and useSnippetModel:
        return RedirectResponse(f"/analyze_snippet_{defaultLocalProvider}")
    elif useLocalProvider and not useSnippetModel:
        return RedirectResponse(f"/analyze_code_{defaultLocalProvider}")
    elif not useLocalProvider and useSnippetModel:
        return RedirectResponse(f"/analyze_snippet_{defaultCloudProvider}")
    elif not useLocalProvider and not useSnippetModel:
        return RedirectResponse(f"/analyze_code_{defaultCloudProvider}")


@app.post("/analyze_code_srvllama", tags=["Analysis"])
async def analyze_code_endpoint_llama_server(request_data: CodeAnalysisRequest, x_local_alignment_model: str | None = Header(default=None)):

    if not x_local_alignment_model:
        raise HTTPException(
            status_code=400,
            detail="Invalid model name"
        )

    user_content = f"CODE SNIPPET:\n---\n{request_data.code}\n---"
    if request_data.context:
        user_content += f"\nADDITIONAL CONTEXT:\n---\n{request_data.context}\n---"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    payload = {
        "model": x_local_alignment_model,
        "messages": messages,
        "stream": True,
        "temperature": 0.5,
    }

    async def generate_stream() -> AsyncGenerator[str, None]:
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream(
                    "POST", LLAMA_SERVER_URL, json=payload
                ) as response:

                    if response.status_code != 200:
                        error_msg = await response.aread()
                        logging.error(f"Llama Server Error: {error_msg.decode()}")
                        raise HTTPException(
                            status_code=response.status_code,
                            detail=f"Llama server returned error: {response.status_code}",
                        )

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]  

                            if data_str.strip() == "[DONE]":
                                break

                            try:
                                data_json = json.loads(data_str)
                                
                                delta = data_json.get("choices", [{}])[0].get(
                                    "delta", {}
                                )
                                content = delta.get("content", "")

                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                logging.warning(f"Failed to parse JSON line: {line}")
                                continue

            except httpx.ConnectError:
                yield "\n[SERVER_ERROR] Could not connect to llama-server at localhost:8080. Is it running?"
            except Exception as e:
                logging.error(f"An unexpected error occurred: {e}")
                yield f"\n[SERVER_ERROR] An unexpected error occurred: {str(e)}"

    return StreamingResponse(generate_stream(), media_type="text/plain")


@app.post("/analyze_snippet_srvllama", tags=["Analysis"])
async def analyze_snippet_llama_server_endpoint(request_data: CodeAnalysisRequest, x_local_snippet_model: str | None = Header(default=None)):

    if not x_local_snippet_model:
        raise HTTPException(
            status_code=400,
            detail="Invalid model name"
        )
        
 
    full_prompt = f"{request_data.code}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT_FOR_SNIPPETS},
        {"role": "user", "content": full_prompt},
    ]

    payload = {
        "model": x_local_snippet_model,
        "messages": messages,
        "stream": True,
        "temperature": 0.5,
    }

    async def generate_stream() -> AsyncGenerator[str, None]:
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream(
                    "POST", LLAMA_SERVER_URL, json=payload
                ) as response:

                    if response.status_code != 200:
                        error_msg = await response.aread()
                        logging.error(f"Llama Server Error: {error_msg.decode()}")
                        raise HTTPException(
                            status_code=response.status_code,
                            detail=f"Llama server returned error: {response.status_code}",
                        )

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]  

                            if data_str.strip() == "[DONE]":
                                break

                            try:
                                data_json = json.loads(data_str)
                                delta = data_json.get("choices", [{}])[0].get(
                                    "delta", {}
                                )
                                content = delta.get("content", "")

                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                logging.warning(f"Failed to parse JSON line: {line}")
                                continue

            except httpx.ConnectError:
                yield "\n[SERVER_ERROR] Could not connect to llama-server at localhost:8080. Is it running?"
            except Exception as e:
                logging.error(f"An unexpected error occurred: {e}")
                yield f"\n[SERVER_ERROR] An unexpected error occurred: {str(e)}"

    return StreamingResponse(generate_stream(), media_type="text/plain")

@app.post("/analyze_snippet_ollama", tags=["Analysis"])
async def analyze_snippet_endpoint(request_data: CodeAnalysisRequest, x_local_snippet_model: str | None = Header(default=None)):

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

    full_prompt = f"{request_data.code}"
    
    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            if client is None:
                raise HTTPException(
                    status_code=503,
                    detail="Ollama service is unavailable.",
                )
            stream = await client.generate(
                model=model, 
                prompt=full_prompt, 
                system=SYSTEM_PROMPT_FOR_SNIPPETS, 
                stream=True
            )

            async for chunk in stream:
                response_text = chunk.get("response", "")
                if response_text:
                    
                    
                    yield response_text
                    
        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}")
            yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"

    return StreamingResponse(
        generate_stream(), media_type="text/plain" 
    )


@app.post("/analyze_code_ollama", tags=["Analysis"])
async def analyze_code_endpoint(request_data: CodeAnalysisRequest, x_local_alignment_model: str | None = Header(default=None)):

    if not x_local_alignment_model:
        raise HTTPException(
            status_code=400,
            detail="Invalid model name"
        )


    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Ollama client is not initialized. Ensure Ollama is running and accessible.",
        )

    full_prompt = f"{request_data.code}"
    
    async def generate_stream() -> AsyncGenerator[str, None]:
        try:
            if client is None:
                raise HTTPException(
                    status_code=503,
                    detail="Ollama service is unavailable.",
                )
            
            stream = await client.generate(
                model=x_local_alignment_model, 
                prompt=full_prompt, 
                system=SYSTEM_PROMPT, 
                stream=True
            )

            async for chunk in stream:
                response_text = chunk.get("response", "")
                if response_text:
                    
                    
                    yield response_text
                    
        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}")
            yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"

    return StreamingResponse(
        generate_stream(), media_type="text/plain" 
    )


@app.post("/analyze_snippet_gemini", tags=["Analysis"])
@app.post("/analyze_code_gemini", tags=["Analysis"])
async def analyze_code_endpoint_gemini(request_data: CodeAnalysisRequest, settings: Annotated[config.Settings, Depends(get_settings)] , 
                                       x_use_snippet_model: str | None = Header(default=None), 
                                       x_cloud_api_key: str | None = Header(default=None), 
                                       x_cloud_encrypted_key: str | None = Header(default=None), 
                                       x_cloud_iv: str | None = Header(default=None)):

    api_key = ""
    if x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv:
        api_key = utils.decrypt_envelope(x_cloud_encrypted_key, x_cloud_iv, x_cloud_api_key, settings.RSA_PRIVATE_KEY)

    print(api_key)

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
        if gclient is None:
            raise HTTPException(
                status_code=503,
                detail="Gemini client is not initialized. Ensure GEMINI_API_KEY is set.",
            )

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

@app.get("/.well-known/rsa-key", tags=["RSA public key"])
async def get_rsa_public_key():
    return FileResponse(
        path="./public_key.pem",
        status_code=200,
        filename="public_key.pem"
    )
