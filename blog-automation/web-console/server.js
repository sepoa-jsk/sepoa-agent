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

// .env(있으면)를 먼저 읽어 환경변수로 올린다. 없으면 조용히 넘어가고
// 아래의 기본값(fallback)을 그대로 쓴다.
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const spawn = require("cross-spawn");
const fs = require("fs");
const path = require("path");

// ── 설정: 기존 하네스 폴더 경로 ────────────────────────────────────
// 이 콘솔(web-console)과 하네스(backend)는 형제 폴더다.
//   E:\Project\web-console\   ← 여기서 실행
//   E:\Project\sepoa-blog-harness\
// 따라서 부모 폴더(..)로 올라가 옆의 sepoa-blog-harness 를 찾는다.
// 다른 곳에 두려면 환경변수 HARNESS_DIR 로 지정한다.
//   Windows 예) set HARNESS_DIR=E:\어딘가\sepoa-blog-harness
const HARNESS_DIR =
  process.env.HARNESS_DIR || path.resolve(__dirname, "..", "backend");
const INBOX_DIR = path.join(HARNESS_DIR, "inbox");
// DRAFTS_DIR: write-body 스킬이 본문 초안을 저장하는 곳 (/api/draft 가 읽는다).
const DRAFTS_DIR = path.join(HARNESS_DIR, "drafts");
// IMAGE_PROMPTS_DIR: image-prompt 스킬 산출물의 새 표준 위치.
//   기존에는 images/ 폴더에 저장했지만, 앞으로는 여기를 쓴다.
const IMAGE_PROMPTS_DIR = path.join(HARNESS_DIR, "image-prompts");
// UPLOADED_IMAGES_DIR: 사람이 Gemini/ChatGPT 로 만들어 직접 업로드한 이미지.
const UPLOADED_IMAGES_DIR = path.join(HARNESS_DIR, "uploaded-images");
// REFERENCES_DIR: 입구 B(주제 입력)에서 함께 올린 참고 이미지·문서.
//   start_from_topic 프롬프트가 이 폴더를 확인해 사실 근거로 활용한다.
const REFERENCES_DIR = path.join(HARNESS_DIR, "references");
const PORT = process.env.PORT || 4317;

// claude 에게 허용할 도구. .env 의 ALLOWED_TOOLS 로 덮어쓸 수 있고, 없으면
// 아래 기본값을 쓴다. Read 는 이미지·PDF·txt·md 를 직접 읽고, docx 는
// Bash(pandoc/soffice), PDF 텍스트 추출은 Bash(pdftotext) 로 보완한다.
const ALLOWED_TOOLS =
  process.env.ALLOWED_TOOLS ||
  "Read,Edit,Write,Glob,Grep,Bash(pandoc *),Bash(soffice *),Bash(pdftotext *)";

// 화면에서 고를 수 있는 모델 별칭. 이 목록 밖의 값은 무시하고 claude 기본
// 모델로 실행한다(임의 문자열이 --model 로 넘어가는 것을 막는 안전장치).
const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku", "fable"]);

// 요청된 모델 별칭을 검증한다. 허용 목록에 있으면 그대로 반환, 아니면 null.
function resolveModel(requested) {
  return ALLOWED_MODELS.has(requested) ? requested : null;
}

