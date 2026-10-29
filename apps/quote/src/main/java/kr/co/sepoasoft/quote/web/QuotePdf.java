package kr.co.sepoasoft.quote.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import kr.co.sepoasoft.quote.web.advice.ApiException;

/**
 * 견적서 HTML → PDF — Node {@code src/domain/render/pdf.js} 이식. 설치된 Chrome(없으면 Edge)을 headless 로 띄워 인쇄한다.
 * Chromium 을 내려받지 않는다(폐쇄망 배포). 경로는 환경변수 {@code CHROME_PATH} 가 우선이다.
 *
 * <p>견적서 HTML({@link QuoteHtml})은 @page A4 · 여백을 스스로 정하므로 인쇄 옵션은 머리말/꼬리말 끄기만 준다.
 * 리눅스 서버에 올릴 때는 한글 글꼴(맑은 고딕 또는 Noto Sans KR)이 있어야 한다 — LESSONS 'J7 이관 사항: 리눅스 한글 폰트'.
 */
@Component
public class QuotePdf {

    private static final long TIMEOUT_SEC = 60;

    private static List<String> candidates() {
        List<String> c = new ArrayList<>();
        String env = System.getenv("CHROME_PATH");
        if (env != null && !env.isBlank()) c.add(env);
        c.add("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
        c.add("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe");
        c.add("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
        c.add("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
        c.add("/usr/bin/google-chrome");
        c.add("/usr/bin/chromium");
        c.add("/usr/bin/chromium-browser");
        return c;
    }

    private static String findBrowser() {
        for (String p : candidates()) if (Files.isRegularFile(Path.of(p))) return p;
        return null;
    }

    public byte[] toPdf(String html) {
        String bin = findBrowser();
        if (bin == null) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "NO_BROWSER", "Chrome/Edge 를 찾을 수 없습니다. CHROME_PATH 환경변수로 경로를 지정하세요.");
        }
        Path dir = null;
        try {
            dir = Files.createTempDirectory("quote-pdf");
            Path htmlPath = dir.resolve("quote.html");
            Path pdfPath = dir.resolve("quote.pdf");
            Files.writeString(htmlPath, html, StandardCharsets.UTF_8);
            // 프로필 폴더를 따로 둔다 — 사용자가 띄운 Chrome 과 섞이면 인쇄 없이 끝나는 일이 있다
            List<String> cmd = List.of(bin, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                    "--no-default-browser-check", "--no-pdf-header-footer",
                    "--user-data-dir=" + dir.resolve("profile"),
                    "--print-to-pdf=" + pdfPath, htmlPath.toUri().toString());
            Process p = new ProcessBuilder(cmd).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (!p.waitFor(TIMEOUT_SEC, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF_TIMEOUT", "PDF 생성이 " + TIMEOUT_SEC + "초 안에 끝나지 않았습니다.");
            }
            if (!Files.isRegularFile(pdfPath) || Files.size(pdfPath) == 0) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF_FAILED", "PDF 생성에 실패했습니다.");
            }
            return Files.readAllBytes(pdfPath);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF_FAILED", "PDF 생성에 실패했습니다: " + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF_FAILED", "PDF 생성이 중단되었습니다.");
        } finally {
            if (dir != null) deleteQuietly(dir);
        }
    }

    private static void deleteQuietly(Path dir) {
        try (var s = Files.walk(dir)) {
            s.sorted(java.util.Comparator.reverseOrder()).forEach(f -> { try { Files.deleteIfExists(f); } catch (IOException ignored) { } });
        } catch (IOException ignored) {
            // 임시 폴더라 남아도 OS 가 치운다
        }
    }
}
