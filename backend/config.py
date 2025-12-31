from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    OLLAMA_HOST: str = ""
    RSA_PRIVATE_KEY: str = ""
    LLAMA_SERVER_URL: str = ""

    model_config = SettingsConfigDict(env_file=".env")