// 아래 폴더들은 없으면 자동 생성한다.
fs.mkdirSync(INBOX_DIR, { recursive: true });
fs.mkdirSync(DRAFTS_DIR, { recursive: true });
fs.mkdirSync(IMAGE_PROMPTS_DIR, { recursive: true });
fs.mkdirSync(UPLOADED_IMAGES_DIR, { recursive: true });
fs.mkdirSync(REFERENCES_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// 사람이 업로드한 이미지를 화면에서 바로 볼 수 있게 정적 서빙
app.use("/uploaded-images", express.static(UPLOADED_IMAGES_DIR));
// 입구 B 참고 자료도 화면에서 미리보기 할 수 있게 정적 서빙
app.use("/references", express.static(REFERENCES_DIR));

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

// ── 결과물 조회/이미지 업로드용 헬퍼 ────────────────────────────────

// slug 는 파일 경로 조합에 쓰이므로, 폴더 이탈(../ 등)을 막기 위해
// 영문·숫자·점·하이픈·밑줄만 허용한다(날짜-슬러그 형식과 자연히 맞는다).
function isSafeSlug(slug) {
  return typeof slug === "string" && /^[A-Za-z0-9._-]+$/.test(slug);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// dir 안에서 가장 최근에 수정된 .md 파일 이름을 반환한다 (없으면 null).
function mostRecentMdFile(dir) {
  const mdFiles = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".md"));
  if (mdFiles.length === 0) return null;
  let latest = null;
  let latestMtime = -Infinity;
  for (const name of mdFiles) {
    const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
    if (mtime > latestMtime) {
      latestMtime = mtime;
      latest = name;
    }
  }
  return latest;
}

// spec.md 를 "골격만 남긴 초기 템플릿"으로 되돌리는 문자열을 만든다.
//  - 최상단 서문(# 제목, > 안내 등 첫 ## 이전 줄)은 그대로 유지.
//  - 각 ## 항목 헤더는 유지하되 그 아래 값(내용)은 비운다.
//  - ## 항목을 못 찾으면 한 줄짜리 대기 템플릿으로 대체한다.
function buildSpecSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const hasH2 = lines.some((l) => /^##\s/.test(l));
  if (!hasH2) return "# spec.md — 새 작업 대기 중\n";
  const out = [];
  let firstH2seen = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      firstH2seen = true;
      out.push(line, ""); // 항목명 유지 + 값 비움
    } else if (!firstH2seen) {
      out.push(line); // 첫 항목 이전 서문은 유지
    }
    // 첫 ## 이후의 비-헤더 줄(=기존 값)은 버린다.
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

// 이미지 업로드는 multer.diskStorage 의 filename 콜백만으로는 같은 요청 안의
// 여러 파일에 순번을 안전하게 매기기 어렵다(요청 바디의 slug 필드가 파일
// 파트보다 늦게 도착할 수 있음). 그래서 메모리에 먼저 받아 두고, 라우트
// 핸들러에서 slug 를 확인한 뒤 순서대로 디스크에 쓴다.
const IMAGE_UPLOAD_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// 입구 B 참고 자료: 이미지(png/jpg/jpeg/webp)와 문서(pdf/docx/txt/md) 모두 허용.
// 유형 구분(image/document)에 두 집합을 함께 쓴다. 이미지 업로드와 같은 이유로
// 메모리에 먼저 받아 두고 핸들러에서 검증 후 디스크에 쓴다.
const REFERENCE_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
const REFERENCE_DOC_EXTS = new Set(["pdf", "docx", "txt", "md"]);
const referenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// 업로드 원본 파일명을 안전하게 정리한다.
//  - 한글 파일명 깨짐 방지(latin1→utf8, 워드 업로드와 동일 처리)
//  - 경로 이탈(../, 디렉터리 구분자) 방지: basename 만 사용
function safeReferenceName(originalname) {
  const decoded = Buffer.from(originalname, "latin1").toString("utf8");
  const base = path.basename(decoded.replace(/[\\/]+/g, "_"));
  return base || "reference";
}

// 확장자로 참고 자료 유형을 판정한다.
function referenceType(ext) {
  return REFERENCE_IMAGE_EXTS.has(ext) ? "image" : "document";
}

// ── 세션 저장소 (STOP 지점 사이에 대화를 이어가기 위함) ──────────────
// 브라우저 탭 1개 = 작업 1건. sessionId 로 Claude Code 세션을 resume 한다.
const sessions = {}; // { [browserKey]: { claudeSessionId, model } }

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
 * @param {string|null} model    화면에서 고른 모델 별칭 (sonnet/opus/haiku/fable). 없으면 기본 모델.
 * @returns {Promise<{text:string, sessionId:string}>}
 */
