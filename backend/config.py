from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    RSA_PUBLIC_KEY: str = ""
    GEMINI_API_KEY: str = ""
    RSA_PRIVATE_KEY: str = ""

    model_config = SettingsConfigDict(env_file=".env")
