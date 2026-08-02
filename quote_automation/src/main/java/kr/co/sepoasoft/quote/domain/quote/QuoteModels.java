package kr.co.sepoasoft.quote.domain.quote;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 견적 도메인 모델. 전부 불변 record 다.
 *
 * <p>필드명·타입은 <b>DB 컬럼과 1:1</b>이며 Node 가 {@code SELECT *} 로 내보내는 형태와 같다.
 * J5 에서 프론트를 수정하지 않으려면 응답 JSON 형태가 유지돼야 하고, 그러려면 이 계층에서
 * 이름을 바꾸지 않는 편이 안전하다.
 *
 * <p><b>금액 스케일</b> — {@code docs/ENGINE-CONTRACT.md} §2 를 따른다.
 * <ul>
 *   <li>금액({@code BIGINT}) → {@link BigDecimal} scale 0</li>
 *   <li>수량 {@code qty} ({@code DECIMAL(8,2)}) · 공수 {@code mm} ({@code DECIMAL(6,2)}) → scale 2</li>
 *   <li>{@code discount_value} ({@code DECIMAL(12,2)}) → scale 2</li>
 * </ul>
 * 비교는 반드시 {@code compareTo} 로 한다. {@code equals} 는 scale 까지 보므로
 * {@code 1000} 과 {@code 1000.00} 을 다르게 판정한다.
 *
 * <p><b>NULL 과 빈 문자열을 구분한다.</b> DB 의 NULL 은 Java 의 {@code null} 로 그대로 둔다.
 * 빈 문자열로 바꾸면 Node 응답과 어긋나고, 그 차이는 화면에서야 드러난다.
 */
public final class QuoteModels {

    private QuoteModels() {}

    /** 견적 헤더 — {@code sq_quotes}. */
    public record Quote(
            Long id,
            String quoteNo,
            String quoteType,
            String deployment,
            String templateCode,
            LocalDate quoteDate,
            LocalDate validUntil,
            String customerName,
            String customerContact,
            String discountType,
            BigDecimal discountValue,
            Integer roundUnit,
            String monthlyDiscountType,
            BigDecimal monthlyDiscountValue,
            BigDecimal supplyAmount,
            BigDecimal discountAmount,
            BigDecimal vatAmount,
            BigDecimal totalAmount,
            BigDecimal onetimeTotal,
            BigDecimal monthlyTotal,
            String status,
            String memo,
            Long createdBy,
            LocalDateTime createdAt,
            LocalDateTime updatedAt,
            /** JSON 문자열 원문. 파싱은 상위 계층이 한다 — Node 의 safeJson 과 같은 자리. */
            String conditions,
            /** 목록 조회에서만 채워진다 (LEFT JOIN sq_users). 단건 조회에서는 null. */
            String createdByName,
            List<Section> sections,
            List<Block> blocks) {}

    /** 레거시 섹션 — {@code sq_quote_sections}. 블록형 이전 구조이며 조회는 계속 지원한다. */
    public record Section(
            Long id,
            Long quoteId,
            String solution,
            String templateCode,
            String brand,
            String deployment,
            String companyClass,
            Integer contractMonths,
            /** JSON 문자열 원문. */
            String params,
            BigDecimal subtotal,
            Integer sort,
            List<Item> items,
            List<Labor> labor) {}

    /** 블록 인스턴스 — {@code sq_quote_blocks}. */
    public record Block(
            Long id,
            Long quoteId,
            Long sectionId,
            String blockCode,
            String title,
            BigDecimal subtotal,
            /** DB 는 tinyint. Node 응답은 boolean 이므로 상위 계층이 변환한다. */
            Integer recurring,
            Integer sort,
            List<Item> items,
            List<Labor> labor) {

        public boolean isRecurring() {
            return recurring != null && recurring != 0;
        }
    }

    /** 품목 라인 — {@code sq_quote_items}. */
    public record Item(
            Long id,
            Long sectionId,
            Long blockId,
            String itemCode,
            String category,
            String blockCode,
            String name,
            String spec,
            BigDecimal qty,
            String unit,
            Integer months,
            BigDecimal unitPrice,
            BigDecimal basePrice,
            BigDecimal proposedPrice,
            BigDecimal amount,
            String note,
            Integer sort) {}

    /** 인건비 라인 — {@code sq_quote_labor}. */
    public record Labor(
            Long id,
            Long sectionId,
            Long blockId,
            String roleCode,
            String roleName,
            String roleLabel,
            String grade,
            String task,
            BigDecimal mm,
            BigDecimal basePrice,
            BigDecimal proposedPrice,
            BigDecimal amount,
            /** JSON 문자열 원문. 엔진의 {@code validateMonthAlloc} 이 문자열도 받는다. */
            String monthAlloc,
            Integer sort) {}

    /** 목록 조회 결과. */
    public record QuotePage(long total, int page, int size, List<Quote> quotes) {}

    /** 목록 조회 조건. */
    public record QuoteSearch(String status, String customer, String quoteNo, int page, int size) {

        public static final int MAX_SIZE = 100;

        /** Node 의 기본값·상한과 같게 맞춘다 (page ≥ 1, 1 ≤ size ≤ 100, 기본 20). */
        public QuoteSearch {
            page = Math.max(1, page);
            size = Math.min(MAX_SIZE, Math.max(1, size == 0 ? 20 : size));
        }

        public int offset() {
            return (page - 1) * size;
        }
    }
}
