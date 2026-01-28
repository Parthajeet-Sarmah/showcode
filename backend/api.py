import logging
import secrets
from backend.generators import anthtropic_stream
import backend.utils as utils
import backend.config as config
import ollama

from functools import lru_cache
from typing import Annotated, Any, AsyncGenerator, Callable, Dict, List, Union
from typing import Optional
from fastapi import Depends, FastAPI, HTTPException, Header, Request, Response, Cookie, Query
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse, JSONResponse
from pydantic import BaseModel, Field

from backend.dependencies import get_llama_streamer, get_ollama_streamer
from backend.database import init_db, save_alignment, get_all_alignments

from google import genai
from google.genai.errors import APIError
from openai import OpenAI, APIError
from anthropic import Anthropic

from fastapi.middleware.cors import CORSMiddleware
from backend.constants import SYSTEM_PROMPT, SYSTEM_PROMPT_FOR_SNIPPETS

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# GitHub integration imports
from backend.github import (
    TokenManager,
    OAuthHandler,
    RepositoryService,
    CommitService,
    WebhookHandler,
)
from backend.github.webhooks import TrackingService

@lru_cache
def get_settings():
    return config.Settings()

client = None
settings = get_settings()

# Initialize DB
init_db()

# Initialize GitHub services
token_manager = TokenManager(settings.TOKEN_ENCRYPTION_KEY)
oauth_handler = OAuthHandler(
    client_id=settings.GITHUB_CLIENT_ID,
    client_secret=settings.GITHUB_CLIENT_SECRET,
    redirect_uri=settings.GITHUB_REDIRECT_URI,
    token_manager=token_manager,
)
repo_service = RepositoryService(oauth_handler)
commit_service = CommitService(oauth_handler)
webhook_handler = WebhookHandler(settings.GITHUB_WEBHOOK_SECRET, oauth_handler)
tracking_service = TrackingService(
    oauth_handler=oauth_handler,
    webhook_url=settings.GITHUB_REDIRECT_URI.replace("/auth/github/callback", "/webhooks/github")
    if settings.GITHUB_REDIRECT_URI else ""
)

# Cookie settings for session
COOKIE_NAME = "showcode_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

# Initialize Limiter
limiter = Limiter(key_func=get_remote_address)

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

# Register Limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://showcode.parthajeet.xyz",
    "http://showcode.parthajeet.xyz",
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
        [ollama.AsyncClient | None, str, str, bool],  
        AsyncGenerator[str, None]
    ],
):

    print(x_local_url, x_use_snippet_model, x_local_alignment_model, x_local_snippet_model)
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
    model_list = model_dict["models"]

    model_list = [ m["model"] for m in model_list ]

    if model not in model_list:
        raise HTTPException(
            status_code=404,
            detail="Unavailable model"
        )

    full_prompt = f"{request_data.code}"

    print("x-snippet-model", x_local_snippet_model)
    print("x-alignment-model", x_local_alignment_model)
    print("x-use-snippet", x_use_snippet_model)
    print("if: ", x_local_snippet_model if x_use_snippet_model else x_local_alignment_model)
    
    async def generate_stream() -> AsyncGenerator[str, None]:
         async for chunk in ollama_streamer(client, full_prompt, x_local_snippet_model if x_use_snippet_model else x_local_alignment_model, x_use_snippet_model):
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
    settings = get_settings()

    if x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv and x_use_snippet_model != None: 
        api_key = utils.decrypt_envelope(x_cloud_encrypted_key, x_cloud_iv, x_cloud_api_key, settings.RSA_PRIVATE_KEY)
    elif settings.DEMO_MODE and settings.SERVER_SIDE_API_KEY:
        api_key = settings.SERVER_SIDE_API_KEY
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
    elif settings.DEMO_MODE and settings.SERVER_SIDE_API_KEY:
        api_key = settings.SERVER_SIDE_API_KEY

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
    elif settings.DEMO_MODE and settings.SERVER_SIDE_API_KEY:
        api_key = settings.SERVER_SIDE_API_KEY

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
    elif settings.DEMO_MODE and settings.SERVER_SIDE_API_KEY:
        api_key = settings.SERVER_SIDE_API_KEY

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