function runClaude(prompt, resumeId, browserKey, model) {
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
      ALLOWED_TOOLS,
      "--permission-mode",
      "acceptEdits", // 파일 편집은 자동 승인 (사람 승인은 화면 STOP에서 별도로 함)
      "--max-turns",
      "30", // 폭주 방지 안전장치
    ];
    // 화면에서 고른 모델 별칭을 그대로 --model 로 넘긴다 (예: --model haiku).
    if (model) {
      args.push("--model", model);
    }
    if (resumeId) {
      args.push("--resume", resumeId);
    }

    // 전역 설치된 claude.cmd 를 경로로 직접 실행한다 (npx 오버헤드 제거).
    //  - cross-spawn 은 .cmd(배치) 를 shell 없이 실행하면서도 cmd.exe / CRT argv
    //    파서 양쪽 규칙에 맞게 각 인자를 정확히 이스케이프해준다.
    //  - HARNESS_DIR 안에서 실행해야 CLAUDE.md/스킬/DESIGN.md 를 자동 로드한다.
    const CLAUDE_BIN = "C:\\Users\\sepoa\\AppData\\Roaming\\npm\\claude.cmd";

    // 디버깅용: 실제로 claude 에 넘기는 전체 명령을 터미널에 찍는다.
    // -p 프롬프트는 매우 길어서 로그를 가리므로 길이만 표시하고, --model 등
    // 나머지 옵션은 그대로 보여준다(어떤 --model 로 실행되는지 눈으로 확인).
    const shownArgs = args.map((a, i) =>
      args[i - 1] === "-p" ? `<프롬프트 ${a.length}자>` : a
    );
    console.log(`[claude 실행] ${CLAUDE_BIN} ${shownArgs.join(" ")}`);

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
  // 입구 A: 워드 업로드형 — 초안을 제목 판단 수준으로 빠르게 훑고 제목 3안 (STOP1)
  //  ※ 제목 단계는 가볍게: spec.md 전체를 채우지 않는다. 나머지 spec 작성은
  //    제목 확정 후 keyword-approve 단계로 미룬다.
  start_from_docx:
    "inbox/ 에서 가장 최근 .docx 초안을 제목 판단에 필요한 수준으로 빠르게 훑어 " +
    "주제·앵글·타깃 독자만 파악한 뒤 /title-select 를 실행해 제목 3안을 제시하고 STOP 하라. " +
    "spec.md 전체를 채우지 말고, 나머지는 제목 확정 후 keyword-approve 에서 채운다. " +
    "아직 다음 단계로 넘어가지 마라.",

  // 입구 B: 채팅 한 줄형 — 주제에서 최소 정보만 잡고 제목 3안 (STOP1)
  //  ※ 제목 단계는 가볍게: spec.md 전체를 채우지 않는다.
  start_from_topic: (topic) =>
    `다음 주제로 블로그를 시작한다: "${topic}". references/ 폴더에 참고 자료가 ` +
    "있으면 모두 확인한다: 문서(pdf/docx/txt)는 내용을 읽고, 이미지는 무엇이 담겼는지 " +
    "보고 파악한다. 주제와 참고 자료를 종합해 앵글·타깃 독자·핵심 메시지를 잡고, " +
    "제목에 필요한 최소 정보만 파악한 뒤 /title-select 로 제목 3안을 제시하고 STOP 하라. " +
    "참고 자료는 사실 근거로만 쓰고, 지어내지 않는다. " +
    "spec.md 전체를 채우지 말고, 나머지는 제목 확정 후 keyword-approve 에서 채운다. " +
    "아직 다음 단계로 넘어가지 마라.",

  // STOP1 통과 → 키워드 (STOP2)
  pick_title: (choice) =>
    `사람이 제목 ${choice}번을 선택했다. 선택된 제목을 확정하고 /keyword-approve 를 실행해 ` +
    "SEO 키워드 후보와 배치안을 제시하고 STOP 하라.",

  // STOP1 통과(직접 입력형) → 사람이 3안 대신 직접 입력한 제목으로 확정 (STOP2)
  custom_title: (title) =>
    `사람이 제목을 직접 입력해 확정했다. 확정 제목: '${title}'. 이 제목을 ` +
    "spec.md 의 확정 제목으로 저장하고 /keyword-approve 를 실행해 이 제목 " +
    "기준으로 키워드 후보·배치안·본문 구조안을 제시하고 STOP 하라.",

  // STOP2 통과 → 본문 작성만 (이미지는 아직 안 만든다)
  //  ※ 본문 전체는 파일에만 저장하고 화면 결과 박스에는 중복 출력하지 않는다.
  //    화면에 별도의 [작성된 본문] 보기 영역이 있어 두 번 표시되기 때문이다.
  approve_keywords:
    "사람이 키워드를 승인했다. /write-body 로 본문 초안을 drafts/ 에 저장하라. " +
    "본문 전체를 여기 출력하지 말고, '본문 초안을 작성해 drafts/ 에 저장했습니다. " +
    "아래 [작성된 본문]에서 확인하고, 수정할 점이 있으면 알려주세요.' 정도의 " +
    "짧은 완료 안내와 함께 STOP 하라. 본문 원문은 파일에만 저장하고 화면에는 " +
    "중복 출력하지 않는다. 이미지는 아직 만들지 마라.",

  // STOP3 통과 → 본문 승인 후 이미지 프롬프트
  approve_body:
    "사람이 본문을 승인했다. /image-prompt 로 대표 이미지 프롬프트를 만들고 " +
    "이미지 내 텍스트를 제시하며 STOP 하라.",

  // STOP4 통과 → 이미지 텍스트 승인 후 최종 검증
  approve_images:
    "사람이 이미지 내 텍스트를 승인했다. evaluator 서브에이전트로 최종 검증을 실행하고, " +
    "PASS 면 '발행 준비 완료'를, FAIL 이면 무엇을 고쳐야 하는지 보고하라. 발행은 하지 마라.",

  // 검증 FAIL 후 → 지적사항을 반영해 본문 수정 (재검증은 아직 안 함)
  //  ※ 본문 전체는 파일에만 저장하고 화면 결과 박스에는 중복 출력하지 않는다
  //    (approve_keywords 와 같은 이유 — 화면에 [작성된 본문] 보기 영역이 있다).
  fix_from_review:
    "직전 검증(evaluator)에서 지적된 문제들을 반영해 /write-body 로 본문을 " +
    "수정하고 drafts/ 에 덮어써라. 지적사항을 모두 반영하되, 문제없다고 확인된 " +
    "부분은 유지한다. 수정 후 '지적사항을 반영해 본문을 수정했습니다. 아래 " +
    "[작성된 본문]에서 확인하고, 이상 없으면 다시 검증해 주세요.' 안내와 함께 " +
    "STOP 하라. 본문 전체는 파일에만 저장하고 화면 결과 박스에는 중복 출력하지 " +
    "마라. 재검증은 아직 하지 마라.",

  // 본문 수정 후 → 재검증 (approve_images 와 동일한 검증 로직, 별도 step)
  revalidate:
    "evaluator 서브에이전트로 본문을 다시 검증하고, PASS 면 '발행 준비 완료'를, " +
    "FAIL 이면 무엇을 고쳐야 하는지 보고하라. 발행은 하지 마라.",

  // 어느 STOP에서든: 사람이 수정을 요청하면 그 단계 결과물만 고쳐서 다시 STOP.
  //  ※ 본문(body) 단계는 화면에 별도의 [작성된 본문] 보기 영역이 있으므로,
  //    수정 후에도 본문 전체를 화면에 다시 뱉지 않고 짧은 안내만 한다(중복 방지).
  revise: (feedback, stage) => {
    const head = `사람이 방금 제시한 결과물에 수정을 요청했다: "${feedback}". `;
    if (stage === "body") {
      return (
        head +
        "요청을 반영해 본문 초안을 drafts/ 의 같은 파일에 수정·저장하라. " +
        "본문 전체를 여기 출력하지 말고, '본문을 수정해 drafts/ 에 다시 저장했습니다. " +
        "아래 [작성된 본문]에서 확인하세요.' 정도의 짧은 완료 안내와 함께 STOP 하라. " +
        "본문 원문은 파일에만 저장하고 화면에는 중복 출력하지 않는다. 다음 단계로 넘어가지 마라."
      );
    }
    return (
      head +
      "요청을 반영해 현재 단계의 결과물을 수정한 뒤, 같은 형식으로 다시 제시하고 STOP 하라. " +
      "다음 단계로 넘어가지 마라."
    );
  },
};

