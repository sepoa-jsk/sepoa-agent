# 세포아 블로그 콘솔 (web-console)

화면에서 **워드를 올리거나 주제 한 줄을 입력하면**, 뒤에서 기존
`sepoa-blog-harness`(Claude Code)가 그대로 실행되는 얇은 웹 콘솔입니다.

- 하네스는 **한 줄도 고치지 않습니다.** 규칙(합니다체, • 불릿, STOP 3곳,
  maker≠checker)은 전부 하네스 안에 그대로 있고, 이 콘솔은 그 앞에 씌우는
  리모컨일 뿐입니다.
- 화면 버튼 → `claude -p "..."` 실행 → 결과를 화면에 표시. 이게 전부입니다.

---

## 폴더 배치

```
E:\Project\
├── sepoa-blog-harness\      ← 기존 하네스 (그대로)
│   ├── CLAUDE.md
│   ├── spec.md
│   ├── .claude\...
│   └── inbox\               ← 업로드된 워드가 여기 저장됨
└── web-console\             ← 이 폴더 (새로 추가)
    ├── server.js
    ├── package.json
    └── public\index.html
```

`web-console`을 `sepoa-blog-harness`와 **같은 부모 폴더**에 두면 경로가 자동으로
맞습니다. 다른 곳에 두려면 아래 환경변수로 하네스 경로를 지정하세요.

---

## 준비 (최초 1회)

1. **Node.js 18+** 설치 (이미 있으면 생략).
2. **Claude Code** 설치 및 로그인 확인 — 터미널에서 `claude` 가 실행돼야 합니다.
   (구독형이면 `claude` 로그인만으로 API 키 없이 동작합니다.)
3. **pandoc** 설치 — 워드(.docx) 읽기에 필요합니다.
   - Windows: `winget install pandoc` 또는 https://pandoc.org/installing.html
4. 콘솔 의존성 설치:
   ```
   cd E:\Project\web-console
   npm install
   ```

---

## 실행

```
cd E:\Project\web-console
npm start
```

브라우저에서 http://localhost:4317 접속.

하네스가 다른 경로에 있으면:
```
set HARNESS_DIR=E:\어딘가\sepoa-blog-harness
npm start
```
(PowerShell이면 `$env:HARNESS_DIR="..."`)

---

## 사용 흐름 (화면에서)

1. **진입 방식 선택**
   - `워드 초안 올리기` — .docx를 끌어다 놓고 "읽고 제목 추천받기"
   - `주제만 입력하기` — "OO 주제로 써줘" 입력 후 "주제로 시작하기"
2. **STOP 1 — 제목 선택**: 하네스가 제목 3안을 화면에 띄웁니다. 1/2/3 버튼으로 선택.
3. **STOP 2 — 키워드 승인**: SEO 키워드 배치안을 확인하고 "승인" 클릭.
4. 하네스가 본문 초안을 `drafts/`에, 이미지 프롬프트를 `images/`에 저장합니다.
5. **STOP 3 — 이미지 텍스트 승인**: 이미지 내 문구를 확인하고 "승인" 클릭.
6. evaluator가 최종 검증(PASS/FAIL). **발행은 자동으로 하지 않습니다** —
   네이버에는 사람이 직접 올립니다. (4부 '사람 승인 게이트' 원칙)

각 단계는 Claude Code 세션을 `--resume`으로 이어가므로, 앞 단계의 맥락이
그대로 유지됩니다.

---

## 동작 원리 (한 장 요약)

```
[화면] 업로드/버튼
   │  HTTP
   ▼
[server.js]  파일을 inbox/에 저장 + claude -p "스킬 호출" 실행 (cwd=하네스)
   │  stdout(json)
   ▼
[Claude Code]  CLAUDE.md·스킬·DESIGN.md·evaluator 로드 → 해당 STOP까지 실행 후 정지
   │  결과 텍스트
   ▼
[화면]  결과 표시 + 다음 STOP 승인 버튼
```

- 서버는 글을 쓰지 않습니다. 파일 저장과 명령 실행·중계만 합니다.
- 실제 판단·작성·검증은 전부 하네스가 합니다.

---

## 주의

- `server.js`의 `--allowedTools`는 이 워크플로에 필요한 도구(파일 읽기/쓰기,
  pandoc)만 열어둡니다. 넓히지 마세요. 넓힐수록 무인 실행 위험이 커집니다.
- 이 콘솔은 **로컬(내 PC) 전용**을 전제로 만들었습니다. 사내 서버/여러 명이
  쓰려면 인증·큐·동시성 처리가 추가로 필요하며, 그 경우 2번(API 웹앱) 방식이
  더 적합합니다.
- Claude Code 헤드리스 실행은 구독 사용량을 소모합니다. `server.js`의
  `--max-turns 30`이 폭주 방지 장치입니다.
