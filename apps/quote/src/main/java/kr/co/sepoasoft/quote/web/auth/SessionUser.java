package kr.co.sepoasoft.quote.web.auth;

import java.io.Serializable;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * 세션에 두는 사용자. Node {@code setSessionUser()} 가 담는 다섯 필드와 같고, 응답 JSON 의
 * {@code user} 도 이 모양이다. {@code picture} 가 없으면 키를 빼지 않고 {@code null} 로 내보낸다.
 */
public record SessionUser(Long id, String email, String name, String picture, String role)
        implements Serializable {

    /** 세션 속성 이름 — Node 의 {@code req.session.user} */
    public static final String ATTR = "user";

    /** 응답 JSON 에 {@code admin} 키가 생기지 않도록 숨긴다 — Node 의 user 는 다섯 필드다 */
    @JsonIgnore
    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }
}
