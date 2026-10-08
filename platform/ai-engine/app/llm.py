"""LLM 호출 계층. 모든 작업은 이 모듈을 통해서만 모델을 부른다.

- stub 모드: API 키 없이 고정 형식의 응답을 돌려준다. 개발·테스트·Java 연동 확인용.
- anthropic 모드: Anthropic Messages API 호출.

사용량(토큰)은 항상 돌려준다. 업무 앱이 비용을 기록할 수 있게 하기 위함이다.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings


@dataclass
class LlmResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    stub: bool


class LlmError(RuntimeError):
    """모델 호출 실패. 조용히 빈 문자열을 돌려주지 않고 예외로 올린다."""


def complete(settings: Settings, *, system: str, prompt: str, model: str | None = None,
             max_tokens: int | None = None) -> LlmResult:
    model = model or settings.ai_model
    max_tokens = max_tokens or settings.ai_max_tokens

    if settings.llm_mode == "stub":
        head = prompt.strip().replace("\n", " ")[:80]
        return LlmResult(text=f"[STUB] {head}", model=f"stub:{model}",
                         input_tokens=len(prompt) // 4, output_tokens=0, stub=True)

    if not settings.anthropic_api_key:
        raise LlmError("LLM_MODE=anthropic 인데 ANTHROPIC_API_KEY 가 비어 있습니다")

    import anthropic  # 지연 import — stub 모드에서는 SDK 초기화 비용을 쓰지 않는다

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        msg = client.messages.create(
            model=model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIError as e:  # pragma: no cover — 실제 API 오류 경로
        raise LlmError(f"Anthropic API 오류: {e}") from e

    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    return LlmResult(text=text, model=msg.model, input_tokens=msg.usage.input_tokens,
                     output_tokens=msg.usage.output_tokens, stub=False)
