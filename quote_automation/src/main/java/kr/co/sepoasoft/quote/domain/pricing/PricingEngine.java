package kr.co.sepoasoft.quote.domain.pricing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;

import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockResult;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Discount;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;

/**
 * 견적 계산 엔진.
 *
 * <p><b>계산 순서는 고정이며 바꾸지 않는다.</b>
 * <pre>블록 소계 합 → 특별DC → 절사(십만단위) → VAT 별도</pre>
 * 일시불과 월(recurring)을 분리해 산출하고, <b>월 금액은 절사하지 않는다</b>
 * (150,000 같은 밴드 금액이 십만절사되면 깨진다).
 *
 * <p>계약 전문은 {@code docs/ENGINE-CONTRACT.md}. 검수 기준은
 * {@code quote/test/fixtures/engine/} 의 실측 20종이며, 전부 통과가 J3 DoD 다.
 *
 * <p>구현은 J3 에서 한다. J2 는 이 인터페이스와 테스트 명세까지다.
 */
public interface PricingEngine {

    /**
     * 반올림 정책 — 금액은 전부 이 모드로 정수화한다.
     *
     * <p>Node 는 {@code Math.round} 를 쓰는데 그것은 <b>+∞ 방향</b> half-up 이라
     * 음수 반값에서 Java 의 {@code HALF_UP}(0 에서 멀어지는 방향)과 갈린다
     * ({@code Math.round(-2.5) == -2} vs {@code HALF_UP(-2.5) == -3}).
     * 양수에서는 완전히 일치한다.
     *
     * <p>이 도메인에서 음수 금액은 계약 위반이므로 {@code HALF_UP} 을 쓰고
     * <b>음수 입력을 거부한다.</b> JS 동작을 흉내내지 않는다 — 음수를 정상 입력으로
     * 인정하면 "할인이 금액을 늘리는" 견적이 가능해진다.
     */
    RoundingMode MONEY_ROUNDING = RoundingMode.HALF_UP;

    /** 금액 스케일 — 원 단위 정수. */
    int MONEY_SCALE = 0;

    /** 공수·월별 배분 비교 허용오차. Node 와 같다. */
    BigDecimal ALLOC_TOLERANCE = new BigDecimal("0.001");

    /** VAT 율. */
    BigDecimal VAT_RATE = new BigDecimal("0.1");

    /** 견적 전체 계산. 계산 순서를 따른다. */
    QuoteResult calcQuoteBlocks(QuoteInput input);

    /**
     * 블록 1개의 라인별 금액과 소계.
     *
     * <p>인건비 판정은 {@code "LABOR".equals(blockCode)} 하나로 한다.
     * 컬렉션의 존재·크기로 판정하지 않는다(docs/LESSONS.md 3번).
     */
    BlockResult calcBlock(BlockInput block);

    /**
     * 특별DC.
     *
     * <p>{@code AMOUNT} = 할인액, {@code RATE} = {@code base × value / 100},
     * {@code TARGET} = {@code max(0, base − value)}.
     *
     * <p><b>{@code TARGET} 의 value 0 은 유효한 값이다</b>(하겐다즈 "무상제공").
     * 미입력(null)만 걸러낸다 — 0 을 미입력으로 오판한 전례가 데이터 손상을 냈다.
     */
    BigDecimal computeDiscount(Discount discount, BigDecimal base);

    /** 절사 — {@code unit} 단위 내림. {@code unit} 이 0 이하면 절사하지 않는다. 반올림이 아니라 {@code FLOOR} 다. */
    BigDecimal floorTo(BigDecimal amount, BigDecimal unit);

    /**
     * 인력투입계획 검증 — {@code Σ month_alloc == mm} (허용오차 {@link #ALLOC_TOLERANCE}).
     *
     * <p>{@code month_alloc} 은 {@code Map} 또는 DB 저장 형태인 JSON 문자열 둘 다 받는다.
     * 값이 없으면 검증을 건너뛴다(옵션 기능).
     */
    List<LaborError> validateMonthAlloc(List<LaborRow> labor);

    /**
     * 인력투입계획 부록의 월별 합계행 (M · M1 · M2 …).
     *
     * <p>Node 에서는 테스트 안의 헬퍼였다. J7 의 인력투입계획 부록이 실제로 쓰므로
     * 엔진 계약으로 승격했다.
     */
    Map<String, BigDecimal> monthlyAllocationTotals(List<LaborRow> labor);
}
