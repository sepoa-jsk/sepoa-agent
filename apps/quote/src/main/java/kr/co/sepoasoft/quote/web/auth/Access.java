package kr.co.sepoasoft.quote.web.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 엔드포인트 권한. Node {@code infra/auth.js} 의 가드 3종에 대응한다 — {@code API-spec.md} 1-1절.
 *
 * <p>메서드에 붙인 것이 클래스에 붙인 것보다 우선한다. <b>아무것도 없으면 공개다</b> (Node 도
 * 가드를 빠뜨리면 공개가 된다). 명세 표의 "권한" 열과 하나씩 대조할 것.
 */
@Target({ ElementType.METHOD, ElementType.TYPE })
@Retention(RetentionPolicy.RUNTIME)
public @interface Access {

    Level value();

    enum Level {
        /** 가드 없음 */
        PUBLIC,
        /** {@code requireAuth} — 세션에 사용자 */
        LOGIN,
        /** {@code requireAdmin} — 로그인 + role ADMIN */
        ADMIN,
        /** {@code apiKeyOrAuth} — X-API-Key 헤더 또는 로그인 (타시스템 연계용) */
        KEY_OR_LOGIN
    }
}
