# archive — 지난 계획 문서

현행 문서가 아니다. **읽기 전용 히스토리**이며, 현재 유효한 문서는 아래 두 곳이다.

- `quote/CLAUDE.md` — 프로젝트 규칙
- `quote/docs/WBS.md` — 개편 실행계획 (현행)

## 문서별 시기·성격

| 문서 | 시기 | 내용 | 상태 |
|---|---|---|---|
| `PLAN.md` | Phase 0~4 | 견적 시스템 최초 설계 — 3계층(견적/섹션/품목) 구조, 가격정책 4모델 | 대체됨 |
| `PROMPT.md` | Phase 0~4 | 위 PLAN 실행용 지시문 | 종료 |
| `PLAN_PHASE5.md` | Phase 5 초안 | 블록형 개편 1차안 | **폐기** — REV 로 대체 |
| `PROMPT_PHASE5.md` | Phase 5 초안 | 위 초안 실행용 지시문 | **폐기** |
| `PLAN_PHASE5_REV.md` | Phase 5 승인본 | 견적유형·블록·인건비·PDF 재설계. 실측 견적서 5종 분석 근거 | 구현 완료 |
| `PROMPT_PHASE5_REV.md` | Phase 5 승인본 | 위 REV 실행용 지시문 | 종료 |
| `작업계획서_견적자동화_BUILD.md` | Phase 5-A~5-D | REV 를 실행 체크리스트로 분해한 문서. 5-A~5-D 전 항목 완료 기록과 실측 검증값 포함 | 완료 |

## 왜 남겨두나

`PLAN_PHASE5_REV.md` 와 `작업계획서_견적자동화_BUILD.md` 는 **현행 코드의 설계 근거**다.
블록 7종 구성, 계산 순서(소계합→특별DC→절사→VAT), 실측 재현값이 여기서 나왔다.
`test/quote-block.test.js` 의 기대값을 의심할 일이 생기면 이 두 문서와 `assets/인장/*.pdf` 를 본다.

초안 2종(`PLAN_PHASE5.md` / `PROMPT_PHASE5.md`)은 REV 가 명시적으로 폐기했으나,
어떤 판단으로 뒤집혔는지 추적할 수 있게 남긴다.
