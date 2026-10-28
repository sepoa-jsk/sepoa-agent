package kr.co.sepoasoft.quote.web.advice;

import org.springframework.http.HttpStatus;

/**
 * Node 라우트의 {@code res.status(n).json({ error, message })} 에 대응한다.
 *
 * <p><b>{@code message} 는 null 일 수 있다.</b> Node 에는 {@code { error: 'NOT_FOUND' }} 처럼
 * 문구 없이 내보내는 곳이 많고, 응답 형태를 그대로 맞춰야 J6 에서 프론트를 고치지 않는다.
 * null 이면 응답 본문에서 {@code message} 키 자체가 빠진다({@link ApiExceptionHandler}).
 * 어느 오류에 문구가 있는지는 {@code quote-legacy/docs/API-spec.md} 2장 표가 정본이다.
 */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String error;
    private final String detail;

    public ApiException(HttpStatus status, String error, String message) {
        super(error + (message == null ? "" : ": " + message));
        this.status = status;
        this.error = error;
        this.detail = message;
    }

    public ApiException(HttpStatus status, String error) {
        this(status, error, null);
    }

    public HttpStatus status() { return status; }
    public String error() { return error; }
    public String detail() { return detail; }

    public static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND");
    }
}
