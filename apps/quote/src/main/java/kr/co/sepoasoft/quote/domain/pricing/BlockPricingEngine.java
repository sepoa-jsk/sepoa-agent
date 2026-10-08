package kr.co.sepoasoft.quote.domain.pricing;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockResult;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.BlockSubtotal;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.Discount;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.ItemRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborError;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.LaborRow;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteInput;
import kr.co.sepoasoft.quote.domain.pricing.PricingModels.QuoteResult;

/**
 * {@link PricingEngine} 구현 — Node {@code quote/src/domain/pricing/engine.js} 이식.
 *
 * <p><b>순수 함수다.</b> DB·HTTP·파일 의존이 없다. 그래서 J2 의 실측 20종만으로 검수된다.
 *
 * <p>계산 순서는 고정이다.
 * <pre>블록 소계 합 → 특별DC → 절사(십만단위) → VAT 별도</pre>
 *
 * <p>Node 를 그대로 옮기되 <b>조용한 실패는 복제하지 않았다</b>. Node 의 {@code num()} 은
 * 파싱 불가 값을 전부 0 으로 만들어 삼켰다. 여기서는 음수 금액·잘못된 JSON 을
 * 예외로 표면화한다({@code docs/LESSONS.md}).
 */
@Component
public class BlockPricingEngine implements PricingEngine {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, BigDecimal>> ALLOC_MAP = new TypeReference<>() {};

    // ── 공통 헬퍼 ───────────────────────────────────────────────────

    /** null 을 0 으로 본다. Node 의 {@code num()} 중 null 처리에 해당한다. */
    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    /** 금액을 원 단위로 정규화한다. 반올림 정책은 {@link PricingEngine#MONEY_ROUNDING}. */
    private static BigDecimal money(BigDecimal v) {
        return v.setScale(MONEY_SCALE, MONEY_ROUNDING);
    }

    /**
     * 음수 금액을 거부한다.
     *
     * <p>Node 는 음수를 그대로 통과시켰고 {@code Math.round} 의 음수 반값 처리가
     * Java {@code HALF_UP} 과 달라 값이 갈린다. 무엇보다 음수 단가·음수 할인은
     * "할인이 금액을 늘리는" 견적을 만든다. 계약 위반이므로 여기서 멈춘다.
     */
    private static BigDecimal requireNonNegative(BigDecimal v, String what) {
        if (v != null && v.signum() < 0) {
            throw new IllegalArgumentException(what + " 는 음수일 수 없습니다: " + v.toPlainString());
        }
        return v;
    }

    // ── calcBlock ──────────────────────────────────────────────────

    @Override
    public BlockResult calcBlock(BlockInput block) {
        if (block == null) {
            throw new IllegalArgumentException("block 이 null 입니다");
        }
        // 인건비 판정은 blockCode 하나로만 한다.
        // 컬렉션 존재·크기로 판정하면 labor:[] 만 붙어도 품목 블록이 인건비 블록으로
        // 오인돼 소계가 0 이 된다(docs/LESSONS.md 3번).
        boolean isLabor = block.isLabor();

        List<BigDecimal> amounts = new ArrayList<>();
        BigDecimal mmTotal = isLabor ? BigDecimal.ZERO : null;

        if (isLabor) {
            for (LaborRow r : orEmpty(block.labor())) {
                BigDecimal proposed = requireNonNegative(nz(r.proposedPrice()), "제안단가");
                BigDecimal mm = requireNonNegative(nz(r.mm()), "공수(MM)");
                // amount 가 이미 있으면 그 값을 신뢰한다(스냅샷 재조회).
                BigDecimal amount = r.amount() != null
                        ? money(requireNonNegative(r.amount(), "금액"))
                        : money(proposed.multiply(mm));
                amounts.add(amount);
                mmTotal = mmTotal.add(mm);
            }
        } else {
            for (ItemRow r : orEmpty(block.items())) {
                BigDecimal proposed = requireNonNegative(nz(r.proposedPrice()), "제안단가");
                // 수량 미지정(null)은 1 로 본다. 0 은 0 이다(실측의 '참고라인').
                BigDecimal qty = requireNonNegative(r.qty() == null ? BigDecimal.ONE : r.qty(), "수량");
                BigDecimal amount = r.amount() != null
                        ? money(requireNonNegative(r.amount(), "금액"))
                        : money(proposed.multiply(qty));
                amounts.add(amount);
            }
        }

        BigDecimal subtotal = amounts.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        return new BlockResult(block.blockCode(), block.isRecurring() ? 1 : 0, subtotal, amounts, mmTotal);
    }

