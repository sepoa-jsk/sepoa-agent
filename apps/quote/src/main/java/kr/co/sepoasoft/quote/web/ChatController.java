package kr.co.sepoasoft.quote.web;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * {@code POST /api/chat} — AI 도우미(2026-11-04 사용자 요청). 대화 LLM 은 서버에 설치된 Claude CLI({@code claude -p}).
 *
 * <p>요청 {@code {messages:[{role:'user'|'assistant', text}]}} — 마지막이 사용자 질문. 응답 {@code {reply}}.
 * CLI 는 도구를 모두 끄고(파일 · 명령 실행 불가) 빈 작업 폴더에서 띄운다. 대화 기록은 남기지 않는다(--no-session-persistence).
 * 견적 데이터(2026-11-04 사용자 요청) — 서버가 질문 앞에 [견적 자료]를 붙인다: 전체 견적 요약 한 줄씩 +
 * 자세히 볼 견적(지금 화면의 견적 {@code context.quote_id} · 질문에 나온 견적번호 · 고객사명, 최대 3건)의 품목 · 금액 · 견적조건.
 * CLI 가 DB 에 직접 닿지 않는다 — 읽기 전용 사본을 글로 넘긴다.
 * 실행 파일은 환경변수 {@code CLAUDE_PATH} 가 우선, 없으면 PATH 의 {@code claude}.
 */
@RestController
@RequestMapping("/api/chat")
@Access(Level.LOGIN)
public class ChatController {

    private static final long TIMEOUT_SEC = 120;
    private static final int MAX_MESSAGES = 20;
    private static final int MAX_CHARS = 4000;
    private static final Semaphore SLOTS = new Semaphore(3); // 동시에 띄우는 CLI 수

    private static final String SYSTEM_PROMPT = String.join(" ", // 명령줄 인자라 한 줄로
            "너는 (주)세포아소프트 견적 시스템의 AI 도우미다.",
            "견적 시스템은 전자구매 · 경비관리 · 전자인장 솔루션의 견적서(온프레미스 · SaaS · Private Cloud)를 만드는 사내 프로그램이다.",
            "사용자는 영업 담당자다. 한국어로, 짧고 쉽게 답한다.",
            "견적에 관한 질문은 함께 주는 [견적 자료]만 근거로 답한다. 자료에 없는 내용은 지어내지 말고 없다고 답한다.",
            "금액은 원 단위에 3자리 콤마로 쓴다. 표가 필요하면 짧은 줄 목록으로 쓴다.");
    private static final Map<String, String> STATUS = Map.of("DRAFT", "작성중", "SENT", "발송", "WON", "수주", "LOST", "실주");
    private static final Pattern QUOTE_NO = Pattern.compile("(QT\\d{8}_\\d{3}|S\\d{11})");
    private static final int MAX_QUOTES = 300;
    private static final int MAX_DETAIL = 3;

    private final Rows db;
    private final QuoteLoader loader;

    public ChatController(Rows db, QuoteLoader loader) {
        this.db = db;
        this.loader = loader;
    }

    @PostMapping
    public Map<String, Object> chat(@RequestBody(required = false) Map<String, Object> body) {
        List<Object> list = body == null ? List.of() : QuoteCalc.asList(body.get("messages"));
        if (list.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_MESSAGE", "질문을 입력하세요.");
        List<Object> recent = list.subList(Math.max(0, list.size() - MAX_MESSAGES), list.size());
        StringBuilder prompt = new StringBuilder();
        String last = "";
        for (Object o : recent) {
            Map<String, Object> m = QuoteCalc.asMap(o);
            String text = QuoteHtml.str(m.get("text")).strip();
            if (text.length() > MAX_CHARS) text = text.substring(0, MAX_CHARS);
            if (text.isEmpty()) continue;
            boolean user = !"assistant".equals(QuoteHtml.str(m.get("role")));
            if (user) last = text;
            prompt.append(user ? "[사용자]\n" : "[도우미]\n").append(text).append("\n\n");
        }
        if (last.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "NO_MESSAGE", "질문을 입력하세요.");
        Object ctxId = body.get("context") instanceof Map<?, ?> c ? c.get("quote_id") : null;
        String data = quoteData(last, ctxId);
        String input = "[견적 자료]\n" + data + "\n\n"
                + (recent.size() > 1 ? "지금까지의 대화다. 마지막 [사용자] 질문에 답한다. 답만 쓴다.\n\n" + prompt : "[사용자]\n" + last);
        if (!SLOTS.tryAcquire()) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "BUSY", "다른 질문을 처리 중입니다. 잠시 후 다시 보내세요.");
        try {
            return Map.of("reply", run(input));
        } finally {
            SLOTS.release();
        }
    }

