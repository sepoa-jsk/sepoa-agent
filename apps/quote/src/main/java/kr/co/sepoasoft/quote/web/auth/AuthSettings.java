package kr.co.sepoasoft.quote.web.auth;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 인증 관련 환경변수. 이름과 기본값을 Node {@code infra/auth.js} 와 똑같이 둔다 —
 * 같은 {@code .env} 를 두 앱이 함께 읽는다({@code application-dev.yml} 의 config.import).
 */
@Component
public class AuthSettings {

    private final String authMode;
    private final List<String> allowedDomains;
    private final List<String> adminEmails;
    private final String apiKey;

    public AuthSettings(
            @Value("${AUTH_MODE:dev}") String authMode,
            @Value("${ALLOWED_EMAIL_DOMAINS:sepoasoft.co.kr}") String allowedDomains,
            @Value("${ADMIN_EMAILS:}") String adminEmails,
            @Value("${API_KEY:}") String apiKey) {
        this.authMode = authMode;
        this.allowedDomains = splitLower(allowedDomains);
        this.adminEmails = splitLower(adminEmails);
        this.apiKey = apiKey;
    }

    private static List<String> splitLower(String csv) {
        return Arrays.stream(csv.split(","))
                .map(s -> s.trim().toLowerCase())
                .filter(s -> !s.isEmpty())
                .toList();
    }

    public String authMode() { return authMode; }

    public boolean isDevMode() { return "dev".equals(authMode); }

    /** Node {@code isAllowedDomain} — 목록이 비면 전부 허용 */
    public boolean isAllowedDomain(String email) {
        if (allowedDomains.isEmpty()) return true;
        int at = String.valueOf(email).indexOf('@');
        if (at < 0) return false;
        String domain = String.valueOf(email).substring(at + 1).split("@")[0].toLowerCase();
        return !domain.isEmpty() && allowedDomains.contains(domain);
    }

    public boolean isAdminEmail(String normalizedEmail) {
        return adminEmails.contains(normalizedEmail);
    }

    /** Node {@code apiKeyOrAuth} — API_KEY 가 설정돼 있고 헤더 값이 같을 때만 */
    public boolean matchesApiKey(String headerValue) {
        return !apiKey.isEmpty() && headerValue != null && !headerValue.isEmpty() && apiKey.equals(headerValue);
    }
}
