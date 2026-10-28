package kr.co.sepoasoft.quote.web.advice;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 오류 응답 형태를 Node 와 맞춘다 — {@code quote-legacy/docs/API-spec.md} 1-2절.
 *
 * <ul>
 *   <li>라우트가 직접 낸 오류: {@code {"error":"코드"}} 또는 {@code {"error":"코드","message":"문구"}}</li>
 *   <li>없는 {@code /api} 경로: {@code 404 {"error":"NOT_FOUND","message":"GET /api/…"}} ({@code router.js})</li>
 *   <li>그 밖의 예외: {@code 500 {"error":"INTERNAL","message":"<예외 메시지>"}} ({@code server.js})</li>
 * </ul>
 *
 * <p><b>메서드가 틀린 요청도 404 다.</b> Express 는 경로가 맞고 메서드가 틀리면 라우트를 건너뛰어
 * {@code /api} 404 핸들러에 떨어진다. Spring 의 405 를 그대로 두면 응답이 어긋난다.
 *
 * <p><b>JSON 파싱 실패도 500 INTERNAL 이다.</b> Node 의 {@code express.json()} 은 400 상태를 단
 * 오류를 넘기지만 {@code server.js} 에러 핸들러가 상태를 보지 않고 500 으로 내린다. 고치지 않고 맞춘다
 * — 바로잡을 일이 있으면 Node 와 함께 정하고 명세부터 고친다.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(ApiException e) {
        return body(e.status(), e.error(), e.detail());
    }

    @ExceptionHandler({ NoResourceFoundException.class, NoHandlerFoundException.class,
            HttpRequestMethodNotSupportedException.class })
    public ResponseEntity<Map<String, Object>> handleNotFound(HttpServletRequest req) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", req.getMethod() + " " + originalUrl(req));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleOther(Exception e, HttpServletRequest req) {
        log.error("[ERROR] {} {}", req.getMethod(), originalUrl(req), e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", e.getMessage());
    }

    static ResponseEntity<Map<String, Object>> body(HttpStatus status, String error, String message) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("error", error);
        if (message != null) out.put("message", message);
        return ResponseEntity.status(status).body(out);
    }

    /**
     * Express {@code req.originalUrl} 에 해당하는 값. Node 는 게이트웨이가 {@code /quote} 를 떼고 넘기므로
     * {@code /api/…} 로 시작한다. Java 는 context path {@code /quote2} 가 붙어 있으므로 떼어 낸다.
     */
    static String originalUrl(HttpServletRequest req) {
        String path = req.getRequestURI().substring(req.getContextPath().length());
        String qs = req.getQueryString();
        return qs == null ? path : path + "?" + qs;
    }
}
