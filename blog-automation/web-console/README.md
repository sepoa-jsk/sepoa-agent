# web-console

화면에서 워드를 올리거나 주제 한 줄을 입력하면, 뒤에서 백엔드
(Claude Code 하네스)가 실행되고 결과가 화면에 뜨는 얇은 콘솔.

환경마다 달라지는 값(경로·포트·실행파일)은 전부 `.env` 로 관리한다.
**코드는 어느 환경에서도 그대로. 서버에 올릴 때 `.env` 만 바꾼다.**
OS(Windows/Linux)는 자동 감지한다.

---

## 준비

### 공통
- Node.js 18+
- Claude Code (로그인 상태) — `claude --version` 이 되어야 함
- pandoc (워드 읽기)

### 설치
```
npm install
```

### 환경설정
`.env.example` 을 복사해 `.env` 를 만들고 값을 채운다.
```
# Windows
copy .env.example .env
# Linux/Mac
cp .env.example .env
```

`.env` 는 git 에 올라가지 않는다(.gitignore 포함). 서버마다 따로 만든다.

---

## 실행
```
npm start
```
시작 시 콘솔에 실제 적용된 경로·포트·claude 위치가 찍힌다. 확인 후 접속.

---

## 환경별 .env 예시

### Windows (개발 PC)
```
BACKEND_DIR=E:\Project\sepoa-agent\blog-automation\backend
CLAUDE_BIN=C:\Users\사용자\AppData\Roaming\npm\claude.cmd
PORT=4317
```
- `CLAUDE_BIN` 을 비우면 자동으로 "claude.cmd" 를 쓴다. PATH 에 잡히면
  이름만으로 충분하고, 아니면 위처럼 절대경로를 넣는다.
- `BACKEND_DIR` 을 비우면 콘솔의 형제 폴더 `../backend` 를 쓴다.
  (표준 구조라면 비워둬도 된다.)

### Linux (배포 서버)
```
BACKEND_DIR=/srv/sepoa-agent/blog-automation/backend
CLAUDE_BIN=/usr/local/bin/claude
PORT=4317
```
- `CLAUDE_BIN` 을 비우면 자동으로 "claude" 를 쓴다. PATH 에 있으면 비워도 됨.
  전역 npm 경로에 있으면 `which claude` 로 확인해 절대경로를 넣는다.
  (예: /home/deploy/.npm-global/bin/claude)

---

## 리눅스 서버 배포 메모

- **claude 로그인 유지**: 서버에서 `claude` 가 인증된 상태여야 headless(-p)
  실행이 된다. 배포 계정으로 한 번 `claude` 로그인을 해 둔다.
- **pandoc 설치**: `sudo apt-get install -y pandoc`
- **프로세스 관리**: 상시 구동은 pm2 나 systemd 로 띄운다.
  ```
  # pm2 예
  npm install -g pm2
  pm2 start server.js --name sepoa-blog-console
  pm2 save
  ```
- **중지 처리**: 화면의 "중지" 버튼은 리눅스에서 프로세스 그룹(SIGTERM)으로
  claude 트리를 종료한다. detached 실행이 전제이므로 코드는 그대로 두면 된다.
- **포트/역프록시**: 외부 노출 시 nginx 등으로 프록시하고 인증을 앞단에 둔다.
  (이 콘솔 자체엔 인증이 없다 — 내부망/프록시 뒤 사용 전제.)

---

## .env 로 제어되는 값
| 키 | 설명 | 비우면 |
|---|---|---|
| BACKEND_DIR | 백엔드(하네스) 폴더 | `../backend` |
| CLAUDE_BIN | claude 실행 명령/경로 | Win=claude.cmd, else=claude |
| PORT | 서버 포트 | 4317 |
| MAX_TURNS | 단계별 최대 턴(폭주 방지) | 30 |
| ALLOWED_TOOLS | claude 허용 도구 | 최소 세트 |
| MAX_UPLOAD_MB | 업로드 최대 크기(MB) | 20 |
