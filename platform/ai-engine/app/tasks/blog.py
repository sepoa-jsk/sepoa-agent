"""블로그작성 업무의 AI 작업 — ROADMAP 2단계에서 구현한다.

현행: apps/blog/backend (Claude Code 하네스: CLAUDE.md·DESIGN.md·스킬) 를 web-console 이
`claude -p` 로 실행한다. 이식 후: Java 블로그 앱이 아래 작업을 부르고, 하네스 규칙 문서는
이 엔진이 프롬프트로 읽는다. STOP 3곳(제목·키워드·이미지)의 사람 승인은 Java 앱 화면이 맡는다.
"""

from . import Task, register

_NOTE = "ROADMAP 2단계. 원본: apps/blog/backend 의 스킬"

for tid, desc in [
    ("blog.suggest_titles", "주제·원문에서 제목 후보 생성 (STOP 1: 사람이 선택)"),
    ("blog.suggest_keywords", "AEO/GEO 키워드 후보 (STOP 2)"),
    ("blog.write_draft", "확정된 제목·키워드로 본문 초안 작성"),
    ("blog.image_prompts", "본문 이미지용 프롬프트 생성 (STOP 3)"),
    ("blog.evaluate", "초안 규칙 검증 (evaluator)"),
]:
    register(Task(id=tid, app="blog", description=desc, status="planned", note=_NOTE))
