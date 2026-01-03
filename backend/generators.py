from anthropic import APIError as AnthropicAPIError, Anthropic
import httpx
import json
import logging
from typing import AsyncGenerator

from fastapi import HTTPException
from ollama import AsyncClient

from backend.constants import SYSTEM_PROMPT, SYSTEM_PROMPT_FOR_SNIPPETS

async def llama_stream(
    url: str,
    payload: dict,
) -> AsyncGenerator[str, None]:
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code != 200:
                    error_msg = await response.aread()
                    logging.error(f"Llama Server Error: {error_msg.decode()}")
                    raise HTTPException(
                        status_code=response.status_code,
                        detail="Llama server error",
                    )

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break

                    data_json = json.loads(data_str)
                    delta = data_json.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")
        yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"


async def ollama_stream(
    client: AsyncClient | None,
    full_prompt: str,
    model: str,
    use_snippet: bool | None,
) -> AsyncGenerator[str, None]:
        try:
            if client is None:
                raise HTTPException(
                    status_code=503,
                    detail="Ollama service is unavailable.",
                )

            if use_snippet == None:
                raise HTTPException(
                    status_code=404,
                    detail="Use snippet boolean is inactive"
                )

            system = SYSTEM_PROMPT_FOR_SNIPPETS if use_snippet else SYSTEM_PROMPT

            stream = await client.generate(
                model=model,
                prompt=full_prompt,
                system=system,
                stream=True
            )

            async for chunk in stream:
                response_text = chunk.get("response", "")
                if response_text:
                    yield response_text
        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}")
            yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"

async def anthtropic_stream(client: Anthropic, systemPrompt: str, user_content: str, model_name: str) -> AsyncGenerator[str, None]: 
    try:
        with client.messages.stream(
            max_tokens=4096,
            system=systemPrompt,
            messages=[
                {"role": "user", "content": user_content}
            ],
            model=model_name,
        ) as stream:
            for text in stream.text_stream:
                yield text

    except AnthropicAPIError as e:
        logging.error(f"Claude API Error: {e}")
        yield f"\n[API_ERROR] Claude API Error: {e}"
    except Exception as e:
        logging.error(f"An unexpected server error occurred: {e}")
        yield f"\n[SERVER_ERROR] An unexpected error occurred: {e}"
