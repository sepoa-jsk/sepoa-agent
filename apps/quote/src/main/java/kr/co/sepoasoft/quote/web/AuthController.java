package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.auth.AccessInterceptor;
import kr.co.sepoasoft.quote.web.auth.AuthSettings;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.auth.UserRepository;

/**
 * {@code /api/auth} — Node {@code routes/auth.js} 이식. 명세 2-2절 (#2~#5).
 *
 * <p><b>세션은 Node 와 공유하지 않는다</b>(J8 전까지). Java 는 자기 세션 쿠키(JSESSIONID, 경로 /quote2)를
 * 쓰므로 대조할 때는 각 앱에서 따로 dev 로그인한다.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthSettings settings;
    private final UserRepository users;

    public AuthController(AuthSettings settings, UserRepository users) {
        this.settings = settings;
        this.users = users;
    }

    /**
     * #2 Google 로그인 — <b>J5 에서는 자리만</b> 둔다. 토큰 검증(Spring Security OAuth2)은 J8.
     * 토큰이 없을 때의 400 은 Node 와 같고, 있으면 검증 실패와 같은 401 AUTH_FAILED 로 답한다.
     */
    @PostMapping("/google")
    public Map<String, Object> google(@RequestBody(required = false) Map<String, Object> body) {
        Object token = body == null ? null : firstNonEmpty(body.get("credential"), body.get("id_token"));
        if (token == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MISSING_TOKEN", "Google ID token이 필요합니다.");
        }
        throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_FAILED", "Google 로그인은 Java 이식 J8 에서 연결됩니다.");
    }

    /** #3 개발용 로그인 — AUTH_MODE=dev 에서만 */
    @PostMapping("/dev-login")
    public Map<String, Object> devLogin(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest req) {
        if (!settings.isDevMode()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "DEV_LOGIN_DISABLED", "개발용 로그인은 AUTH_MODE=dev에서만 허용됩니다.");
        }
        Object rawEmail = body == null ? null : body.get("email");
        String email = rawEmail == null ? "" : String.valueOf(rawEmail).trim();
        if (email.isEmpty() || !email.contains("@")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_EMAIL", "유효한 이메일이 필요합니다.");
        }
        if (!settings.isAllowedDomain(email)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "DOMAIN_NOT_ALLOWED", "허용되지 않은 이메일 도메인입니다.");
        }
        Object rawName = body.get("name");
        String name = rawName == null || String.valueOf(rawName).isEmpty() ? email.split("@")[0] : String.valueOf(rawName);
        SessionUser user;
        try {
            user = users.provision(email, name, null);
        } catch (UserRepository.DisabledUserException e) {
            throw new ApiException(HttpStatus.FORBIDDEN, "USER_DISABLED", e.getMessage());
        } catch (RuntimeException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "AUTH_FAILED", e.getMessage());
        }
        req.getSession(true).setAttribute(SessionUser.ATTR, user);
        return Map.of("user", user);
    }

    /** #4 로그아웃 — 세션이 없어도 성공 */
    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest req) {
        HttpSession session = req.getSession(false);
        if (session != null) session.invalidate();
        return Map.of("ok", true);
    }

    /** #5 현재 사용자 */
    @GetMapping("/me")
    @Access(Level.LOGIN)
    public Map<String, Object> me(HttpServletRequest req) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("user", AccessInterceptor.currentUser(req));
        out.put("authMode", settings.authMode());
        return out;
    }

    /** JS 의 {@code a || b} — 빈 문자열도 거짓으로 본다 */
    private static Object firstNonEmpty(Object a, Object b) {
        if (a != null && !"".equals(a)) return a;
        if (b != null && !"".equals(b)) return b;
        return null;
    }
}
