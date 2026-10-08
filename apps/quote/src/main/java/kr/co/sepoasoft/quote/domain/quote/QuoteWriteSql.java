package kr.co.sepoasoft.quote.domain.quote;

/**
 * 견적 쓰기 SQL — Node {@code persistQuoteBlocks} 이식.
 *
 * <p><b>J4 에서는 SQL 만 정의하고 실행하지 않는다.</b> 개발 DB 를 Node 앱과 공유 중이라
 * 쓰기 검증은 J5 에서 API 계층과 함께 한다. 그때까지 이 클래스는 <b>SQL 의 보관처</b>다.
 *
 * <p>Node 는 컬럼 목록을 런타임에 조립했다({@code Object.keys(cols).map(...)}).
 * 여기서는 그 조립 결과를 고정 문자열로 펼쳐 둔다 — 컬럼 순서가 코드 실행 순서에
 * 의존하지 않는 편이 리뷰와 대조에 낫다. <b>컬럼 집합과 순서는 Node 와 동일하다.</b>
 *
 * <p>원문: {@code git show v-node-final:quote/src/web/routes/quotes.js} (274~364행)
 */
public final class QuoteWriteSql {

    private QuoteWriteSql() {}

    /**
     * 견적 헤더 신규.
     *
     * <p>Node 의 {@code cols} 21개 + {@code quote_no} · {@code status} · {@code created_by}.
     * {@code status} 는 허용값이 아니면 {@code DRAFT} 로 떨어진다(호출부 책임).
     */
    public static final String INSERT_QUOTE = """
            INSERT INTO sq_quotes (
              `quote_no`, `quote_type`, `deployment`, `template_code`, `quote_date`, `valid_until`,
              `customer_name`, `customer_contact`, `discount_type`, `discount_value`, `round_unit`,
              `monthly_discount_type`, `monthly_discount_value`, `supply_amount`, `discount_amount`,
              `vat_amount`, `total_amount`, `onetime_total`, `monthly_total`, `memo`, `conditions`,
              `status`, `created_by`
            ) VALUES (
              :quote_no, :quote_type, :deployment, :template_code, :quote_date, :valid_until,
              :customer_name, :customer_contact, :discount_type, :discount_value, :round_unit,
              :monthly_discount_type, :monthly_discount_value, :supply_amount, :discount_amount,
              :vat_amount, :total_amount, :onetime_total, :monthly_total, :memo, :conditions,
              :status, :created_by
            )""";

    /**
     * 견적 헤더 수정.
     *
     * <p><b>{@code quote_no} 를 건드리지 않는다.</b> 수정 시 견적번호는 유지된다.
     * {@code status} 는 {@code COALESCE} 라 null 이면 기존 값을 지킨다.
     */
    public static final String UPDATE_QUOTE = """
            UPDATE sq_quotes SET
              `quote_type` = :quote_type, `deployment` = :deployment, `template_code` = :template_code,
              `quote_date` = :quote_date, `valid_until` = :valid_until, `customer_name` = :customer_name,
              `customer_contact` = :customer_contact, `discount_type` = :discount_type,
              `discount_value` = :discount_value, `round_unit` = :round_unit,
              `monthly_discount_type` = :monthly_discount_type,
              `monthly_discount_value` = :monthly_discount_value, `supply_amount` = :supply_amount,
              `discount_amount` = :discount_amount, `vat_amount` = :vat_amount,
              `total_amount` = :total_amount, `onetime_total` = :onetime_total,
              `monthly_total` = :monthly_total, `memo` = :memo, `conditions` = :conditions,
              status = COALESCE(:status, status)
            WHERE id = :id""";

    /** 수정 시 자식 전량 삭제 후 재삽입한다. 블록 → 섹션 순서다. */
    public static final String DELETE_BLOCKS_BY_QUOTE = "DELETE FROM sq_quote_blocks WHERE quote_id = :quote_id";
    public static final String DELETE_SECTIONS_BY_QUOTE = "DELETE FROM sq_quote_sections WHERE quote_id = :quote_id";

    /**
     * 레거시 호환 우산 섹션.
     *
     * <p>블록형 견적도 섹션을 하나 만든다. Excel·PDF 경로가 {@code sections} 를 읽기 때문이다.
     * {@code solution} 은 {@code NOT NULL} 인데 호출부가 넣지 않으면 500 이 난다 —
     * 이슈 로그의 "블록형 PUT 왕복 불가" 가 이것이다. J5 에서 해소한다.
     */
    public static final String INSERT_SECTION = """
            INSERT INTO sq_quote_sections
              (quote_id, solution, template_code, brand, deployment, contract_months, subtotal, sort)
            VALUES (:quote_id, :solution, :template_code, :brand, :deployment, :contract_months, :subtotal, 0)""";

    public static final String INSERT_BLOCK = """
            INSERT INTO sq_quote_blocks
              (quote_id, section_id, block_code, title, subtotal, recurring, sort)
            VALUES (:quote_id, :section_id, :block_code, :title, :subtotal, :recurring, :sort)""";

    /**
     * 품목 라인.
     *
     * <p>Node 는 {@code unit_price} 와 {@code proposed_price} 에 <b>같은 값</b>(제안단가)을 넣는다.
     * 하위호환 컬럼이라 그렇다. 이식하면서 정리하지 않았다 — 값이 달라지면 대조가 깨진다.
     */
    public static final String INSERT_ITEM = """
            INSERT INTO sq_quote_items
              (section_id, block_id, item_code, block_code, category, name, spec, qty, unit, months,
               unit_price, base_price, proposed_price, amount, note, sort)
            VALUES (:section_id, :block_id, :item_code, :block_code, :category, :name, :spec, :qty,
                    :unit, :months, :unit_price, :base_price, :proposed_price, :amount, :note, :sort)""";

    /** 인건비 라인. {@code month_alloc} 은 비어 있으면 {@code NULL} 로 넣는다(빈 객체를 저장하지 않는다). */
    public static final String INSERT_LABOR = """
            INSERT INTO sq_quote_labor
              (section_id, block_id, role_code, role_name, role_label, grade, task, mm,
               base_price, proposed_price, amount, month_alloc, sort)
            VALUES (:section_id, :block_id, :role_code, :role_name, :role_label, :grade, :task, :mm,
                    :base_price, :proposed_price, :amount, :month_alloc, :sort)""";

    public static final String DELETE_QUOTE = "DELETE FROM sq_quotes WHERE id = :id";
}