    private static <T> List<T> orEmpty(List<T> v) {
        return v == null ? List.of() : v;
    }

    // ── computeDiscount ────────────────────────────────────────────

    @Override
    public BigDecimal computeDiscount(Discount discount, BigDecimal base) {
        BigDecimal b = requireNonNegative(nz(base), "할인 기준금액");
        if (discount == null || discount.type() == null) {
            return BigDecimal.ZERO;
        }
        // TARGET 의 0 은 유효한 값이다(하겐다즈 "무상제공"). 미입력(null)만 걸러낸다.
        // 0 을 미입력으로 오판한 전례가 실제 데이터 손상을 냈다(docs/LESSONS.md 1번).
        BigDecimal value = discount.value();
        if (value == null) {
            return BigDecimal.ZERO;
        }
        requireNonNegative(value, "특별DC 값");

        return switch (discount.type()) {
            case "RATE" -> money(b.multiply(value).divide(new BigDecimal("100")));
            // 목표가가 소계보다 크면 할인은 0 이다(음수 할인 금지).
            case "TARGET" -> b.subtract(value).max(BigDecimal.ZERO);
            case "AMOUNT" -> money(value);
            default -> throw new IllegalArgumentException("알 수 없는 특별DC 유형: " + discount.type());
        };
    }

    // ── floorTo ────────────────────────────────────────────────────

    @Override
    public BigDecimal floorTo(BigDecimal amount, BigDecimal unit) {
        BigDecimal a = nz(amount);
        BigDecimal u = nz(unit);
        if (u.signum() <= 0) {
            // 절사 단위가 없으면 원 단위 정규화만 한다.
            return money(a);
        }
        // floor(a / u) × u. 반올림이 아니라 내림이다.
        return a.divide(u, 0, java.math.RoundingMode.FLOOR).multiply(u);
    }

    // ── validateMonthAlloc ─────────────────────────────────────────

    @Override
    public List<LaborError> validateMonthAlloc(List<LaborRow> labor) {
        List<LaborError> errors = new ArrayList<>();
        for (LaborRow l : orEmpty(labor)) {
            Map<String, BigDecimal> alloc = parseAlloc(l.monthAlloc());
            if (alloc == null) {
                continue; // 배분이 없으면 검증 대상이 아니다(옵션 기능)
            }
            BigDecimal sum = alloc.values().stream().map(BlockPricingEngine::nz)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal mm = nz(l.mm());
            if (sum.subtract(mm).abs().compareTo(ALLOC_TOLERANCE) > 0) {
                String who = l.roleLabel() != null ? l.roleLabel() : l.roleCode();
                errors.add(new LaborError(
                        l.roleCode(), mm, sum,
                        who + ": 월별 배분 합계 " + plain(sum) + " 가 공수 " + plain(mm) + " MM 과 다릅니다."));
            }
        }
        return errors;
    }

    @Override
    public Map<String, BigDecimal> monthlyAllocationTotals(List<LaborRow> labor) {
        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        for (LaborRow l : orEmpty(labor)) {
            Map<String, BigDecimal> alloc = parseAlloc(l.monthAlloc());
            if (alloc == null) {
                continue;
            }
            alloc.forEach((month, v) -> totals.merge(month, nz(v), BigDecimal::add));
        }
        return totals;
    }

