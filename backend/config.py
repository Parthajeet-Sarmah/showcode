from pydantic_settings import BaseSettings, SettingsConfigDict
import os

class Settings(BaseSettings):
    OLLAMA_HOST: str = ""
    LLAMA_SERVER_URL: str = ""
    RSA_PRIVATE_KEY: str = ""
    DEMO_MODE: bool = False
    SERVER_SIDE_API_KEY: str = ""
    RATE_LIMIT: str = "5/minute"

    model_config = SettingsConfigDict(
        env_file=[
            "backend/.env", 
            ".env",
            os.path.join(os.path.dirname(__file__), ".env")
        ],
        env_file_encoding='utf-8',
        extra='ignore'
    )