@app.get("/alignments", tags=["Alignments"])
async def get_alignments_endpoint():
    return get_all_alignments()

@app.post("/analyze", tags=["Proxy Route"])
@limiter.limit(settings.RATE_LIMIT)
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
    x_snippet_signature: Annotated[Union[str, None], Header()] = None,
):
    
    # Check incomplete headers logic:
    # If DEMO_MODE is on and user didn't provide keys, we allow it IF server key exists.
    # But if they provided some keys but not others, standard validation applies.
    # To simplify: we check if keys are missing. If so, and demo mode is on, we proceed.
    
    has_client_keys = x_cloud_api_key and x_cloud_encrypted_key and x_cloud_iv
    
    if not has_client_keys:
        if not (settings.DEMO_MODE and settings.SERVER_SIDE_API_KEY):
             if not (x_use_local_provider and x_use_snippet_model and x_default_cloud_provider and x_default_local_provider and x_local_alignment_model and x_local_snippet_model):
                raise HTTPException(status_code=400, detail="Incomplete headers")

    useLocalProvider = True if x_use_local_provider == 'true' else False if x_use_local_provider == 'false' else None
    useSnippetModel = True if x_use_snippet_model == 'true' else False if x_use_snippet_model == 'false' else None

    defaultLocalProvider = x_default_local_provider
    defaultCloudProvider = x_default_cloud_provider

    localUrl = x_local_url
    localSnippetModel = x_local_snippet_model
    localAlignmentModel = x_local_alignment_model

    cloudAPIKey = x_cloud_api_key if x_cloud_api_key else None
    cloudEncrpytedKey = x_cloud_encrypted_key if x_cloud_encrypted_key else None
    cloudIV = x_cloud_iv if x_cloud_iv else None

    streamer = get_ollama_streamer() if defaultLocalProvider == "ollama" else get_llama_streamer()

    response = None
    if useLocalProvider:
        response = await REQUEST_MAP[f"analyze_codesnippet_{defaultLocalProvider}"](
                request_data, 
                localUrl, 
                useSnippetModel, 
                localSnippetModel, 
                localAlignmentModel,
                streamer
            )
    else:
        response = await REQUEST_MAP[f"analyze_codesnippet_{defaultCloudProvider}"](
                request_data,
                useSnippetModel, 
                cloudAPIKey, 
                cloudEncrpytedKey,
                cloudIV
            )

    if x_snippet_signature and response and isinstance(response, StreamingResponse):
        original_iterator = response.body_iterator
        
        async def saving_iterator():
            full_text = ""
            try:
                async for chunk in original_iterator:
                    yield chunk
                    text_chunk = chunk
                    if isinstance(chunk, bytes):
                        text_chunk = chunk.decode("utf-8", errors="ignore")
                    full_text += text_chunk
            finally:
                if full_text and not full_text.startswith("\n[SERVER_ERROR]") and not full_text.startswith("\n[API_ERROR]"):
                     save_alignment(x_snippet_signature, full_text)

        return StreamingResponse(
            saving_iterator(),
            status_code=response.status_code,
            media_type=response.media_type,
            background=response.background
        )
    
    return response


@app.get("/.well-known/rsa-key", tags=["RSA public key"])
async def get_rsa_public_key():
    return FileResponse(
        path="./rsa_public.pem",
        status_code=200,
        filename="rsa_public.pem"
    )


# ============ GitHub OAuth Endpoints ============

def get_user_id(session: str = Cookie(None, alias=COOKIE_NAME)) -> Optional[str]:
    """Extract user ID from session cookie."""
    return session


@app.get("/auth/github/login", tags=["GitHub Auth"])
async def github_login(redirect_after: str = Query(default="/")):
    """Initiate GitHub OAuth flow."""
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=503, detail="GitHub integration not configured")

    auth_url = oauth_handler.get_authorization_url(redirect_after)
    return RedirectResponse(url=auth_url, status_code=302)


