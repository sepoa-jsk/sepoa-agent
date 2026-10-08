"""세포아 사내 업무 플랫폼 — 내부 AI 엔진.

호출 주체는 Java 업무 앱뿐이다. 게이트웨이에 노출하지 않으며 화면도 없다.

  GET  /api/health                 상태 (토큰 불필요)
  GET  /v1/tasks                   등록된 작업 목록
  POST /v1/tasks/{task_id}         작업 실행

요청 본문:  {"input": {...}, "context": {"app": "quote", "user": "a@sepoasoft.co.kr", "requestId": "..."},
             "options": {"model": "..."}}
응답 본문:  {"taskId", "status": "OK", "output": {...}, "usage": {"model", "inputTokens", "outputTokens"},
             "durationMs", "requestId"}
오류 본문:  {"error": "<코드>", "message": "...", "taskId", "requestId"}   (docs/STANDARDS.md 5장)
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from . import tasks
from .config import Settings, get_settings
from .llm import LlmError

VERSION = "0.1.0"
log = logging.getLogger("ai-engine")
logging.basicConfig(level=logging.INFO, format="%(message)s")


class TaskRequest(BaseModel):
    input: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class EngineError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    if not settings.ai_engine_token:
        raise RuntimeError("AI_ENGINE_TOKEN 이 비어 있습니다. platform/ai-engine/.env 를 확인하십시오")

    tasks.load_all()
    app = FastAPI(title="Sepoa AI Engine", version=VERSION, docs_url="/docs", redoc_url=None)

    def require_token(x_internal_token: str | None = Header(default=None)) -> None:
        if x_internal_token != settings.ai_engine_token:
            raise EngineError(401, "Unauthorized", "X-Internal-Token 이 없거나 일치하지 않습니다")

    @app.exception_handler(EngineError)
    async def _engine_error(request: Request, exc: EngineError):
        return JSONResponse(status_code=exc.status, content={
            "error": exc.code, "message": exc.message,
            "taskId": request.path_params.get("task_id"),
            "requestId": request.headers.get("x-request-id"),
        })

    @app.get("/api/health")
    def health():
        return {"status": "UP", "engine": "ai-engine", "version": VERSION,
                "llm": {"mode": settings.llm_mode, "model": settings.ai_model,
                        "configured": settings.llm_mode == "stub" or bool(settings.anthropic_api_key)},
                "tasks": {"ready": sum(t.status == "ready" for t in tasks.all_tasks()),
                          "planned": sum(t.status == "planned" for t in tasks.all_tasks())}}

    @app.get("/v1/tasks", dependencies=[Depends(require_token)])
    def list_tasks():
        return [{"id": t.id, "app": t.app, "description": t.description, "status": t.status, "note": t.note,
                 "inputSchema": t.input_model.model_json_schema() if t.input_model else None}
                for t in tasks.all_tasks()]

    @app.post("/v1/tasks/{task_id}", dependencies=[Depends(require_token)])
    def run_task(task_id: str, req: TaskRequest, x_request_id: str | None = Header(default=None)):
        request_id = x_request_id or req.context.get("requestId") or uuid.uuid4().hex
        task = tasks.get(task_id)
        if task is None:
            raise EngineError(404, "UnknownTask", f"등록되지 않은 작업입니다: {task_id}")
        if task.status != "ready":
            raise EngineError(501, "NotImplemented", f"계획만 등록된 작업입니다 — {task.note}")

        try:
            inp = task.input_model.model_validate(req.input)
        except ValidationError as e:
            raise EngineError(422, "InvalidInput", json.dumps(e.errors(include_url=False), ensure_ascii=False, default=str))

        started = time.perf_counter()
        ctx = {**req.context, "options": req.options, "requestId": request_id}
        try:
            result = task.handler(inp, ctx, settings)
        except LlmError as e:
            raise EngineError(502, "LlmError", str(e))
        duration_ms = int((time.perf_counter() - started) * 1000)

        # 사용량 로그 — 한 줄 JSON. 비용 집계는 호출한 업무 앱이 이 값을 저장해 한다.
        log.info(json.dumps({"event": "task", "taskId": task_id, "app": req.context.get("app"),
                             "user": req.context.get("user"), "requestId": request_id,
                             "model": result.model, "in": result.input_tokens, "out": result.output_tokens,
                             "ms": duration_ms}, ensure_ascii=False))
        return {"taskId": task_id, "status": "OK", "output": result.output,
                "usage": {"model": result.model, "inputTokens": result.input_tokens, "outputTokens": result.output_tokens},
                "durationMs": duration_ms, "requestId": request_id}

    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` 지원. import 시점이 아니라 접근 시점에 만들어 테스트가 설정을 주입할 수 있게 한다.
    if name == "app":
        return create_app()
    raise AttributeError(name)
