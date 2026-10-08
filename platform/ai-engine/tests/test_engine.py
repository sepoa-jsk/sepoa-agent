import pytest
from fastapi.testclient import TestClient

from app import tasks
from app.config import Settings
from app.main import create_app

TOKEN = "test-token"
H = {"X-Internal-Token": TOKEN}


@pytest.fixture
def client():
    tasks._REGISTRY.clear()
    return TestClient(create_app(Settings(ai_engine_token=TOKEN, llm_mode="stub", _env_file=None)))


def test_token_required_to_boot():
    tasks._REGISTRY.clear()
    with pytest.raises(RuntimeError):
        create_app(Settings(ai_engine_token="", _env_file=None))


def test_health_open_without_token(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "UP" and body["llm"]["mode"] == "stub"
    assert body["tasks"]["ready"] >= 2 and body["tasks"]["planned"] >= 1


def test_tasks_require_token(client):
    assert client.get("/v1/tasks").status_code == 401
    r = client.post("/v1/tasks/common.echo", json={"input": {"message": "x"}}, headers={"X-Internal-Token": "wrong"})
    assert r.status_code == 401 and r.json()["error"] == "Unauthorized"


def test_echo_roundtrip(client):
    r = client.post("/v1/tasks/common.echo", headers={**H, "X-Request-Id": "req-1"},
                    json={"input": {"message": "안녕"}, "context": {"app": "quote", "user": "a@sepoasoft.co.kr"}})
    assert r.status_code == 200
    body = r.json()
    assert body["output"] == {"message": "안녕", "app": "quote"}
    assert body["requestId"] == "req-1" and body["status"] == "OK"


def test_unknown_task_404(client):
    r = client.post("/v1/tasks/nope.x", headers=H, json={})
    assert r.status_code == 404 and r.json()["error"] == "UnknownTask" and r.json()["taskId"] == "nope.x"


def test_planned_task_501(client):
    r = client.post("/v1/tasks/daily_work.score_quality", headers=H, json={})
    assert r.status_code == 501 and "ROADMAP" in r.json()["message"]


def test_invalid_input_422(client):
    r = client.post("/v1/tasks/common.summarize", headers=H, json={"input": {"max_sentences": 3}})
    assert r.status_code == 422 and r.json()["error"] == "InvalidInput"


def test_summarize_stub(client):
    r = client.post("/v1/tasks/common.summarize", headers=H, json={"input": {"text": "견적 자동화는 영업팀이 쓴다."}})
    assert r.status_code == 200
    body = r.json()
    assert body["output"]["stub"] is True and body["output"]["summary"].startswith("[STUB]")
    assert body["usage"]["model"].startswith("stub:")


def test_anthropic_mode_without_key_is_explicit_error():
    tasks._REGISTRY.clear()
    c = TestClient(create_app(Settings(ai_engine_token=TOKEN, llm_mode="anthropic", anthropic_api_key="", _env_file=None)))
    r = c.post("/v1/tasks/common.summarize", headers=H, json={"input": {"text": "x"}})
    assert r.status_code == 502 and r.json()["error"] == "LlmError"


def test_task_list_shows_plan(client):
    ids = {t["id"]: t for t in client.get("/v1/tasks", headers=H).json()}
    assert ids["common.echo"]["status"] == "ready"
    assert ids["blog.write_draft"]["status"] == "planned"
    assert ids["daily_work.judge_anomaly"]["status"] == "planned"
