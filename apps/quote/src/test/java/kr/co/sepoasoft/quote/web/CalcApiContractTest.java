package kr.co.sepoasoft.quote.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

import kr.co.sepoasoft.quote.domain.pricing.BlockPricingEngine;
import kr.co.sepoasoft.quote.web.auth.AuthSettings;
import kr.co.sepoasoft.quote.web.auth.SessionUser;
import kr.co.sepoasoft.quote.web.support.Rows;

/**
 * J5-3 계산 창구 계약 — 응답 모양과 오류. 금액 자체는 J3 실측 20종이 지키고, Node 와의 값 대조는 실측 비교가 맡는다.
 * 엔진은 진짜({@link BlockPricingEngine}), DB 는 목이다.
 */
@WebMvcTest(controllers = QuoteCalcController.class)
@Import({ AuthSettings.class, BlockPricingEngine.class })
@TestPropertySource(properties = { "AUTH_MODE=dev", "API_KEY=test-key" })
@DisplayName("J5-3 계산 창구")
class CalcApiContractTest {

    @Autowired MockMvc mvc;
    @MockitoBean Rows db;

    /** 솔브레인 전자계약 — 솔루션 50,000,000 + 인건비 36,600,000 → TARGET 60,000,000 */
    private static final String SOLBRAIN = """
            {"blocks":[
              {"block_code":"SOLUTION","title":"솔루션","items":[{"item_code":"X","qty":1,"proposed_price":"50000000"}]},
              {"block_code":"LABOR","labor":[{"role_code":"PM","mm":"3","proposed_price":12200000}]}],
             "discount":{"type":"TARGET","value":60000000}}""";

    private static MockHttpSession login() {
        MockHttpSession s = new MockHttpSession();
        s.setAttribute(SessionUser.ATTR, new SessionUser(7L, "a@sepoasoft.co.kr", "에이", null, "USER"));
        return s;
    }

    private static MockHttpServletRequestBuilder json(String path, String body) {
        return post(path).session(login()).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    @Test
    @DisplayName("calculate — 블록을 되돌려 주며 라인 금액·소계를 채운다 (솔브레인 60,000,000)")
    void calculateBlocks() throws Exception {
        mvc.perform(json("/api/quotes/calculate", SOLBRAIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blocks[0].title").value("솔루션"))
                .andExpect(jsonPath("$.blocks[0].items[0].proposed_price").value(50000000))
                .andExpect(jsonPath("$.blocks[0].items[0].amount").value(50000000))
                .andExpect(jsonPath("$.blocks[0].labor").doesNotExist())
                .andExpect(jsonPath("$.blocks[1].labor[0].mm").value(3))
                .andExpect(jsonPath("$.blocks[1].labor[0].amount").value(36600000))
                .andExpect(jsonPath("$.blocks[1].items").doesNotExist())
                .andExpect(jsonPath("$.blocks[1].recurring").value(false))
                .andExpect(jsonPath("$.onetime_subtotal").value(86600000))
                .andExpect(jsonPath("$.onetime_total").value(60000000))
                .andExpect(jsonPath("$.vat_amount").value(6000000))
                .andExpect(jsonPath("$.discount_type").value("TARGET"))
                .andExpect(jsonPath("$.round_unit").value(100000))
                .andExpect(jsonPath("$.labor_errors").isEmpty());
    }

    @Test
    @DisplayName("calculate — 키/로그인 가드: 키만 있어도 통과, 둘 다 없으면 401 '인증이 필요합니다.'")
    void calculateGuard() throws Exception {
        mvc.perform(post("/api/quotes/calculate").header("X-API-Key", "test-key")
                .contentType(MediaType.APPLICATION_JSON).content(SOLBRAIN)).andExpect(status().isOk());
        mvc.perform(post("/api/quotes/calculate").contentType(MediaType.APPLICATION_JSON).content(SOLBRAIN))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value("인증이 필요합니다."));
    }

    @Test
    @DisplayName("calculate — 빈 blocks 400 NO_BLOCKS, 아무것도 없으면 400 NO_SECTIONS")
    void calculateEmpty() throws Exception {
        mvc.perform(json("/api/quotes/calculate", "{\"blocks\":[]}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("NO_BLOCKS"));
        mvc.perform(json("/api/quotes/calculate", "{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("NO_SECTIONS"));
    }

    @Test
    @DisplayName("calculate — 섹션 스냅샷 경로는 계산, 구 가격정책 경로는 501")
    void calculateSections() throws Exception {
        mvc.perform(json("/api/quotes/calculate",
                "{\"sections\":[{\"solution\":\"SEAL\",\"items\":[{\"block_code\":\"SOLUTION\",\"unit_price\":1000,\"qty\":3}],\"labor\":[{\"proposed_price\":500,\"mm\":2}]}],"
                        + "\"discount\":{\"type\":\"RATE\",\"value\":10}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections[0].solution").value("SEAL"))
                .andExpect(jsonPath("$.sections[0].items[0].amount").value(3000))
                .andExpect(jsonPath("$.sections[0].subtotal").value(4000))
                .andExpect(jsonPath("$.discount_amount").value(400))
                .andExpect(jsonPath("$.total_amount").value(3960));
        mvc.perform(json("/api/quotes/calculate", "{\"sections\":[{\"items\":[{\"code\":\"X\"}]}]}"))
                .andExpect(status().isNotImplemented())
                .andExpect(jsonPath("$.error").value("NOT_IMPLEMENTED"));
    }

    @Test
    @DisplayName("calculate — 음수 금액은 엔진이 거부한다: 400 INVALID_INPUT")
    void negative() throws Exception {
        mvc.perform(json("/api/quotes/calculate",
                "{\"blocks\":[{\"block_code\":\"SOLUTION\",\"items\":[{\"proposed_price\":-1}]}]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_INPUT"));
    }

    @Test
    @DisplayName("preview — calc 는 calculate 와 같고 html 은 빈 문자열(J7 전), blocks 가 배열이 아니면 400")
    void preview() throws Exception {
        mvc.perform(json("/api/quotes/preview", SOLBRAIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.html").value(""))
                .andExpect(jsonPath("$.calc.onetime_total").value(60000000));
        mvc.perform(json("/api/quotes/preview", "{\"blocks\":[]}")).andExpect(status().isOk());
        mvc.perform(json("/api/quotes/preview", "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("blocks 가 필요합니다."));
    }

    @Test
    @DisplayName("apply-template — 없는 템플릿은 404 + '템플릿을 찾을 수 없습니다.'")
    void applyTemplateMissing() throws Exception {
        given(db.first(anyString(), any())).willReturn(null);
        mvc.perform(json("/api/quotes/apply-template", "{\"template_code\":\"NOPE\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("템플릿을 찾을 수 없습니다."));
    }
}