    /**
     * {@code month_alloc} 을 읽는다. DB 저장 형태인 JSON 문자열도 받는다.
     *
     * <p>값이 없으면 {@code null} 을 돌려 "검증 대상 아님" 을 뜻한다.
     * <b>파싱 실패는 삼키지 않는다</b> — 깨진 JSON 을 조용히 빈 배분으로 처리하면
     * 공수 검증이 통과해 버려 인력투입계획이 틀린 채로 인쇄된다.
     */
    @SuppressWarnings("unchecked")
    private static Map<String, BigDecimal> parseAlloc(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Map<?, ?> m) {
            if (m.isEmpty()) {
                return null;
            }
            Map<String, BigDecimal> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                out.put(String.valueOf(e.getKey()), toBigDecimal(e.getValue()));
            }
            return out;
        }
        if (raw instanceof String s) {
            if (s.isBlank()) {
                return null;
            }
            try {
                Map<String, BigDecimal> parsed = MAPPER.readValue(s, ALLOC_MAP);
                return parsed.isEmpty() ? null : parsed;
            } catch (Exception e) {
                throw new IllegalArgumentException("month_alloc JSON 을 읽을 수 없습니다: " + s, e);
            }
        }
        throw new IllegalArgumentException(
                "month_alloc 은 Map 또는 JSON 문자열이어야 합니다: " + raw.getClass().getName());
    }

    private static BigDecimal toBigDecimal(Object v) {
        if (v == null) {
            return BigDecimal.ZERO;
        }
        if (v instanceof BigDecimal b) {
            return b;
        }
        if (v instanceof Number n) {
            return new BigDecimal(n.toString());
        }
        try {
            return new BigDecimal(String.valueOf(v));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("월별 배분 값이 숫자가 아닙니다: " + v, e);
        }
    }

    /** 메시지용 — 불필요한 0 을 떼어 Node 출력과 같은 형태로 만든다 (1.0 → 1, 0.90 → 0.9). */
    private static String plain(BigDecimal v) {
        return v.stripTrailingZeros().toPlainString();
    }

    // ── calcQuoteBlocks ────────────────────────────────────────────

    @Override
    public QuoteResult calcQuoteBlocks(QuoteInput input) {
        QuoteInput in = input == null
                ? new QuoteInput(null, null, null, null)
                : input;

        List<BlockInput> blocks = orEmpty(in.blocks());
        // round_unit 미지정 시 십만단위. Node 기본값과 같다.
        BigDecimal roundUnit = in.roundUnit() == null ? new BigDecimal("100000") : in.roundUnit();
        requireNonNegative(roundUnit, "절사 단위");

        List<BlockSubtotal> subtotals = new ArrayList<>();
        BigDecimal onetimeSubtotal = BigDecimal.ZERO;
        BigDecimal monthlySubtotal = BigDecimal.ZERO;
        List<LaborError> laborErrors = new ArrayList<>();

        for (BlockInput b : blocks) {
            BlockResult r = calcBlock(b);
            subtotals.add(new BlockSubtotal(r.blockCode(), r.recurring(), r.subtotal()));
            if (b.isRecurring()) {
                monthlySubtotal = monthlySubtotal.add(r.subtotal());
            } else {
                onetimeSubtotal = onetimeSubtotal.add(r.subtotal());
            }
            // 비-LABOR 블록의 labor 도 검증한다 — 금액에는 안 들어가지만
            // 인력투입계획 부록으로 인쇄되므로 배분이 맞아야 한다.
            laborErrors.addAll(validateMonthAlloc(b.labor()));
        }

        // 순서 고정: 소계합 → 특별DC → 절사.
        BigDecimal discountAmount = computeDiscount(in.discount(), onetimeSubtotal);
        BigDecimal afterDiscount = onetimeSubtotal.subtract(discountAmount);
        BigDecimal onetimeTotal = floorTo(afterDiscount, roundUnit);

        // 월 금액은 절사하지 않는다. 150,000 같은 밴드 금액이 십만절사되면 깨진다.
        BigDecimal monthlyDiscountAmount = computeDiscount(in.monthlyDiscount(), monthlySubtotal);
        BigDecimal monthlyTotal = monthlySubtotal.subtract(monthlyDiscountAmount);

        BigDecimal vatAmount = money(onetimeTotal.multiply(VAT_RATE));
        BigDecimal monthlyVat = money(monthlyTotal.multiply(VAT_RATE));

        return new QuoteResult(
                subtotals,
                onetimeSubtotal,
                monthlySubtotal,
                discountAmount,
                monthlyDiscountAmount,
                roundUnit,
                afterDiscount.subtract(onetimeTotal),   // 절사로 깎인 금액
                onetimeTotal,
                monthlyTotal,
                vatAmount,
                monthlyVat,
                onetimeTotal.add(vatAmount),            // 일시불 기준 VAT 포함
                onetimeSubtotal,                        // 하위호환: 공급가액 = 일시불 소계합
                laborErrors);
    }
}