    /** [견적 자료] — 전체 요약 + 자세히 볼 견적(최대 3건) */
    private String quoteData(String question, Object ctxId) {
        List<Map<String, Object>> rows = db.query("SELECT q.id, q.quote_no, q.revision, q.customer_name, q.deployment, q.template_code, q.quote_date,"
                + " q.status, q.onetime_total, q.monthly_total, q.memo, u.name AS owner FROM sq_quotes q LEFT JOIN sq_users u ON u.id = q.created_by"
                + " ORDER BY q.id DESC LIMIT " + MAX_QUOTES);
        StringBuilder sb = new StringBuilder("전체 견적 " + rows.size() + "건(최근 순) — 견적번호 | 차수 | 고객사 | 견적용도 | 구축형태 | 견적일 | 상태 | 일시불 | 월 사용료 | 담당자\n");
        for (Map<String, Object> q : rows) {
            sb.append("- ").append(String.join(" | ", QuoteHtml.str(q.get("quote_no")), QuoteHtml.str(q.get("revision")) + "차",
                    QuoteHtml.str(q.get("customer_name")), QuoteHtml.tag(QuoteHtml.str(q.get("memo")), "견적용도"),
                    QuoteHtml.DEP_LABEL.getOrDefault(QuoteHtml.str(q.get("deployment")), QuoteHtml.str(q.get("deployment"))),
                    QuoteHtml.str(q.get("quote_date")), STATUS.getOrDefault(QuoteHtml.str(q.get("status")), QuoteHtml.str(q.get("status"))),
                    QuoteHtml.won(QuoteHtml.num(q.get("onetime_total"))) + "원", QuoteHtml.won(QuoteHtml.num(q.get("monthly_total"))) + "원",
                    QuoteHtml.str(q.get("owner")))).append('\n');
        }
        // 자세히 볼 견적 — 지금 화면의 견적 · 질문에 나온 견적번호 · 고객사명
        Set<Long> ids = new LinkedHashSet<>();
        Long current = ctxId != null && QuoteHtml.str(ctxId).matches("[0-9]+") ? Long.valueOf(QuoteHtml.str(ctxId)) : null;
        if (current != null) ids.add(current);
        Matcher m = QUOTE_NO.matcher(question);
        while (m.find()) for (Map<String, Object> q : rows) if (m.group(1).equals(QuoteHtml.str(q.get("quote_no")))) ids.add((long) QuoteHtml.num(q.get("id")));
        for (Map<String, Object> q : rows) {
            String c = QuoteHtml.str(q.get("customer_name")).strip();
            if (c.length() >= 2 && question.contains(c)) ids.add((long) QuoteHtml.num(q.get("id")));
        }
        int n = 0;
        for (Long id : ids) {
            if (n++ >= MAX_DETAIL) break;
            Map<String, Object> q = loader.load(id);
            if (q != null) sb.append('\n').append(detail(q, id.equals(current)));
        }
        return sb.toString();
    }

