package kr.co.sepoasoft.quote.web.auth;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

import kr.co.sepoasoft.quote.web.advice.ApiException;

/**
 * {@link Access} 를 읽어 Node 가드와 같은 응답을 낸다. 문구까지 Node 그대로다 —
 * {@code apiKeyOrAuth} 만 "인증이 필요합니다." 로 다르다.
 *
 * <p>J8 에서 Spring Security 로 바뀐다. 그때도 응답 본문은 이 클래스가 정한 모양을 지켜야 한다.
 */
@Component
public class AccessInterceptor implements HandlerInterceptor {

    private final AuthSettings settings;

    public AccessInterceptor(AuthSettings settings) {
        this.settings = settings;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        if (!(handler instanceof HandlerMethod hm)) return true;
        Access access = hm.getMethodAnnotation(Access.class);
        if (access == null) access = hm.getBeanType().getAnnotation(Access.class);
        if (access == null) return true;

        SessionUser user = currentUser(req);
        switch (access.value()) {
            case PUBLIC -> { }
            case LOGIN -> {
                if (user == null) throw unauthenticated("로그인이 필요합니다.");
            }
            case ADMIN -> {
                if (user == null) throw unauthenticated("로그인이 필요합니다.");
                if (!user.isAdmin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 권한이 필요합니다.");
            }
            case KEY_OR_LOGIN -> {
                if (!settings.matchesApiKey(req.getHeader("X-API-Key")) && user == null) {
                    throw unauthenticated("인증이 필요합니다.");
                }
            }
        }
        return true;
    }

    public static SessionUser currentUser(HttpServletRequest req) {
        HttpSession session = req.getSession(false);
        return session == null ? null : (SessionUser) session.getAttribute(SessionUser.ATTR);
    }

    private static ApiException unauthenticated(String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", message);
    }
}