// ── 라우트: 워드 업로드 (입구 A 준비) ──────────────────────────────
// 교체 방식: 방금 올린 파일만 남기고 inbox 의 기존 파일을 정리한다.
//  → inbox 에 워드가 여러 개 쌓이는 문제를 근본적으로 없앤다.
app.post("/api/upload", upload.single("draft"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 없습니다." });
  try {
    for (const name of fs.readdirSync(INBOX_DIR)) {
      if (name.startsWith(".")) continue;        // .gitkeep 등 유지
      if (name === req.file.filename) continue;  // 방금 올린 파일 유지
      const p = path.join(INBOX_DIR, name);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
      else fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("[업로드] inbox 정리 실패:", e.message);
  }
  res.json({ ok: true, filename: req.file.filename });
});

// ── 라우트: 본문 초안 보기 ───────────────────────────────────────
// GET /api/draft?slug=파일명  (slug 없으면 drafts/ 의 가장 최근 .md)
app.get("/api/draft", (req, res) => {
  const { slug } = req.query;
  let filename;

  if (slug) {
    if (!isSafeSlug(slug)) {
      return res.status(400).json({ error: "잘못된 slug 형식입니다." });
    }
    filename = slug.toLowerCase().endsWith(".md") ? slug : `${slug}.md`;
  } else {
    filename = mostRecentMdFile(DRAFTS_DIR);
    if (!filename) {
      return res.status(404).json({ error: "drafts 폴더에 .md 파일이 없습니다." });
    }
  }

  const filePath = path.join(DRAFTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `본문 파일을 찾을 수 없습니다: ${filename}` });
  }
  const content = fs.readFileSync(filePath, "utf8");
  res.json({ ok: true, slug: slug || null, filename, content });
});

