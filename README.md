# sepoa-agent

세포아소프트 업무 자동화 통합 프로젝트.
각 자동화 업무를 독립된 세트(프론트 + 백엔드)로 하위에 둔다.
새 자동화가 생기면 폴더를 하나 더 추가한다.

```
sepoa-agent/
├── blog-automation/        블로그 글 작성 자동화
│   ├── backend/            백엔드 — Claude Code 기반 작업 엔진 (규칙·스킬·검증)
│   └── web-console/        프론트 — 워드 업로드/주제 입력 화면
│
├── (예정) expense-automation/    경비 처리 자동화
├── (예정) contract-automation/   계약 처리 자동화
│
├── .gitignore
└── README.md
```

## 설계 원칙
- 자동화마다 화면이 제각각이므로, 각 자동화는 프론트+백엔드를 한 세트로 완결한다.
- 세트는 서로 독립적이다. 하나를 고쳐도 다른 자동화는 영향받지 않는다.
- 포트는 자동화마다 다르게 쓴다 (blog 4317, 이후 4318, 4319 …).
- 여러 세트에서 반복되는 UI 부품이 눈에 보이면, 그때 shared/ 로 뺀다.
  (지금은 하지 않는다 — 실제 중복이 확인될 때까지 기다린다.)

---

## blog-automation

### backend/
Claude Code 기반 작업 엔진. CLAUDE.md·DESIGN.md·스킬·evaluator 로 블로그 글을
규칙에 맞게 생산한다. STOP 3곳(제목·키워드·이미지)에서 사람이 승인한다.

### web-console/
백엔드를 화면으로 감싼 얇은 콘솔. 워드(.docx)를 올리거나 주제 한 줄을
입력하면, 뒤에서 백엔드가 실행되고 결과가 화면에 뜬다.

실행:
```
cd blog-automation/web-console
npm install        # 최초 1회
npm start          # http://localhost:4317
```

server.js 는 형제 폴더 `../backend` 를 백엔드로 사용한다.
경로를 바꾸려면 환경변수 HARNESS_DIR 로 지정한다.

준비물: Node.js 18+, Claude Code(로그인 상태), pandoc(워드 읽기).
