/**
 * web-console/server.js
 * ------------------------------------------------------------------
 * 웹 화면 ↔ 백엔드(Claude Code 하네스) 를 잇는 "얇은 서버".
 *
 * 이 서버는 직접 글을 쓰지 않는다. 오직:
 *   1) 화면에서 올린 워드 파일을 백엔드의 inbox/ 에 저장하고
 *   2) 버튼에 맞는 `claude -p "..."` 명령을 대신 실행하고
 *   3) 그 결과(제목 3안 등)를 화면으로 돌려준다.
 *
 * 실제 규칙(합니다체, • 불릿, STOP, maker≠checker)은 전부
 * 백엔드 하네스 안에 있고, 여기서는 손대지 않는다.
 *
 * ▶ 배포/이식성:
 *   경로·포트·실행 파일 등 환경마다 달라지는 값은 전부 .env 로 뺐다.
 *   서버(리눅스)에 올릴 때는 코드를 건드리지 말고 .env 만 바꾼다.
 *   OS(Windows/Linux)는 자동 감지하여 실행 방식을 분기한다.
 * ------------------------------------------------------------------
 */

require("dotenv").config(); // .env 로드 (없으면 조용히 무시)

const express = require("express");
const multer = require("multer");
const spawn = require("cross-spawn");
const fs = require("fs");
const path = require("path");

const IS_WIN = process.platform === "win32";

// ── 환경설정 (.env → 없으면 안전한 기본값) ─────────────────────────
// BACKEND_DIR: 백엔드(하네스) 폴더. 비어있으면 콘솔의 형제 폴더 ../backend.
const BACKEND_DIR = process.env.BACKEND_DIR
  ? path.resolve(process.env.BACKEND_DIR)
  : path.resolve(__dirname, "..", "backend");

// CLAUDE_BIN: claude 실행 명령/경로. 비어있으면 OS 기본값.
//   Windows 는 claude.cmd(배치), 그 외는 claude.
const CLAUDE_BIN =
  process.env.CLAUDE_BIN && process.env.CLAUDE_BIN.trim()
    ? process.env.CLAUDE_BIN.trim()
    : IS_WIN
    ? "claude.cmd"
    : "claude";

const PORT = parseInt(process.env.PORT || "4317", 10);
const MAX_TURNS = process.env.MAX_TURNS || "30";
const ALLOWED_TOOLS =
  process.env.ALLOWED_TOOLS ||
  "Read,Edit,Write,Glob,Grep,Bash(pandoc *),Bash(soffice *)";
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "20", 10);

const INBOX_DIR = path.join(BACKEND_DIR, "inbox");