@app.get("/auth/github/callback", tags=["GitHub Auth"])
async def github_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Handle GitHub OAuth callback."""
    if error:
        logging.error(f"GitHub OAuth error: {error} - {error_description}")
        return RedirectResponse(url=f"/?error={error}", status_code=302)

    result = await oauth_handler.handle_callback(code, state)
    if not result:
        return RedirectResponse(url="/?error=auth_failed", status_code=302)

    user_id = str(result["user"]["id"])
    redirect_uri = result.get("redirect_uri", "/")

    # Create response with session cookie
    response = RedirectResponse(url=redirect_uri, status_code=302)
    response.set_cookie(
        key=COOKIE_NAME,
        value=user_id,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return response


@app.post("/auth/github/refresh", tags=["GitHub Auth"])
async def github_refresh_token(user_id: str = Depends(get_user_id)):
    """Refresh GitHub token if expired."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    success = await oauth_handler.refresh_token(user_id)
    if not success:
        raise HTTPException(status_code=401, detail="Token refresh failed")

    return {"message": "Token refreshed successfully"}


@app.post("/auth/github/logout", tags=["GitHub Auth"])
async def github_logout(response: Response, user_id: str = Depends(get_user_id)):
    """Logout and revoke GitHub token."""
    if user_id:
        oauth_handler.revoke_token(user_id)

    response.delete_cookie(key=COOKIE_NAME)
    return {"message": "Logged out successfully"}


@app.get("/auth/github/status", tags=["GitHub Auth"])
async def github_auth_status(user_id: str = Depends(get_user_id)):
    """Check GitHub authentication status."""
    if not user_id:
        return {"authenticated": False}

    status = oauth_handler.check_auth_status(user_id)

    # Get user info if authenticated
    if status.get("authenticated"):
        user_info = repo_service.get_user_info(user_id)
        if user_info:
            status["user"] = user_info

    return status


# ============ GitHub Repository Endpoints ============

@app.get("/github/repos", tags=["GitHub Repos"])
async def list_repos(
    user_id: str = Depends(get_user_id),
    visibility: str = Query(default="all"),
    sort: str = Query(default="updated"),
    per_page: int = Query(default=30, le=100),
    page: int = Query(default=1, ge=1),
):
    """List user's repositories."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = repo_service.list_repos(
        user_id=user_id,
        visibility=visibility,
        sort=sort,
        per_page=per_page,
        page=page,
    )

    if "error" in result:
        raise HTTPException(status_code=401, detail=result["error"])

    return result


@app.get("/github/repos/search", tags=["GitHub Repos"])
async def search_repos(
    user_id: str = Depends(get_user_id),
    q: str = Query(..., min_length=1),
    per_page: int = Query(default=30, le=100),
    page: int = Query(default=1, ge=1),
):
    """Search repositories."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = repo_service.search_repos(
        user_id=user_id,
        query=q,
        per_page=per_page,
        page=page,
    )

    if "error" in result:
        raise HTTPException(status_code=401, detail=result["error"])

    return result


@app.get("/github/repos/{owner}/{repo}", tags=["GitHub Repos"])
async def get_repo(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
):
    """Get repository details."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = repo_service.get_repo(user_id, owner, repo)
    if not result:
        raise HTTPException(status_code=404, detail="Repository not found")

    return result


@app.get("/github/repos/{owner}/{repo}/contents", tags=["GitHub Repos"])
async def get_repo_contents(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
    path: str = Query(default=""),
    ref: Optional[str] = Query(default=None),
):
    """Browse repository file tree."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = repo_service.get_contents(
        user_id=user_id,
        owner=owner,
        repo=repo,
        path=path,
        ref=ref,
    )

    if "error" in result:
        raise HTTPException(status_code=401, detail=result["error"])

    return result