// ── 라우트: 이미지 프롬프트 보기 ─────────────────────────────────
// GET /api/image-prompt?slug=파일명  (slug 없으면 image-prompts/ 의 가장 최근 .md)
app.get("/api/image-prompt", (req, res) => {
  const { slug } = req.query;
  let filename;

  if (slug) {
    if (!isSafeSlug(slug)) {
      return res.status(400).json({ error: "잘못된 slug 형식입니다." });
    }
    if (slug.toLowerCase().endsWith(".md")) {
      filename = slug;
    } else {
      // 스킬이 저장하는 관례("{슬러그}-prompts.md")를 우선 찾고,
      // 없으면 슬러그 그대로 ".md" 를 붙인 이름도 시도한다.
      const withSuffix = `${slug}-prompts.md`;
      filename = fs.existsSync(path.join(IMAGE_PROMPTS_DIR, withSuffix))
        ? withSuffix
        : `${slug}.md`;
    }
  } else {
    filename = mostRecentMdFile(IMAGE_PROMPTS_DIR);
    if (!filename) {
      return res.status(404).json({ error: "image-prompts 폴더에 .md 파일이 없습니다." });
    }
  }

  const filePath = path.join(IMAGE_PROMPTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `이미지 프롬프트 파일을 찾을 수 없습니다: ${filename}` });
  }
  const content = fs.readFileSync(filePath, "utf8");
  res.json({ ok: true, slug: slug || null, filename, content });
});

