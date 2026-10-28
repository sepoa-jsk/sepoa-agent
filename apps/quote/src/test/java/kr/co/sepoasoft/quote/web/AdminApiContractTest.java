package kr.co.sepoasoft.quote.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import kr.co.sepoasoft.quote.web.auth.AuthSettings;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * J5-5 관리 쓰기 계약 — 관리자 가드와 DB 를 타기 전 검증 오류. 실제 저장은 Node 와의 실측 비교(테스트 행을 만들고 지운다)가 맡는다.
 */
@WebMvcTest(controllers = { MasterController.class, TemplateController.class, SettingsController.class,
        LaborRateController.class, PricingController.class })
@Import(AuthSettings.class)
@TestPropertySource(properties = { "AUTH_MODE=dev", "API_KEY=test-key" })
@DisplayName("J5-5 관리 쓰기")
class AdminApiContractTest {

    @Autowired MockMvc mvc;
    @MockitoBean Rows db;

    private static MockHttpSession as(String role) {
        MockHttpSession s = new MockHttpSession();
        s.setAttribute(SessionUser.ATTR, new SessionUser(7L, "a@sepoasoft.co.kr", "에이", null, role));
        return s;
    }

    private static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder r, String role, String body) {
        return r.session(as(role)).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    @Test
    @DisplayName("쓰기 창구 12개는 일반 사용자에게 403 FORBIDDEN")
    void adminOnly() throws Exception {
        MockHttpServletRequestBuilder[] writes = {
                post("/api/master/modules"), put("/api/master/modules/1"), delete("/api/master/modules/1"),
                post("/api/templates"), put("/api/templates/1"), put("/api/settings"),
                post("/api/labor-rates/years"), put("/api/labor-rates/1"), patch("/api/labor-rates/years/1/active"),
                post("/api/pricing/items"), put("/api/pricing/items/1"), delete("/api/pricing/items/1") };
        for (MockHttpServletRequestBuilder w : writes) {
            mvc.perform(json(w, "USER", "{}"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error").value("FORBIDDEN"));
        }
    }

    @Test
    @DisplayName("검증 오류 — Node 와 같은 코드·문구 (메시지 없는 것은 없게)")
    void validation() throws Exception {
        mvc.perform(json(post("/api/master/modules"), "ADMIN", "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("MISSING_FIELDS"))
                .andExpect(jsonPath("$.message").doesNotExist());
        mvc.perform(json(post("/api/master/nope"), "ADMIN", "{}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("UNKNOWN_MASTER"));
        // 코드(PK)만 같은 값으로 보내면 Node 처럼 바꿀 것이 없다
        mvc.perform(json(put("/api/master/solutions/X"), "ADMIN", "{\"code\":\"X\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("NOTHING_TO_UPDATE"));
        // 다른 코드면 코드를 바꾸려 한다(API-spec 3절 J, Node 와 다름) — 없는 행이라 404
        mvc.perform(json(put("/api/master/solutions/ZZ_NO_SUCH"), "ADMIN", "{\"code\":\"ZZ_NEW\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(json(post("/api/templates"), "ADMIN", "{\"code\":\"T\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("code/solution/name 은 필수입니다."));
        mvc.perform(json(put("/api/settings"), "ADMIN", "{\"settings\":\"x\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_BODY"));
        mvc.perform(json(post("/api/labor-rates/years"), "ADMIN", "{\"year\":1999}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_YEAR"));
        mvc.perform(json(put("/api/labor-rates/1"), "ADMIN", "{\"x\":1}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("수정할 항목이 없습니다."));
        mvc.perform(json(post("/api/pricing/items"), "ADMIN",
                        "{\"code\":\"C\",\"name\":\"N\",\"solution\":\"S\",\"deployment\":\"D\",\"pricing_type\":\"X\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_PRICING_TYPE"));
        mvc.perform(json(put("/api/pricing/items/1"), "ADMIN", "{\"pricing_type\":\"X\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").doesNotExist());
        mvc.perform(json(put("/api/pricing/items/1/variants"), "ADMIN", "{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("INVALID_VARIANTS"));
    }
}
