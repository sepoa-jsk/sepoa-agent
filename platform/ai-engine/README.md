# platform/ai-engine — 내부 AI 엔진 (Python)

Java 업무 앱이 호출하는 **판단·생성 전용 API**다. 화면·로그인·업무 데이터 저장은 하지 않는다
(역할 분담은 `docs/ARCHITECTURE.md` 2장).

## 실행

```powershell
cd platform\ai-engine
uv sync                         # 최초 1회 (uv 미설치 시: winget install --id astral-sh.uv -e)
copy .env.example .env          # AI_ENGINE_TOKEN 을 바꿀 것
uv run uvicorn app.main:app --port 8100 --reload
# → http://127.0.0.1:8100/api/health , API 문서 http://127.0.0.1:8100/docs
uv run pytest                   # 테스트
```

`LLM_MODE=stub` 이면 API 키 없이 고정 응답을 돌려준다. 실제 호출은 `LLM_MODE=anthropic` + `ANTHROPIC_API_KEY`.

## 호출 계약 (업무 앱 → AI 엔진)

```http
POST http://127.0.0.1:8100/v1/tasks/common.summarize
X-Internal-Token: <AI_ENGINE_TOKEN>
X-Request-Id: <업무 앱이 만든 추적 ID>
Content-Type: application/json

{ "input":   { "text": "...", "max_sentences": 3 },
  "context": { "app": "quote", "user": "hong@sepoasoft.co.kr" },
  "options": { "model": "claude-sonnet-5-5" } }
```

| 결과 | HTTP | 본문 |
|---|---|---|
| 성공 | 200 | `{taskId, status:"OK", output, usage:{model,inputTokens,outputTokens}, durationMs, requestId}` |
| 토큰 오류 | 401 | `{error:"Unauthorized", message, taskId, requestId}` |
| 없는 작업 | 404 | `UnknownTask` |
| 입력 오류 | 422 | `InvalidInput` — message 에 필드별 오류 |
| 계획만 등록 | 501 | `NotImplemented` — 이식 예정 작업 |
| 모델 호출 실패 | 502 | `LlmError` |

- 게이트웨이에 노출하지 않는다. 브라우저가 직접 부르지 않는다.
- 사용량(토큰)은 응답으로 돌려준다. **비용 기록은 호출한 업무 앱이 자기 DB 에 남긴다.**
- `GET /v1/tasks` 로 작업 목록·입력 스키마를 본다.

## 작업 추가

1. `app/tasks/<업무>.py` 에 입력 모델(pydantic)과 처리 함수를 만들고 `register(Task(...))`.
2. 모델 호출은 반드시 `app/llm.py` 의 `complete()` 로 한다 (stub 모드·사용량·오류 처리 공통).
3. `tests/` 에 stub 모드 테스트를 더한다.
4. 작업 ID 규칙: `<업무>.<동작>` — `blog.write_draft`, `daily_work.score_quality`.

현재 `ready` 2종(`common.echo`, `common.summarize`), `planned` 13종(블로그 5 · 일일업무 8).
planned 작업의 원본 위치는 각 작업의 `note` 에 있다.