// ── 라우트: 이미지 업로드 (사람이 Gemini/ChatGPT 로 만든 이미지) ───
// POST /api/upload-image (multipart)  필드: slug, image(1개 이상)
app.post("/api/upload-image", imageUpload.array("image", 20), (req, res) => {
  const slug = (req.body.slug || "").trim();
  if (!slug) return res.status(400).json({ error: "slug가 필요합니다." });
  if (!isSafeSlug(slug)) {
    return res.status(400).json({ error: "잘못된 slug 형식입니다." });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "업로드할 이미지가 없습니다." });
  }

  // 확장자는 전부 저장하기 전에 먼저 검증한다 (일부만 저장되는 상태 방지).
  for (const file of req.files) {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (!IMAGE_UPLOAD_EXTS.has(ext)) {
      return res.status(400).json({
        error: `허용되지 않는 확장자입니다(png/jpg/jpeg/webp만 가능): ${file.originalname}`,
      });
    }
  }

  // 같은 slug 로 이미 저장된 파일 중 가장 큰 순번을 찾아 그 다음부터 매긴다.
  const seqPattern = new RegExp(`^${escapeRegExp(slug)}-(\\d+)\\.[A-Za-z0-9]+$`);
  let seq = 0;
  for (const name of fs.readdirSync(UPLOADED_IMAGES_DIR)) {
    const m = name.match(seqPattern);
    if (m) seq = Math.max(seq, parseInt(m[1], 10));
  }

  const saved = [];
  for (const file of req.files) {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    seq += 1;
    const filename = `${slug}-${String(seq).padStart(2, "0")}.${ext}`;
    fs.writeFileSync(path.join(UPLOADED_IMAGES_DIR, filename), file.buffer);
    saved.push(filename);
  }

  const files = fs
    .readdirSync(UPLOADED_IMAGES_DIR)
    .filter((name) => name.startsWith(`${slug}-`))
    .sort();

  res.json({ ok: true, saved, files });
});

// ── 라우트: 업로드된 이미지 목록 ────────────────────────────────
// GET /api/uploaded-images?slug=파일명
app.get("/api/uploaded-images", (req, res) => {
  const { slug } = req.query;
  if (!slug) return res.status(400).json({ error: "slug가 필요합니다." });
  if (!isSafeSlug(slug)) {
    return res.status(400).json({ error: "잘못된 slug 형식입니다." });
  }
  const files = fs
    .readdirSync(UPLOADED_IMAGES_DIR)
    .filter((name) => name.startsWith(`${slug}-`))
    .sort()
    .map((name) => ({ filename: name, url: `/uploaded-images/${name}` }));
  res.json({ ok: true, slug, files });
});

