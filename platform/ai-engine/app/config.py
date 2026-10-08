"""AI 엔진 설정 — 환경변수 또는 platform/ai-engine/.env 에서 읽는다."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 업무 앱이 보내는 X-Internal-Token 과 비교한다. 비어 있으면 기동 시 실패한다 —
    # 토큰 없이 열린 AI 엔진은 사내망 누구나 LLM 비용을 쓰게 만든다.
    ai_engine_token: str = ""

    llm_mode: Literal["stub", "anthropic"] = "stub"
    anthropic_api_key: str = ""
    ai_model: str = "claude-sonnet-5-5"
    ai_max_tokens: int = 2048


@lru_cache
def get_settings() -> Settings:
    return Settings()
