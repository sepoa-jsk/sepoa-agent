package kr.co.sepoasoft.quote.web;

import static org.hamcrest.Matchers.aMapWithSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.auth.AuthSettings;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.auth.UserRepository;

/**
 * J5-1 공통 뼈대 계약 — 오류 응답 형태 · 권한 가드 · 개발용 로그인. 명세 {@code API-spec.md} 1장, 2-2절.
 *
 * <p><b>DB 를 쓰지 않는다.</b> {@code sq_users} 쓰기는 {@link UserRepository} 를 목으로 대신한다.
 * 실제 DB 를 거친 응답 대조는 {@code tools/compare-queries.js} 가 맡는다.
 */
@WebMvcTest(controllers = { AuthController.class, ApiContractTest.GuardProbe.class })
@Import(AuthSettings.class)
@TestPropertySource(properties = {
        "AUTH_MODE=dev",
        "ALLOWED_EMAIL_DOMAINS=sepoasoft.co.kr",
        "ADMIN_EMAILS=",
        "API_KEY=test-key",
})
@DisplayName("J5-1 공통 뼈대")
class ApiContractTest {

    @Autowired MockMvc mvc;
    @MockitoBean UserRepository users;

    /** 가드 3종을 시험하려고 테스트에만 두는 엔드포인트 */
    @RestController
    static class GuardProbe {
        @GetMapping("/api/_probe/login") @Access(Level.LOGIN) String login() { return "{}"; }
        @GetMapping("/api/_probe/admin") @Access(Level.ADMIN) String admin() { return "{}"; }
        @PostMapping("/api/_probe/key") @Access(Level.KEY_OR_LOGIN) String key() { return "{}"; }
        @GetMapping("/api/_probe/boom") String boom() { throw new IllegalStateException("터졌다"); }
    }

    private static MockHttpSession sessionOf(String role) {
        MockHttpSession s = new MockHttpSession();
        s.setAttribute(SessionUser.ATTR, new SessionUser(7L, "a@sepoasoft.co.kr", "에이", null, role));
        return s;
    }

    @Nested
    @DisplayName("오류 응답 형태")
    class Errors {

        @Test
        @DisplayName("없는 /api 경로는 404 NOT_FOUND + 'METHOD 원래URL'")
        void unknownPath() throws Exception {
            mvc.perform(get("/api/nope?a=1"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.error").value("NOT_FOUND"))
                    .andExpect(jsonPath("$.message").value("GET /api/nope?a=1"));
        }

        @Test
        @DisplayName("메서드가 틀려도 405 가 아니라 404 — Express 동작")
        void wrongMethod() throws Exception {
            mvc.perform(delete("/api/auth/me"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.message").value("DELETE /api/auth/me"));
        }

        @Test
        @DisplayName("처리되지 않은 예외는 500 INTERNAL + 예외 메시지")
        void unhandled() throws Exception {
            mvc.perform(get("/api/_probe/boom"))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.error").value("INTERNAL"))
                    .andExpect(jsonPath("$.message").value("터졌다"));
        }
    }

    @Nested
    @DisplayName("권한 가드")
    class Guards {

        @Test
        @DisplayName("로그인 가드 — 세션 없으면 401, 문구 '로그인이 필요합니다.'")
        void loginRequired() throws Exception {
            mvc.perform(get("/api/_probe/login"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error").value("UNAUTHENTICATED"))
                    .andExpect(jsonPath("$.message").value("로그인이 필요합니다."));
            mvc.perform(get("/api/_probe/login").session(sessionOf("USER"))).andExpect(status().isOk());
        }

        @Test
        @DisplayName("관리자 가드 — 미로그인 401, USER 403 FORBIDDEN, ADMIN 통과")
        void adminRequired() throws Exception {
            mvc.perform(get("/api/_probe/admin")).andExpect(status().isUnauthorized());
            mvc.perform(get("/api/_probe/admin").session(sessionOf("USER")))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error").value("FORBIDDEN"))
                    .andExpect(jsonPath("$.message").value("관리자 권한이 필요합니다."));
            mvc.perform(get("/api/_probe/admin").session(sessionOf("ADMIN"))).andExpect(status().isOk());
        }

        @Test
        @DisplayName("키/로그인 가드 — 맞는 키 통과, 틀린 키 401 '인증이 필요합니다.'")
        void keyOrLogin() throws Exception {
            mvc.perform(post("/api/_probe/key").header("X-API-Key", "test-key")).andExpect(status().isOk());
            mvc.perform(post("/api/_probe/key").header("X-API-Key", "wrong"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.message").value("인증이 필요합니다."));
            mvc.perform(post("/api/_probe/key").session(sessionOf("USER"))).andExpect(status().isOk());
        }
    }

    @Nested
    @DisplayName("/api/auth")
    class Auth {

        @Test
        @DisplayName("dev-login 성공 — user 다섯 필드(picture null 포함), 이후 /me 통과")
        void devLogin() throws Exception {
            given(users.provision(eq("kim@sepoasoft.co.kr"), eq("kim"), isNull()))
                    .willReturn(new SessionUser(3L, "kim@sepoasoft.co.kr", "kim", null, "USER"));
            MockHttpSession session = new MockHttpSession();
            mvc.perform(post("/api/auth/dev-login").session(session)
                            .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\" kim@sepoasoft.co.kr \"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.user", aMapWithSize(5)))
                    .andExpect(jsonPath("$.user.id").value(3))
                    .andExpect(jsonPath("$.user.picture").isEmpty())
                    .andExpect(jsonPath("$.user.role").value("USER"));
            mvc.perform(get("/api/auth/me").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.user.email").value("kim@sepoasoft.co.kr"))
                    .andExpect(jsonPath("$.authMode").value("dev"));
        }

        @Test
        @DisplayName("dev-login 이메일 오류 400 INVALID_EMAIL · 도메인 403 DOMAIN_NOT_ALLOWED")
        void devLoginRejects() throws Exception {
            mvc.perform(post("/api/auth/dev-login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"nope\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("INVALID_EMAIL"));
            mvc.perform(post("/api/auth/dev-login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"a@gmail.com\"}"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error").value("DOMAIN_NOT_ALLOWED"));
        }

        @Test
        @DisplayName("dev-login 중 DB 오류는 500 AUTH_FAILED (INTERNAL 아님)")
        void devLoginDbError() throws Exception {
            given(users.provision(any(), any(), any())).willThrow(new IllegalStateException("db down"));
            mvc.perform(post("/api/auth/dev-login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"a@sepoasoft.co.kr\"}"))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.error").value("AUTH_FAILED"))
                    .andExpect(jsonPath("$.message").value("db down"));
        }

        @Test
        @DisplayName("logout — 세션 없어도 {ok:true}, 이후 /me 401")
        void logout() throws Exception {
            MockHttpSession session = sessionOf("USER");
            mvc.perform(post("/api/auth/logout").session(session))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.ok").value(true));
            mvc.perform(post("/api/auth/logout")).andExpect(status().isOk());
            mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        }

        @Test
        @DisplayName("google — 토큰 없으면 400 MISSING_TOKEN, 있으면 401 AUTH_FAILED (J8 전)")
        void google() throws Exception {
            mvc.perform(post("/api/auth/google").contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("MISSING_TOKEN"));
            mvc.perform(post("/api/auth/google").contentType(MediaType.APPLICATION_JSON).content("{\"credential\":\"x\"}"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error").value("AUTH_FAILED"));
        }
    }
}