// ── 라우트: 참고 자료 업로드 (입구 B: 주제 + 참고 이미지·문서) ───────
// POST /api/upload-reference (multipart)  필드: reference(1개 이상)
//  - references/ 에 원본 이름으로 저장(이미지 png/jpg/jpeg/webp, 문서 pdf/docx/txt/md).
//  - 여러 파일을 한 번에, 또 나눠서 여러 번 올려도 누적된다(교체 아님).
//  - browserKey 는 세션 식별용으로 받되, 저장 위치는 공유 references/ 폴더다
//    (inbox 와 같은 방식: 새 작업/초기화 시 /api/reset 에서 비운다).
app.post("/api/upload-reference", referenceUpload.array("reference", 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "업로드할 참고 자료가 없습니다." });
  }

  // 확장자를 먼저 전부 검증한다(일부만 저장되는 상태 방지).
  for (const file of req.files) {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (!REFERENCE_IMAGE_EXTS.has(ext) && !REFERENCE_DOC_EXTS.has(ext)) {
      return res.status(400).json({
        error:
          "허용되지 않는 확장자입니다(이미지 png/jpg/jpeg/webp, 문서 pdf/docx/txt/md): " +
          Buffer.from(file.originalname, "latin1").toString("utf8"),
      });
    }
  }

  const saved = [];
  for (const file of req.files) {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    let name = safeReferenceName(file.originalname);
    // 같은 이름이 이미 있으면 순번을 붙여 덮어쓰기를 피한다.
    let target = path.join(REFERENCES_DIR, name);
    if (fs.existsSync(target)) {
      const stem = name.slice(0, name.length - (ext.length + 1));
      let n = 1;
      do {
        name = `${stem}-${n}.${ext}`;
        target = path.join(REFERENCES_DIR, name);
        n += 1;
      } while (fs.existsSync(target));
    }
    fs.writeFileSync(target, file.buffer);
    saved.push({ name, type: referenceType(ext), path: target });
  }

  // 현재 references/ 전체 목록도 함께 돌려준다(이름·유형·경로·미리보기 URL).
  const files = fs
    .readdirSync(REFERENCES_DIR)
    .filter((n) => !n.startsWith("."))
    .sort()
    .map((n) => {
      const ext = path.extname(n).slice(1).toLowerCase();
      return {
        name: n,
        type: referenceType(ext),
        path: path.join(REFERENCES_DIR, n),
        url: `/references/${encodeURIComponent(n)}`,
      };
    });

  res.json({ ok: true, saved, files });
});

