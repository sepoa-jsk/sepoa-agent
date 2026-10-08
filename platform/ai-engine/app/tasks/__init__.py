"""작업(task) 등록부.

업무 앱은 작업 ID 로 AI 엔진을 부른다 (POST /v1/tasks/{task_id}).
작업 하나 = 입력 스키마 + 처리 함수. 새 작업은 이 패키지에 모듈을 만들고 register() 로 등록한다.

작업 ID 규칙: <업무>.<동작>  예) common.summarize, blog.write_draft, daily_work.score_report
status 가 planned 인 작업은 목록에는 보이지만 호출하면 501 을 돌려준다 — 이식 계획을 코드에 드러내기 위함이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from pydantic import BaseModel

from ..config import Settings


class TaskResult(BaseModel):
    output: dict[str, Any]
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


Handler = Callable[[BaseModel, dict[str, Any], Settings], TaskResult]


@dataclass
class Task:
    id: str
    app: str
    description: str
    input_model: type[BaseModel] | None = None
    handler: Handler | None = None
    status: Literal["ready", "planned"] = "ready"
    note: str = ""
    tags: list[str] = field(default_factory=list)


_REGISTRY: dict[str, Task] = {}


def register(task: Task) -> Task:
    if task.id in _REGISTRY:
        raise ValueError(f"작업 ID 중복: {task.id}")
    if task.status == "ready" and (task.handler is None or task.input_model is None):
        raise ValueError(f"ready 작업은 input_model 과 handler 가 필요합니다: {task.id}")
    _REGISTRY[task.id] = task
    return task


def get(task_id: str) -> Task | None:
    return _REGISTRY.get(task_id)


def all_tasks() -> list[Task]:
    return sorted(_REGISTRY.values(), key=lambda t: t.id)


def load_all() -> None:
    """작업 모듈을 import 해 등록을 일으킨다. 순서는 의미 없다.

    등록부가 비어 있으면 모듈을 다시 읽는다 — 테스트가 등록부를 비우고 앱을 새로 만들 수 있게.
    """
    import importlib

    from . import blog, common, daily_work

    if not _REGISTRY:
        for m in (common, blog, daily_work):
            importlib.reload(m)
