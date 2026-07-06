/**
 * web-console/server.js
 * ------------------------------------------------------------------
 * 웹 화면 ↔ 기존 sepoa-blog-harness(Claude Code) 를 잇는 "얇은 서버".
 *
 * 이 서버는 직접 글을 쓰지 않는다. 오직:
 *   1) 화면에서 올린 워드 파일을 하네스의 inbox/ 에 저장하고
 *   2) 버튼에 맞는 `claude -p "..."` 명령을 대신 실행하고
 *   3) 그 결과(제목 3안 등)를 화면으로 돌려준다.
 *
 * 실제 규칙(합니다체, • 불릿, STOP, maker≠checker)은 전부
 * 기존 하네스 안에 있고, 여기서는 손대지 않는다.
 * ------------------------------------------------------------------
 */

const express = require("express");
const multer = require("multer");
const spawn = require("cross-spawn");
const fs = require("fs");
const path = require("path");

// ── 설정: 기존 하네스 폴더 경로 ────────────────────────────────────
// 이 콘솔(web-console)과 하네스(sepoa-blog-harness)는 형제 폴더다.
//   E:\Project\web-console\   ← 여기서 실행
//   E:\Project\sepoa-blog-harness\
// 따라서 부모 폴더(..)로 올라가 옆의 sepoa-blog-harness 를 찾는다.
// 다른 곳에 두려면 환경변수 HARNESS_DIR 로 지정한다.
//   Windows 예) set HARNESS_DIR=E:\어딘가\sepoa-blog-harness
const HARNESS_DIR =
  process.env.HARNESS_DIR || path.resolve(__dirname, "..", "sepoa-blog-harness");
const INBOX_DIR = path.join(HARNESS_DIR, "inbox");
const PORT = process.env.PORT || 4317;

// inbox 폴더 없으면 만든다
fs.mkdirSync(INBOX_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 업로드된 워드는 하네스의 inbox/ 로 바로 저장
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, INBOX_DIR),
    filename: (req, file, cb) => {
      // 한글 파일명 깨짐 방지 + 최신 파일 식별용 날짜 프리픽스
      const safe = Buffer.from(file.originalname, "latin1").toString("utf8");
      cb(null, safe);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ── 세션 저장소 (STOP 지점 사이에 대화를 이어가기 위함) ──────────────
// 브라우저 탭 1개 = 작업 1건. sessionId 로 Claude Code 세션을 resume 한다.
const sessions = {}; // { [browserKey]: { claudeSessionId } }

// ── 실행 중인 프로세스 저장소 (화면의 "중지" 버튼용) ────────────────
// 브라우저 탭 1개 = 실행 1건이므로 browserKey 로 지금 돌고 있는 child 를 찾는다.
const runningProcs = {}; // { [browserKey]: { child, stopped } }

// Windows 에서는 npx.cmd → cmd.exe → node → claude 로 여러 프로세스가 딸려
// 나오므로, child.kill() 로는 최상위 cmd.exe 만 죽고 나머지가 고아 프로세스로
// 남는다. taskkill /t 로 프로세스 트리 전체를 종료한다.
function killProcessTree(child) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
  } else {
    child.kill("SIGTERM");
  }
}

/**
 * Claude Code 를 headless(-p)로 한 번 실행한다.
 * @param {string} prompt        Claude 에게 줄 지시(스킬 호출 포함)
 * @param {string|null} resumeId 이전 Claude 세션 id (이어가기)
 * @param {string} browserKey    실행 중인 프로세스를 등록할 키 ("중지" 버튼용)
 * @returns {Promise<{text:string, sessionId:string}>}
 */
function runClaude(prompt, resumeId, browserKey) {
  return new Promise((resolve, reject) => {
    // 이 워크플로에서 하네스가 필요로 하는 도구만 허용한다.
    // 파일 읽기/쓰기(초안 저장)와 pandoc(워드 읽기)용 Bash 정도.
    // 주의: 프롬프트는 stdin 이 아니라 인자로 직접 넘긴다.
    //   → -p 를 값 없이 두고 stdin 으로 넘기는 방식은 종료 코드 1로 실패했다.
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--allowedTools",
      "Read,Edit,Write,Glob,Grep,Bash(pandoc *),Bash(soffice *)",
      "--permission-mode",
      "acceptEdits", // 파일 편집은 자동 승인 (사람 승인은 화면 STOP에서 별도로 함)
      "--max-turns",
      "30", // 폭주 방지 안전장치
    ];
    if (resumeId) {
      args.push("--resume", resumeId);
    }

    // 전역 설치된 claude.cmd 를 경로로 직접 실행한다 (npx 오버헤드 제거).
    //  - cross-spawn 은 .cmd(배치) 를 shell 없이 실행하면서도 cmd.exe / CRT argv
    //    파서 양쪽 규칙에 맞게 각 인자를 정확히 이스케이프해준다.
    //  - HARNESS_DIR 안에서 실행해야 CLAUDE.md/스킬/DESIGN.md 를 자동 로드한다.
    const CLAUDE_BIN = "C:\\Users\\sepoa\\AppData\\Roaming\\npm\\claude.cmd";
    const child = spawn(CLAUDE_BIN, args, {
      cwd: HARNESS_DIR,
      env: process.env,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const startedAt = Date.now(); // CLI가 duration을 안 주는 경우의 대비용
    const procEntry = { child, stopped: false };
    if (browserKey) runningProcs[browserKey] = procEntry;

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    child.on("error", (e) => {
      if (browserKey && runningProcs[browserKey] === procEntry) delete runningProcs[browserKey];
      reject(
        new Error(
          "claude 실행 실패. 'claude --version' 이 되는 터미널에서 npm start 하세요. 원인: " +
            e.message
        )
      );
    });

    child.on("close", (code) => {
      if (browserKey && runningProcs[browserKey] === procEntry) delete runningProcs[browserKey];

      if (procEntry.stopped) {
        return reject(new Error("사용자가 중지했습니다."));
      }
      if (code !== 0 && !out) {
        return reject(new Error(`claude 종료 코드 ${code}\n${err}`));
      }
      const elapsedMs = Date.now() - startedAt;
      // --output-format json 이면 마지막 result 객체가 나온다.
      // (duration_ms/num_turns/total_cost_usd/usage 도 함께 들어 있다)
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
        // json 파싱 실패 시 원문 그대로 반환
        resolve({
          text: out || err,
          sessionId: resumeId ?? null,
          meta: { durationMs: elapsedMs, numTurns: null, costUsd: null, usage: null },
        });
      }
    });
  });
}

// ── 각 단계별 프롬프트 (기존 하네스의 스킬을 그대로 호출) ─────────────
// 화면 버튼 → 여기 프롬프트 → 하네스 스킬 실행. 규칙은 스킬 안에 있다.
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

  // STOP2 통과 → 본문 작성 (자동 검증까지)
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

  // 이 브라우저의 이전 Claude 세션 id (이어가기용)
  const prev = sessions[browserKey]?.claudeSessionId || null;

  // 단계 → 프롬프트 결정
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
    // 첫 단계(start_*)는 새 세션, 이후는 resume 로 대화를 이어간다.
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
  console.log(`  화면:     http://localhost:${PORT}`);
  console.log(`  하네스:   ${HARNESS_DIR}`);
  console.log(`  inbox:    ${INBOX_DIR}\n`);
});
