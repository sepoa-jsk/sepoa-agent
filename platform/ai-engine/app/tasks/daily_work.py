"""일일업무관리 업무의 AI 작업 — ROADMAP 3단계에서 work_agent(Python)에서 옮겨 온다.

역할 분담: 수집(그룹웨어 Oracle)·사원정보·화면·승인·메일 발송은 Java 일일업무 앱(apps/daily-work)이,
채점·이상 판단·초안 생성·가드레일은 이 엔진이 맡는다. 원본 위치는 각 note 에 적었다.
"""

from . import Task, register

for tid, desc, src in [
    ("daily_work.score_quality", "일일업무 기록 품질 채점 (루브릭)", "work_agent: modules/diag/{scoring,rubric}.py, modules/daily_work/rubric.md"),
    ("daily_work.judge_anomaly", "부실·이상 2차 판단", "work_agent: modules/diag/judge*.py, prompts/anomaly.md"),
    ("daily_work.assess_workload", "업무량 판정", "work_agent: modules/daily_work/analyzer.py, workload_criteria.md"),
    ("daily_work.draft_feedback", "개인 피드백·주간 피드백 초안", "work_agent: prompts/weekly_feedback.md, modules/diag/mail_text.py"),
    ("daily_work.draft_manager_report", "관리자 리포트 초안", "work_agent: prompts/manager_report.md, modules/diag/report.py"),
    ("daily_work.sales_insight", "영업 일지 인사이트", "work_agent: modules/daily_work/sales.py"),
    ("daily_work.guardrail_check", "발송 전 초안 가드레일 검사", "work_agent: core/guardrails.py"),
    ("daily_work.ask", "관리자 질의응답", "work_agent: modules/chat/"),
]:
    register(Task(id=tid, app="daily_work", description=desc, status="planned", note=f"ROADMAP 3단계. 원본 {src}"))
