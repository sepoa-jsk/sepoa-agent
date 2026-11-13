package kr.co.sepoasoft.quote.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 노임단가표 읽기. 글자는 PDFBox 가 견적서 끝장(한국SW산업협회 2026년 SW기술자 평균임금 요약표)에서 뽑은 그대로다.
 * 기대 적용단가는 문서 계산표의 계와 같다(컨설턴트·PM·응용SW·UI/UX). 품질관리자·아키텍트·운용자는 문서에 계가 없어
 * 같은 산정식으로 낸 값이다 — DB 의 2026년 아키텍트·운용자 값(27,980,142 · 26,835,770)은 칸을 먼저 반올림한 것이라 1원 크다.
 */
@DisplayName("노임단가표 읽기")
class LaborRateSheetTest {

    private static final BigDecimal D20_5 = new BigDecimal("20.5");

    private static final String SHEET = """
            한국SW산업협회 기준 SW기술자 평균임금
            노임단가(M/D) 평균임금 평균임금
            구분 비고
            2025년 2026년 (M/M) (M/H)
            IT 컨설턴트         471,166         522,340       9,706,020           58,896 PM
            IT PM         443,955         492,039       9,145,473           55,494 PM
            응용소프트웨어 개발자         337,061         378,250       6,943,457           42,133 고급,중급개발자
            UI/UX 개발자         326,566         336,666       6,727,260           40,821 초급개발자
            IT 품질관리자         470,490         538,638       9,692,094           58,811 PMO, 사업관리
            IT 아키텍트         492,609         541,621     10,147,745           61,576 SW 아키텍트
            정보시스템 운용자         492,943         519,469     10,154,626           61,618 기술지원
            항목 기준금액 요율 산정금액 산정근거
            평균임금(M/M)         522,340 20.5     10,707,970 평균임금(M/D)*근무일
            IT 컨설턴트 제경비     10,707,970 1.1     11,778,767 평균임금(M/M)*110%
            기술료     22,486,737 0.2       4,497,347 (평균임금(M/M)+제경비)*20%
            계    26,984,084
            [시행일] 2026년 1월 1일부터 2026년 12월 31일까지 적용
            2025년 12월 19일
            """;

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> r) {
        return (List<Map<String, Object>>) r.get("rows");
    }

    @Test
    @DisplayName("2026년 — 올해 칸 M/D 를 읽고 산정식 결과가 문서 계산표와 같다 (계산표 행은 건너뛴다)")
    void year2026() {
        Map<String, Object> r = LaborRateSheet.parse(SHEET, 2026, D20_5);
        List<Map<String, Object>> rows = rows(r);
        assertThat(rows).extracting(m -> m.get("role_name")).containsExactly(
                "IT 컨설턴트", "IT PM", "응용소프트웨어 개발자", "UI/UX 개발자", "IT 품질관리자", "IT 아키텍트", "정보시스템 운용자");
        assertThat(rows).extracting(m -> m.get("wage_md")).containsExactly(
                522340L, 492039L, 378250L, 336666L, 538638L, 541621L, 519469L);
        assertThat(rows).extracting(m -> m.get("apply_price")).containsExactly(
                26984084L, 25418735L, 19540395L, 17392166L, 27826039L, 27980141L, 26835769L);
        assertThat(rows.get(0)).containsEntry("wage_mm", 10707970L).containsEntry("overhead", 11778767L)
                .containsEntry("tech_fee", 4497347L).containsEntry("doc_note", "PM");
        assertThat((List<?>) r.get("warnings")).isEmpty();
    }

    @Test
    @DisplayName("2025년 — 전년 칸을 읽는다")
    void year2025() {
        assertThat(rows(LaborRateSheet.parse(SHEET, 2025, D20_5))).extracting(m -> m.get("wage_md")).startsWith(471166L, 443955L);
    }

    @Test
    @DisplayName("표에 없는 연도 — 가장 최근 칸을 읽고 경고한다. 표가 없으면 경고만")
    void mismatch() {
        Map<String, Object> r = LaborRateSheet.parse(SHEET, 2027, D20_5);
        assertThat(rows(r)).extracting(m -> m.get("wage_md")).startsWith(522340L);
        assertThat((List<String>) r.get("warnings")).anyMatch(w -> w.contains("2027"));
        Map<String, Object> empty = LaborRateSheet.parse("아무 표도 없는 문서", 2027, D20_5);
        assertThat(rows(empty)).isEmpty();
        assertThat((List<String>) empty.get("warnings")).isNotEmpty();
    }

    @Test
    @DisplayName("근무일 — 협회 문서의 '월 임금 ÷ 20.5(일)' 문구에서 읽고, 없으면 null")
    void workDays() {
        assertThat(LaborRateSheet.workDays("※ 일 임금 = 월 임금 ÷ 20.5(일), 시간 임금 = 일 임금 ÷ 8(시간)")).isEqualByComparingTo("20.5");
        assertThat(LaborRateSheet.workDays("일평균임금은 월평균임금 ÷ 20.6 (일)")).isEqualByComparingTo("20.6");
        assertThat(LaborRateSheet.workDays("근무일 표기 없음")).isNull();
    }

    @Test
    @DisplayName("2025년 근무일 20.6일 — 내부 도표양식의 계와 같다(IT PM 443,955 → 23,046,592)")
    void computeWithWorkDays() {
        assertThat(LaborRateSheet.compute(443955, new BigDecimal("20.6")).get("apply_price")).isEqualTo(23046592L);
    }
}
