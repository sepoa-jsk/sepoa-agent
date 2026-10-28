package kr.co.sepoasoft.quote.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

import kr.co.sepoasoft.quote.domain.pricing.BlockPricingEngine;
import kr.co.sepoasoft.quote.web.auth.AuthSettings;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * J5-4 견적 쓰기 계약 — 검증 오류·404·#18. 실제 저장 결과는 Node 와의 실측 비교(테스트 견적을 만들고 지운다)가 맡는다.
 */
@WebMvcTest(controllers = QuoteController.class)
@Import({ AuthSettings.class, QuoteLoader.class, QuoteCalc.class, BlockPricingEngine.class })
@TestPropertySource(properties = { "AUTH_MODE=dev", "API_KEY=test-key" })
@DisplayName("J5-4 견적 쓰기")
class WriteApiContractTest {

    @Autowired MockMvc mvc;
    @MockitoBean Rows db;
    @MockitoBean QuoteWriter writer;

    private static MockHttpSession login() {
        MockHttpSession s = new MockHttpSession();
        s.setAttribute(SessionUser.ATTR, new SessionUser(7L, "a@sepoasoft.co.kr", "에이", null, "USER"));
        return s;
    }

    @Test
    @DisplayName("생성·수정 — blocks 도 sections 도 없으면 400 NO_SECTIONS, 저장하지 않는다")
    void noSections() throws Exception {
        mvc.perform(post("/api/quotes").session(login()).contentType(MediaType.APPLICATION_JSON).content("{\"blocks\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("NO_SECTIONS"));
        mvc.perform(put("/api/quotes/1").session(login()).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        verify(writer, never()).create(any(), any(), org.mockito.ArgumentMatchers.anyBoolean(), any());
    }

    @Test
    @DisplayName("상태 변경 — 목록 밖 값은 400 INVALID_STATUS, 없는 견적은 404")
    void statusChange() throws Exception {
        mvc.perform(patch("/api/quotes/1/status").session(login()).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"DONE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("status는 DRAFT/SENT/WON/LOST 중 하나여야 합니다."));
        mvc.perform(patch("/api/quotes/1/status").session(login()).contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"WON\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("수정·삭제 — 없는 견적은 404 NOT_FOUND")
    void missingQuote() throws Exception {
        given(db.first(anyString(), any())).willReturn(null);
        mvc.perform(put("/api/quotes/9").session(login()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"blocks\":[{\"block_code\":\"SOLUTION\"}]}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/quotes/9").session(login())).andExpect(status().isNotFound());
        mvc.perform(delete("/api/quotes/abc").session(login())).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("Excel·PDF — 견적이 있으면 501 NOT_IMPLEMENTED(J7 전), 없으면 404")
    void exportsNotYet() throws Exception {
        given(db.first(anyString(), any())).willReturn(null);
        mvc.perform(get("/api/quotes/9/pdf").session(login())).andExpect(status().isNotFound());
        given(db.first(anyString(), any())).willReturn(new LinkedHashMap<>(Map.of("id", 9)));
        given(db.query(anyString(), any())).willReturn(List.of());
        mvc.perform(get("/api/quotes/9/excel").session(login()))
                .andExpect(status().isNotImplemented())
                .andExpect(jsonPath("$.error").value("NOT_IMPLEMENTED"));
    }

    @Test
    @DisplayName("#18 — 상세 헤더에 우산 섹션의 solution·brand·contract_months 가 실린다")
    void issue18() throws Exception {
        given(db.first(anyString(), any())).willReturn(new LinkedHashMap<>(Map.of("id", 9, "quote_no", "QT20261028_001")));
        Map<String, Object> umbrella = new LinkedHashMap<>(Map.of("id", 90, "solution", "SEAL", "brand", "ESEAL", "contract_months", 12));
        given(db.query(anyString(), any())).willAnswer(inv -> inv.<String>getArgument(0).contains("sq_quote_sections")
                ? List.of(umbrella) : List.of());
        mvc.perform(get("/api/quotes/9").session(login()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quote.solution").value("SEAL"))
                .andExpect(jsonPath("$.quote.brand").value("ESEAL"))
                .andExpect(jsonPath("$.quote.contract_months").value(12));
    }
}