// ── 시작 시 설정 검증 (문제를 일찍, 명확히 드러낸다) ────────────────
if (!fs.existsSync(BACKEND_DIR)) {
  console.error(
    `[설정 오류] BACKEND_DIR 이 존재하지 않습니다:\n  ${BACKEND_DIR}\n` +
      `.env 의 BACKEND_DIR 을 실제 백엔드 폴더 경로로 지정하세요.`
  );
  process.exit(1);
}
// inbox 폴더 없으면 만든다 (백엔드 폴더는 있어야 하지만 inbox 는 자동 생성 허용)
fs.mkdirSync(INBOX_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 업로드된 워드는 백엔드의 inbox/ 로 바로 저장
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, INBOX_DIR),
    filename: (req, file, cb) => {
      // 한글 파일명 깨짐 방지
      const safe = Buffer.from(file.originalname, "latin1").toString("utf8");
      cb(null, safe);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// ── 세션 저장소 (STOP 지점 사이에 대화를 이어가기 위함) ──────────────
// 브라우저 탭 1개 = 작업 1건. sessionId 로 Claude Code 세션을 resume 한다.
const sessions = {}; // { [browserKey]: { claudeSessionId } }

// ── 실행 중인 프로세스 저장소 (화면의 "중지" 버튼용) ────────────────
const runningProcs = {}; // { [browserKey]: { child, stopped } }

// 프로세스 트리 종료 (OS별 분기)
//  - Windows: npx/cmd/node/claude 가 트리로 딸려 나오므로 taskkill /t 로 전체 종료.
//  - Linux/Mac: 프로세스 그룹에 SIGTERM (spawn 시 detached 로 그룹 분리해 둔다).
function killProcessTree(child) {
  try {
    if (IS_WIN) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    } else {
      // 음수 pid = 프로세스 그룹 전체에 시그널
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (e) {
    // 이미 종료된 경우 등은 무시
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

/**
 * Claude Code 를 headless(-p)로 한 번 실행한다.
 * @param {string} prompt        Claude 에게 줄 지시(스킬 호출 포함)
 * @param {string|null} resumeId 이전 Claude 세션 id (이어가기)
 * @param {string} browserKey    실행 중인 프로세스를 등록할 키 ("중지" 버튼용)
 * @returns {Promise<{text:string, sessionId:string, meta:object}>}
 */
function runClaude(prompt, resumeId, browserKey) {
  return new Promise((resolve, reject) => {
    // 이 워크플로에서 백엔드가 필요로 하는 도구만 허용한다.
    // 프롬프트는 stdin 이 아니라 인자로 직접 넘긴다(stdin 방식은 종료코드 1로 실패).
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--allowedTools",
      ALLOWED_TOOLS,
      "--permission-mode",
      "acceptEdits", // 파일 편집 자동 승인 (사람 승인은 화면 STOP에서 별도로 함)
      "--max-turns",
      MAX_TURNS,
    ];
    if (resumeId) {
      args.push("--resume", resumeId);
    }

    // cross-spawn: Windows .cmd 실행과 인자 이스케이프를 OS 무관하게 처리.
    // BACKEND_DIR 안에서 실행해야 CLAUDE.md/스킬/DESIGN.md 를 자동 로드한다.
    // Linux 에서는 detached:true 로 프로세스 그룹을 분리해, 중지 시 트리 전체 종료.
    const child = spawn(CLAUDE_BIN, args, {
      cwd: BACKEND_DIR,
      env: process.env,
      detached: !IS_WIN,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const startedAt = Date.now();
    const procEntry = { child, stopped: false };
    if (browserKey) runningProcs[browserKey] = procEntry;

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    child.on("error", (e) => {
      if (browserKey && runningProcs[browserKey] === procEntry)
        delete runningProcs[browserKey];
      reject(
        new Error(
          `claude 실행 실패. CLAUDE_BIN 설정과 claude 설치를 확인하세요 ` +
            `(현재 CLAUDE_BIN="${CLAUDE_BIN}"). 원인: ${e.message}`
        )
      );
    });

    child.on("close", (code) => {
      if (browserKey && runningProcs[browserKey] === procEntry)
        delete runningProcs[browserKey];

      if (procEntry.stopped) {
        return reject(new Error("사용자가 중지했습니다."));
      }
      if (code !== 0 && !out) {
        return reject(new Error(`claude 종료 코드 ${code}\n${err}`));
      }
      const elapsedMs = Date.now() - startedAt;
      // --output-format json: 마지막 result 객체(+ duration_ms/num_turns/cost/usage)
      try {
        const parsed = JSON.parse(out);
        resolve({
          text: parsed.result ?? out,
          sessionId: parsed.session_id ?? resumeId ?? null,
          meta: {
            durationMs: parsed.duration_ms ?? elapsedMs,
            numTurns: parsed.num_turns ?? null,
            costUsd: parsed.total_cost_usd ?? null,
            usage: parsed.usage ?? null,
          },
        });
      } catch {
        resolve({
          text: out || err,
          sessionId: resumeId ?? null,
          meta: {
            durationMs: elapsedMs,
            numTurns: null,
            costUsd: null,
            usage: null,
          },
        });
      }
    });
  });
}

// ── 각 단계별 프롬프트 (백엔드 하네스의 스킬을 그대로 호출) ───────────
const STEP_PROMPTS = {
  // 입구 A: 워드 업로드형 — inbox 초안을 읽고 제목 3안 (STOP1)
  start_from_docx:
    "inbox/ 에서 가장 최근 .docx 초안을 읽고, 그 내용을 근거로 spec.md 를 채운 뒤 " +
    "/title-select 를 실행해 제목 3안을 제시하고 STOP 하라. 아직 다음 단계로 넘어가지 마라.",

  // 입구 B: 채팅 한 줄형 — 주제를 확장해 spec.md 채우고 제목 3안 (STOP1)
  start_from_topic: (topic) =>
    `다음 주제로 블로그를 시작한다: "${topic}". 이 주제를 앵글·타깃 독자·핵심 메시지로 ` +
    "확장해 spec.md 를 채운 뒤 /title-select 로 제목 3안을 제시하고 STOP 하라. " +
    "아직 다음 단계로 넘어가지 마라.",

  // STOP1 통과 → 키워드 (STOP2)
  pick_title: (choice) =>
    `사람이 제목 ${choice}번을 선택했다. 선택된 제목을 확정하고 /keyword-approve 를 실행해 ` +
    "SEO 키워드 후보와 배치안을 제시하고 STOP 하라.",

  // STOP2 통과 → 본문 작성 + 이미지 프롬프트 (STOP3)
  approve_keywords:
    "사람이 키워드를 승인했다. /write-body 로 본문 초안을 drafts/ 에 저장한 뒤, " +
    "이어서 /image-prompt 로 이미지 프롬프트를 만들고 이미지 내 텍스트를 제시하며 STOP 하라.",

  // STOP3 통과 → 이미지 텍스트 승인 후 최종 검증
  approve_images:
    "사람이 이미지 내 텍스트를 승인했다. evaluator 서브에이전트로 최종 검증을 실행하고, " +
    "PASS 면 '발행 준비 완료'를, FAIL 이면 무엇을 고쳐야 하는지 보고하라. 발행은 하지 마라.",

  // 어느 STOP에서든: 사람이 수정을 요청하면 그 단계 결과물만 고쳐서 다시 STOP
  revise: (feedback) =>
    `사람이 방금 제시한 결과물에 수정을 요청했다: "${feedback}". ` +
    "요청을 반영해 현재 단계의 결과물을 수정한 뒤, 같은 형식으로 다시 제시하고 STOP 하라. " +
    "다음 단계로 넘어가지 마라.",
};

// ── 라우트: 워드 업로드 (입구 A 준비) ──────────────────────────────
app.post("/api/upload", upload.single("draft"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 없습니다." });
  res.json({ ok: true, filename: req.file.filename });
});

// ── 라우트: 단계 실행 ────────────────────────────────────────────
app.post("/api/step", async (req, res) => {
  const { browserKey, step, topic, choice, feedback } = req.body;
  if (!browserKey || !step)
    return res.status(400).json({ error: "browserKey/step 필요" });

  const prev = sessions[browserKey]?.claudeSessionId || null;

  let prompt;
  switch (step) {
    case "start_from_docx":
      prompt = STEP_PROMPTS.start_from_docx;
      break;
    case "start_from_topic":
      if (!topic) return res.status(400).json({ error: "주제를 입력하세요." });
      prompt = STEP_PROMPTS.start_from_topic(topic);
      break;
    case "pick_title":
      prompt = STEP_PROMPTS.pick_title(choice);
      break;
    case "approve_keywords":
      prompt = STEP_PROMPTS.approve_keywords;
      break;
    case "approve_images":
      prompt = STEP_PROMPTS.approve_images;
      break;
    case "revise":
      if (!feedback)
        return res.status(400).json({ error: "수정 요청 내용을 입력하세요." });
      if (!prev)
        return res.status(400).json({ error: "진행 중인 작업이 없습니다." });
      prompt = STEP_PROMPTS.revise(feedback);
      break;
    default:
      return res.status(400).json({ error: "알 수 없는 step" });
  }

  try {
    const isStart = step.startsWith("start_");
    const { text, sessionId, meta } = await runClaude(
      prompt,
      isStart ? null : prev,
      browserKey
    );
    if (sessionId) {
      sessions[browserKey] = { claudeSessionId: sessionId };
    }
    res.json({ ok: true, text, meta });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 라우트: 실행 중인 단계 중지 ────────────────────────────────────
app.post("/api/stop", (req, res) => {
  const { browserKey } = req.body;
  const entry = browserKey && runningProcs[browserKey];
  if (!entry) return res.json({ ok: true, stopped: false });
  entry.stopped = true;
  killProcessTree(entry.child);
  res.json({ ok: true, stopped: true });
});

app.listen(PORT, () => {
  console.log(`\n세포아 블로그 콘솔 실행 중`);
  console.log(`  OS:       ${process.platform}`);
  console.log(`  화면:     http://localhost:${PORT}`);
  console.log(`  백엔드:   ${BACKEND_DIR}`);
  console.log(`  inbox:    ${INBOX_DIR}`);
  console.log(`  claude:   ${CLAUDE_BIN}\n`);
});
