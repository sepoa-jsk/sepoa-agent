"""공통 작업 — 특정 업무에 속하지 않는 것."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .. import llm
from ..config import Settings
from . import Task, TaskResult, register


class EchoInput(BaseModel):
    message: str = Field(..., max_length=2000)


def _echo(inp: EchoInput, ctx: dict[str, Any], settings: Settings) -> TaskResult:
    # 모델을 부르지 않는다. Java 업무 앱 ↔ AI 엔진 연결(토큰·직렬화·오류 형태) 확인용.
    return TaskResult(output={"message": inp.message, "app": ctx.get("app")})


register(Task(id="common.echo", app="common", description="연결 확인용 — 입력을 그대로 돌려준다 (LLM 미호출)",
              input_model=EchoInput, handler=_echo))


class SummarizeInput(BaseModel):
    text: str = Field(..., min_length=1, max_length=100_000)
    max_sentences: int = Field(3, ge=1, le=20)


def _summarize(inp: SummarizeInput, ctx: dict[str, Any], settings: Settings) -> TaskResult:
    r = llm.complete(
        settings,
        system="너는 세포아소프트 사내 업무를 돕는 요약기다. 한국어로, 사실만, 지정한 문장 수 이내로 요약한다.",
        prompt=f"다음 글을 {inp.max_sentences}문장 이내로 요약하라.\n\n{inp.text}",
        model=ctx.get("options", {}).get("model"),
    )
    return TaskResult(output={"summary": r.text, "stub": r.stub}, model=r.model,
                      input_tokens=r.input_tokens, output_tokens=r.output_tokens)


register(Task(id="common.summarize", app="common", description="글 요약 (LLM)",
              input_model=SummarizeInput, handler=_summarize))
