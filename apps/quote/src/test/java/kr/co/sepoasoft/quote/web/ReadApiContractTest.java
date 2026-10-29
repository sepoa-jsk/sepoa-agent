package kr.co.sepoasoft.quote.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import kr.co.sepoasoft.quote.domain.pricing.BlockPricingEngine;
import kr.co.sepoasoft.quote.web.auth.AuthSettings;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * J5-2 조회 창구 계약 — 가드와 DB 를 타지 않는 오류만. 실제 값 대조는 Node 와의 실측 비교가 맡는다.
 */
@WebMvcTest(controllers = { MasterController.class, TemplateController.class, QuoteController.class,
        SettingsController.class, LaborRateController.class })
@Import({ AuthSettings.class, QuoteLoader.class, QuoteCalc.class, BlockPricingEngine.class, QuoteHtml.class, QuotePdf.class, QuoteExcel.class, QuoteMailer.class })
@TestPropertySource(properties = { "AUTH_MODE=dev", "API_KEY=test-key" })
@DisplayName("J5-2 조회 창구")
class ReadApiContractTest {

    @Autowired MockMvc mvc;
    @MockitoBean Rows db;
    @MockitoBean QuoteWriter writer;

    private static MockHttpSession login() {
        MockHttpSession s = new MockHttpSession();
        s.setAttribute(SessionUser.ATTR, new SessionUser(7L, "a@sepoasoft.co.kr", "에이", null, "USER"));
        return s;
    }

    @Test
    @DisplayName("조회 창구는 모두 로그인 필요 — 401")
    void loginRequired() throws Exception {
        for (String path : List.of("/api/master", "/api/master/modules", "/api/blocks", "/api/conditions",
                "/api/templates", "/api/templates/X", "/api/quotes", "/api/quotes/1", "/api/settings",
                "/api/labor-rates/years", "/api/labor-rates")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
    }

    @Test
    @DisplayName("모르는 마스터는 404 UNKNOWN_MASTER + 이름")
    void unknownMaster() throws Exception {
        mvc.perform(get("/api/master/nope").session(login()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("UNKNOWN_MASTER"))
                .andExpect(jsonPath("$.message").value("알 수 없는 마스터: nope"));
    }

    @Test
    @DisplayName("없는 견적·템플릿은 404 NOT_FOUND (메시지 없음), 숫자 아닌 id 도 404")
    void notFound() throws Exception {
        given(db.first(anyString(), any())).willReturn(null);
        mvc.perform(get("/api/quotes/999999").session(login()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"))
                .andExpect(jsonPath("$.message").doesNotExist());
        mvc.perform(get("/api/quotes/abc").session(login())).andExpect(status().isNotFound());
        mvc.perform(get("/api/templates/NOPE").session(login())).andExpect(status().isNotFound());
    }
}
