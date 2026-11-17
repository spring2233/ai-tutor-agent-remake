from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()
class Settings(BaseSettings):
    chunk_size: int = 2500
    chunk_overlap: int = 200
    embedding_model: str = "models/all-MiniLM-L6-v2"
    chroma_collection_name: str = "ai_tutor"
    chroma_persist_dir: str = "chroma_db"

    retrieval_k: int = 4
    min_relevance_score: float = 0.5
    max_retrieval_distance: float = 2.0
    dashscope_api_key: str = ""
    dashscope_base_url: str = ""
    dashscope_model: str = "qwen3.7-plus"

    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"
    
    llm_temperature: float = 0.0
    llm_max_tokens: int = 16384

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )
settings = Settings()
