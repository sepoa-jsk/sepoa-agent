package kr.co.sepoasoft.quote.domain.pricing;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockResult;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Discount;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;

/**
 * {@link PricingEngine} 의 J3 구현 자리. <b>J2 시점에는 전부 미구현이다.</b>
 *
 * <p>모든 메서드가 {@link UnsupportedOperationException} 을 던진다. 그래서 실측 20종
 * JUnit 이 <b>전부 실패</b>한다 — 이것이 J2 의 정상 상태다.
 *
 * <p><b>왜 0 이나 빈 값을 돌려주지 않는가.</b> 그렇게 하면 {@code empty-quote} 케이스가
 * 우연히 통과한다(기대값이 0 이므로). 20종 중 1종이 초록으로 뜨면 "일부는 됐다" 는
 * 잘못된 신호가 되고, 실제로는 엔진이 한 줄도 없는 상태다. 통과가 진짜 구현을
 * 뜻하도록 전부 던진다.
 *
 * <p>J3 에서 이 클래스를 실제 계산으로 채운다. 계약은 {@code docs/ENGINE-CONTRACT.md}.
 */
@Component
public class BlockPricingEngine implements PricingEngine {

    private static final String NOT_YET = "J3 에서 구현한다 — docs/ENGINE-CONTRACT.md 참조";

    @Override
    public QuoteResult calcQuoteBlocks(QuoteInput input) {
        throw new UnsupportedOperationException("calcQuoteBlocks: " + NOT_YET);
    }

    @Override
    public BlockResult calcBlock(BlockInput block) {
        throw new UnsupportedOperationException("calcBlock: " + NOT_YET);
    }

    @Override
    public BigDecimal computeDiscount(Discount discount, BigDecimal base) {
        throw new UnsupportedOperationException("computeDiscount: " + NOT_YET);
    }

    @Override
    public BigDecimal floorTo(BigDecimal amount, BigDecimal unit) {
        throw new UnsupportedOperationException("floorTo: " + NOT_YET);
    }

    @Override
    public List<LaborError> validateMonthAlloc(List<LaborRow> labor) {
        throw new UnsupportedOperationException("validateMonthAlloc: " + NOT_YET);
    }

    @Override
    public Map<String, BigDecimal> monthlyAllocationTotals(List<LaborRow> labor) {
        throw new UnsupportedOperationException("monthlyAllocationTotals: " + NOT_YET);
    }
}