    /** 견적 한 건 — 머리 정보 · 블록별 품목 · 인건비 · 견적조건 */
    private static String detail(Map<String, Object> q, boolean current) {
        String memo = QuoteHtml.str(q.get("memo"));
        StringBuilder sb = new StringBuilder("[견적 상세" + (current ? " — 사용자가 지금 보고 있는 견적" : "") + "] ")
                .append(QuoteHtml.str(q.get("quote_no"))).append(' ').append(QuoteHtml.str(q.get("revision"))).append("차\n");
        sb.append("고객사: ").append(QuoteHtml.str(q.get("customer_name"))).append(" / 견적용도: ").append(QuoteHtml.tag(memo, "견적용도"))
                .append(" / 구축형태: ").append(QuoteHtml.DEP_LABEL.getOrDefault(QuoteHtml.str(q.get("deployment")), QuoteHtml.str(q.get("deployment"))))
                .append(" / 견적일: ").append(QuoteHtml.str(q.get("quote_date"))).append(" / 유효일: ").append(QuoteHtml.str(q.get("valid_until")))
                .append(" / 상태: ").append(STATUS.getOrDefault(QuoteHtml.str(q.get("status")), QuoteHtml.str(q.get("status")))).append('\n');
        sb.append("일시불 합계: ").append(QuoteHtml.won(QuoteHtml.num(q.get("onetime_total")))).append("원 / 월 사용료 합계: ")
                .append(QuoteHtml.won(QuoteHtml.num(q.get("monthly_total")))).append("원 (부가세 별도)\n");
        for (Map<String, Object> b : QuoteHtml.maps(q.get("blocks"))) {
            sb.append("▣ ").append(QuoteHtml.firstNonEmpty(b.get("title"), b.get("block_code"))).append(Rows.truthy(b.get("recurring")) ? "(월)" : "")
                    .append(" 소계 ").append(QuoteHtml.won(QuoteHtml.num(b.get("subtotal")))).append("원\n");
            for (Map<String, Object> it : QuoteHtml.maps(b.get("items"))) {
                sb.append("  - ").append(QuoteHtml.str(it.get("category"))).append(" | ").append(QuoteHtml.str(it.get("name")))
                        .append(" | ").append(QuoteHtml.str(it.get("spec")).replaceAll("\\s+", " "))
                        .append(" | 수량 ").append(QuoteHtml.numText(QuoteHtml.num(it.get("qty")))).append(' ').append(QuoteHtml.str(it.get("unit")))
                        .append(" | 기준단가 ").append(QuoteHtml.won(QuoteHtml.num(it.get("base_price"))))
                        .append(" | 제안단가 ").append(QuoteHtml.won(QuoteHtml.num(it.get("proposed_price"))))
                        .append(" | 금액 ").append(QuoteHtml.won(QuoteHtml.num(it.get("amount")))).append('\n');
            }
            for (Map<String, Object> l : QuoteHtml.maps(b.get("labor"))) {
                sb.append("  - 인력 | ").append(QuoteHtml.firstNonEmpty(l.get("role_label"), l.get("role_name"), l.get("role_code")))
                        .append(" | ").append(QuoteHtml.str(l.get("grade"))).append(" | ").append(QuoteHtml.str(l.get("task")).replaceAll("\\s+", " "))
                        .append(" | 공수 ").append(QuoteHtml.fixed1(QuoteHtml.num(l.get("mm")))).append("MM")
                        .append(" | 제안단가 ").append(QuoteHtml.won(QuoteHtml.num(l.get("proposed_price"))))
                        .append(" | 금액 ").append(QuoteHtml.won(QuoteHtml.num(l.get("amount")))).append('\n');
            }
        }
        List<?> conds = QuoteHtml.list(q.get("conditions"));
        if (!conds.isEmpty()) {
            sb.append("견적조건:\n");
            for (Object c : conds) {
                String t = c instanceof Map<?, ?> cm ? QuoteHtml.str(cm.get("text")) : QuoteHtml.str(c);
                if (!t.isBlank()) sb.append("  -. ").append(t).append('\n');
            }
        }
        return sb.toString();
    }

    private static String run(String input) {
        String bin = System.getenv("CLAUDE_PATH");
        if (bin == null || bin.isBlank()) bin = "claude";
        Path dir = null;
        try {
            dir = Files.createTempDirectory("quote-chat"); // 빈 작업 폴더 — 프로젝트 파일 · 설정을 읽지 않게
            // '--tools=' — 도구 목록을 비운다(빈 값은 '=' 로 붙여 넘긴다: Windows 에서 빈 인자가 빠지지 않게)
            List<String> cmd = new ArrayList<>(List.of(bin, "-p", "--output-format", "text", "--tools=",
                    "--strict-mcp-config", "--no-session-persistence", "--setting-sources=",
                    "--system-prompt", SYSTEM_PROMPT));
            Process p = new ProcessBuilder(cmd).directory(dir.toFile()).redirectErrorStream(true).start();
            CompletableFuture<byte[]> out = CompletableFuture.supplyAsync(() -> readAll(p.getInputStream()));
            try (OutputStream in = p.getOutputStream()) {
                in.write(input.getBytes(StandardCharsets.UTF_8));
            }
            if (!p.waitFor(TIMEOUT_SEC, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "CHAT_TIMEOUT", "답변이 " + TIMEOUT_SEC + "초 안에 오지 않았습니다.");
            }
            String text = new String(out.get(5, TimeUnit.SECONDS), StandardCharsets.UTF_8).strip();
            if (p.exitValue() != 0 || text.isEmpty()) {
                throw new ApiException(HttpStatus.BAD_GATEWAY, "CHAT_FAILED", "AI 도우미가 답하지 못했습니다." + (text.isEmpty() ? "" : " (" + abbreviate(text) + ")"));
            }
            return text;
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "NO_CLAUDE", "Claude CLI 를 실행할 수 없습니다. CLAUDE_PATH 환경변수로 경로를 지정하세요.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CHAT_FAILED", "답변이 중단되었습니다.");
        } catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "CHAT_FAILED", "AI 도우미 답변을 읽지 못했습니다.");
        } finally {
            if (dir != null) try { Files.deleteIfExists(dir); } catch (IOException ignored) { /* 빈 폴더 — 못 지우면 둔다 */ }
        }
    }

    private static byte[] readAll(InputStream s) {
        try { return s.readAllBytes(); } catch (IOException e) { return new byte[0]; }
    }

    private static String abbreviate(String s) {
        String one = s.replaceAll("\\s+", " ");
        return one.length() > 200 ? one.substring(0, 200) + "…" : one;
    }
}
