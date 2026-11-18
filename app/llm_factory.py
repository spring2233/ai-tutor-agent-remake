"""Pick DashScope Qwen by default; Groq only when GROQ_API_KEY is set."""

from typing import Optional

from app.rag.config import settings


def make_llm(
    temperature: float,
    max_tokens: Optional[int] = None,
    timeout: Optional[float] = None,
    thinking: Optional[bool] = None,
):
    if max_tokens is None:
        max_tokens = settings.llm_max_tokens
    if settings.dashscope_api_key:
        from langchain_openai import ChatOpenAI

        extra = {"timeout": timeout, "max_retries": 1} if timeout else {}
        if thinking is not None:
            extra["extra_body"] = {"enable_thinking": thinking}
        return ChatOpenAI(
            model=settings.dashscope_model,
            api_key=settings.dashscope_api_key,
            base_url=settings.dashscope_base_url,
            temperature=temperature,
            max_tokens=max_tokens,
            **extra,
        )

    if settings.groq_api_key:
        from langchain_groq import ChatGroq

        return ChatGroq(
            model=settings.groq_model,
            temperature=temperature,
            api_key=settings.groq_api_key,
            max_tokens=max_tokens,
            timeout=timeout,
        )

    raise ValueError(
        "No API key provided. Please set DASHSCOPE_API_KEY in your .env file."
    )