@app.get("/github/repos/{owner}/{repo}/branches", tags=["GitHub Repos"])
async def get_repo_branches(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
):
    """List repository branches."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    branches = repo_service.get_branches(user_id, owner, repo)
    return {"branches": branches}


@app.get("/github/repos/{owner}/{repo}/file", tags=["GitHub Repos"])
async def get_file_content(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
    path: str = Query(...),
    ref: Optional[str] = Query(default=None),
):
    """Get file content at a specific ref."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = repo_service.get_file(
        user_id=user_id,
        owner=owner,
        repo=repo,
        path=path,
        ref=ref,
    )

    if not result:
        raise HTTPException(status_code=404, detail="File not found")

    return result


# ============ GitHub Commit Endpoints ============

@app.get("/github/repos/{owner}/{repo}/commits", tags=["GitHub Commits"])
async def get_commits(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
    sha: Optional[str] = Query(default=None),
    path: Optional[str] = Query(default=None),
    per_page: int = Query(default=30, le=100),
    page: int = Query(default=1, ge=1),
):
    """List commits for a repository."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = commit_service.get_commits(
        user_id=user_id,
        owner=owner,
        repo=repo,
        sha=sha,
        path=path,
        per_page=per_page,
        page=page,
    )

    if "error" in result:
        raise HTTPException(status_code=401, detail=result["error"])

    return result


@app.get("/github/repos/{owner}/{repo}/commits/{sha}", tags=["GitHub Commits"])
async def get_commit(
    owner: str,
    repo: str,
    sha: str,
    user_id: str = Depends(get_user_id),
):
    """Get a single commit with full details."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = commit_service.get_commit(user_id, owner, repo, sha)
    if not result:
        raise HTTPException(status_code=404, detail="Commit not found")

    return result


@app.get("/github/repos/{owner}/{repo}/compare/{base}...{head}", tags=["GitHub Commits"])
async def compare_commits(
    owner: str,
    repo: str,
    base: str,
    head: str,
    user_id: str = Depends(get_user_id),
):
    """Compare two commits/branches."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = commit_service.compare_commits(user_id, owner, repo, base, head)
    if not result:
        raise HTTPException(status_code=404, detail="Comparison failed")

    return result


@app.get("/github/repos/{owner}/{repo}/file-diff", tags=["GitHub Commits"])
async def get_file_diff(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
    path: str = Query(...),
    base: str = Query(...),
    head: str = Query(...),
):
    """Get diff for a specific file between two commits."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = commit_service.get_file_diff(
        user_id=user_id,
        owner=owner,
        repo=repo,
        path=path,
        base_sha=base,
        head_sha=head,
    )

    if not result:
        raise HTTPException(status_code=404, detail="Could not generate diff")

    return result


# ============ GitHub Tracking Endpoints ============

@app.post("/github/repos/{owner}/{repo}/track", tags=["GitHub Tracking"])
async def start_tracking(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
):
    """Start tracking a repository with webhooks."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = tracking_service.start_tracking(user_id, owner, repo)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to start tracking"))

    return result


@app.delete("/github/repos/{owner}/{repo}/track", tags=["GitHub Tracking"])
async def stop_tracking(
    owner: str,
    repo: str,
    user_id: str = Depends(get_user_id),
):
    """Stop tracking a repository."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = tracking_service.stop_tracking(user_id, owner, repo)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to stop tracking"))

    return result


@app.get("/github/tracked", tags=["GitHub Tracking"])
async def list_tracked(user_id: str = Depends(get_user_id)):
    """List all tracked repositories."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    repos = tracking_service.list_tracked(user_id)
    return {"tracked_repos": repos}


# ============ GitHub Webhook Endpoint ============

@app.post("/webhooks/github", tags=["GitHub Webhooks"])
async def receive_webhook(
    request: Request,
    x_github_event: str = Header(..., alias="X-GitHub-Event"),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
):
    """Receive and process GitHub webhook events."""
    body = await request.body()

    # Verify signature if webhook secret is configured
    if settings.GITHUB_WEBHOOK_SECRET and x_hub_signature_256:
        if not webhook_handler.verify_signature(body, x_hub_signature_256):
            raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    result = await webhook_handler.handle_event(x_github_event, payload)
    return result