// ── 라우트: 단계 실행 ────────────────────────────────────────────
app.post("/api/step", async (req, res) => {
  const { browserKey, step, topic, choice, title, feedback, model, stage } = req.body;
  if (!browserKey || !step)
    return res.status(400).json({ error: "browserKey/step 필요" });

  // 이 브라우저의 이전 Claude 세션 id (이어가기용)
  const prev = sessions[browserKey]?.claudeSessionId || null;
  // 첫 단계에서 정한 모델 (이후 단계는 이 값을 그대로 재사용)
  const prevModel = sessions[browserKey]?.model || null;

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
    case "custom_title": {
      // 사람이 3안을 고르지 않고 제목을 직접 입력해 확정한 경우.
      // 세션(prev)은 pick_title 과 동일하게 이어간다(아래 resume 로직 공통).
      const t = (title || "").trim();
      if (!t) return res.status(400).json({ error: "제목을 입력하세요." });
      prompt = STEP_PROMPTS.custom_title(t);
      break;
    }
    case "approve_keywords":
      prompt = STEP_PROMPTS.approve_keywords;
      break;
    case "approve_body":
      prompt = STEP_PROMPTS.approve_body;
      break;
    case "approve_images":
      prompt = STEP_PROMPTS.approve_images;
      break;
    case "fix_from_review":
      prompt = STEP_PROMPTS.fix_from_review;
      break;
    case "revalidate":
      prompt = STEP_PROMPTS.revalidate;
      break;
    case "revise":
      if (!feedback)
        return res.status(400).json({ error: "수정 요청 내용을 입력하세요." });
      if (!prev)
        return res.status(400).json({ error: "진행 중인 작업이 없습니다." });
      // stage(현재 STOP 단계)를 함께 넘겨, 본문 단계에서는 본문을 화면에
      // 중복 출력하지 않는 전용 안내로 분기한다.
      prompt = STEP_PROMPTS.revise(feedback, stage);
      break;
    default:
      return res.status(400).json({ error: "알 수 없는 step" });
  }

  try {
    // 첫 단계(start_*)는 새 세션, 이후는 resume 로 대화를 이어간다.
    const isStart = step.startsWith("start_");
    // 모델은 첫 단계에서만 화면 선택값을 검증해 확정하고, 이후 단계는
    // 세션에 저장된 값을 그대로 재사용한다(중간에 모델이 바뀌지 않게).
    const chosenModel = isStart ? resolveModel(model) : prevModel;
    const { text, sessionId, meta } = await runClaude(
      prompt,
      isStart ? null : prev,
      browserKey,
      chosenModel
    );
    if (sessionId) {
      // 세션 id 와 함께 확정된 모델도 저장해 이후 단계에서 이어 쓴다.
      sessions[browserKey] = { claudeSessionId: sessionId, model: chosenModel };
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

// ── 라우트: 초기화 (새 글을 처음부터 시작할 수 있는 상태로) ──────────
//  - 세션·실행 중 프로세스 정리
//  - spec.md 골격만 남기고 비움
//  - inbox 비움 (새 워드 업로드 대비)
//  - references 비움 (입구 B 참고 자료 — 새 작업 대비)
//  - drafts / image-prompts / uploaded-images 는 완성물이므로 보존
app.post("/api/reset", (req, res) => {
  const { browserKey } = req.body;

  // 1) 실행 중 프로세스 중지 + 세션 정리
  if (browserKey) {
    const entry = runningProcs[browserKey];
    if (entry) {
      entry.stopped = true;
      killProcessTree(entry.child);
      delete runningProcs[browserKey];
    }
    delete sessions[browserKey];
  }

  const cleared = [];

  // 2) spec.md 를 골격만 남긴 초기 템플릿으로 되돌린다
  try {
    const specPath = path.join(HARNESS_DIR, "spec.md");
    const skeleton = fs.existsSync(specPath)
      ? buildSpecSkeleton(fs.readFileSync(specPath, "utf8"))
      : "# spec.md — 새 작업 대기 중\n";
    fs.writeFileSync(specPath, skeleton);
    cleared.push("spec.md");
  } catch (e) {
    return res.status(500).json({ error: "spec.md 초기화 실패: " + e.message });
  }

  // 3) inbox 안의 파일 삭제 (폴더·.gitkeep 은 유지)
  try {
    for (const name of fs.readdirSync(INBOX_DIR)) {
      if (name.startsWith(".")) continue; // .gitkeep 등 유지
      const p = path.join(INBOX_DIR, name);
      if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    }
    cleared.push("inbox");
  } catch (e) {
    // inbox 비우기 실패는 치명적이지 않으므로 로그만 남기고 진행
    console.error("[초기화] inbox 비우기 실패:", e.message);
  }

  // 4) references 안의 파일 삭제 (입구 B 참고 자료 — 새 작업 대비)
  try {
    for (const name of fs.readdirSync(REFERENCES_DIR)) {
      if (name.startsWith(".")) continue; // .gitkeep 등 유지
      const p = path.join(REFERENCES_DIR, name);
      if (fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    }
    cleared.push("references");
  } catch (e) {
    console.error("[초기화] references 비우기 실패:", e.message);
  }

  res.json({ ok: true, cleared });
});

// app.listen(PORT, () => {
//   console.log(`\n세포아 블로그 콘솔 실행 중`);
//   console.log(`  화면:     http://localhost:${PORT}`);
//   console.log(`  하네스:   ${HARNESS_DIR}`);
//   console.log(`  inbox:    ${INBOX_DIR}`);
//   console.log(`  drafts:   ${DRAFTS_DIR}`);
//   console.log(`  image-prompts:   ${IMAGE_PROMPTS_DIR}`);
//   console.log(`  uploaded-images: ${UPLOADED_IMAGES_DIR}`);
//   console.log(`  references:      ${REFERENCES_DIR}\n`);
// });

// ── 통합 서버에서 마운트할 수 있도록 export ──
// 단독 실행(node server.js)일 때만 listen 하고,
// 루트 server.js가 require 하면 app 만 넘긴다.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n[포포소프트 블로그 콘솔 실행 중]`);
    console.log(`  화면:     http://localhost:${PORT}`);
    console.log(`  하네스:   ${HARNESS_DIR}`);
  });
}

module.exports = app;