package kr.co.sepoasoft.quote.domain.quote;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Block;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Item;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Labor;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Quote;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.QuotePage;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.QuoteSearch;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Section;

/**
 * 견적 조회 — Node {@code routes/quotes.js} 의 {@code loadQuote} · 목록 조회 이식.
 *
 * <p><b>SQL 문자열을 바꾸지 않았다.</b> 바인딩 표기({@code ?} → {@code :name})와
 * {@link RowMapper} 만 더했다. 쿼리를 "개선" 하면 Node 와 결과가 달라져도 원인이
 * 이식 실수인지 개선의 부작용인지 가릴 수 없게 된다.
 *
 * <p>Node 원문은 {@code git show v-node-final:quote/src/web/routes/quotes.js} 로 볼 수 있다.
 *
 * <p><b>J4 범위는 조회다.</b> 쓰기 SQL 은 {@link QuoteWriteSql} 에 있으나 실행하지 않는다 —
 * J5 에서 API 계층과 함께 검증한다.
 */
@Repository
public class QuoteRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public QuoteRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ── RowMapper ──────────────────────────────────────────────────
    // BIGINT → BigDecimal scale 0, DECIMAL → 선언 scale 그대로.
    // NULL 은 null 로 둔다. 0 이나 빈 문자열로 바꾸지 않는다.

    private static BigDecimal num(ResultSet rs, String col) throws SQLException {
        BigDecimal v = rs.getBigDecimal(col);
        return rs.wasNull() ? null : v;
    }

    private static Long lng(ResultSet rs, String col) throws SQLException {
        long v = rs.getLong(col);
        return rs.wasNull() ? null : v;
    }

    private static Integer intg(ResultSet rs, String col) throws SQLException {
        int v = rs.getInt(col);
        return rs.wasNull() ? null : v;
    }

    /** 목록 조회는 {@code created_by_name} 이 붙는다. 단건은 없다. */
    private static RowMapper<Quote> quoteMapper(boolean withCreatedByName) {
        return (rs, n) -> new Quote(
                lng(rs, "id"),
                rs.getString("quote_no"),
                rs.getString("quote_type"),
                rs.getString("deployment"),
                rs.getString("template_code"),
                rs.getDate("quote_date") == null ? null : rs.getDate("quote_date").toLocalDate(),
                rs.getDate("valid_until") == null ? null : rs.getDate("valid_until").toLocalDate(),
                rs.getString("customer_name"),
                rs.getString("customer_contact"),
                rs.getString("discount_type"),
                num(rs, "discount_value"),
                intg(rs, "round_unit"),
                rs.getString("monthly_discount_type"),
                num(rs, "monthly_discount_value"),
                num(rs, "supply_amount"),
                num(rs, "discount_amount"),
                num(rs, "vat_amount"),
                num(rs, "total_amount"),
                num(rs, "onetime_total"),
                num(rs, "monthly_total"),
                rs.getString("status"),
                rs.getString("memo"),
                lng(rs, "created_by"),
                rs.getTimestamp("created_at") == null ? null : rs.getTimestamp("created_at").toLocalDateTime(),
                rs.getTimestamp("updated_at") == null ? null : rs.getTimestamp("updated_at").toLocalDateTime(),
                rs.getString("conditions"),
                withCreatedByName ? rs.getString("created_by_name") : null,
                null, null);
    }

    private static final RowMapper<Section> SECTION = (rs, n) -> new Section(
            lng(rs, "id"), lng(rs, "quote_id"), rs.getString("solution"), rs.getString("template_code"),
            rs.getString("brand"), rs.getString("deployment"), rs.getString("company_class"),
            intg(rs, "contract_months"), rs.getString("params"), num(rs, "subtotal"), intg(rs, "sort"),
            null, null);

    private static final RowMapper<Block> BLOCK = (rs, n) -> new Block(
            lng(rs, "id"), lng(rs, "quote_id"), lng(rs, "section_id"), rs.getString("block_code"),
            rs.getString("title"), num(rs, "subtotal"), intg(rs, "recurring"), intg(rs, "sort"),
            null, null);

    private static final RowMapper<Item> ITEM = (rs, n) -> new Item(
            lng(rs, "id"), lng(rs, "section_id"), lng(rs, "block_id"), rs.getString("item_code"),
            rs.getString("category"), rs.getString("block_code"), rs.getString("name"), rs.getString("spec"),
            num(rs, "qty"), rs.getString("unit"), intg(rs, "months"), num(rs, "unit_price"),
            num(rs, "base_price"), num(rs, "proposed_price"), num(rs, "amount"), rs.getString("note"),
            intg(rs, "sort"));

    private static final RowMapper<Labor> LABOR = (rs, n) -> new Labor(
            lng(rs, "id"), lng(rs, "section_id"), lng(rs, "block_id"), rs.getString("role_code"),
            rs.getString("role_name"), rs.getString("role_label"), rs.getString("grade"), rs.getString("task"),
            num(rs, "mm"), num(rs, "base_price"), num(rs, "proposed_price"), num(rs, "amount"),
            rs.getString("month_alloc"), intg(rs, "sort"));

    // ── 단건 조회 (Node loadQuote) ──────────────────────────────────

    /**
     * 견적 1건을 섹션·블록·품목·인건비까지 채워 돌려준다.
     *
     * <p>Node {@code loadQuote} 와 같은 순서·같은 정렬로 조회한다. 정렬이 다르면 배열 순서가
     * 달라지고, 그것만으로 대조가 깨진다.
     *
     * @return 없으면 {@link Optional#empty()} — Node 는 {@code null} 을 돌려주고 라우터가 404 로 만든다
     */
    public Optional<Quote> findById(long id) {
        List<Quote> quotes = jdbc.query(
                "SELECT * FROM sq_quotes WHERE id = :id",
                new MapSqlParameterSource("id", id), quoteMapper(false));
        if (quotes.isEmpty()) {
            return Optional.empty();
        }
        Quote head = quotes.get(0);

        List<Section> sections = jdbc.query(
                "SELECT * FROM sq_quote_sections WHERE quote_id = :id ORDER BY sort, id",
                new MapSqlParameterSource("id", id), SECTION);

        List<Item> items = List.of();
        List<Labor> laborRows = List.of();
        if (!sections.isEmpty()) {
            List<Long> sectionIds = sections.stream().map(Section::id).toList();
            MapSqlParameterSource p = new MapSqlParameterSource("ids", sectionIds);
            items = jdbc.query(
                    "SELECT * FROM sq_quote_items WHERE section_id IN (:ids) ORDER BY sort, id", p, ITEM);
            laborRows = jdbc.query(
                    "SELECT * FROM sq_quote_labor WHERE section_id IN (:ids) ORDER BY sort, id", p, LABOR);
        }

        // 섹션별로 묶는다 (Node: bySection / laborBySection)
        Map<Long, List<Item>> itemsBySection = groupBy(items, Item::sectionId, sections, Section::id);
        Map<Long, List<Labor>> laborBySection = groupBy(laborRows, Labor::sectionId, sections, Section::id);
        List<Section> filledSections = sections.stream()
                .map(s -> new Section(s.id(), s.quoteId(), s.solution(), s.templateCode(), s.brand(),
                        s.deployment(), s.companyClass(), s.contractMonths(), s.params(), s.subtotal(),
                        s.sort(),
                        itemsBySection.getOrDefault(s.id(), List.of()),
                        laborBySection.getOrDefault(s.id(), List.of())))
                .toList();

        // 블록별로 묶는다. block_id 가 null 인 행은 어느 블록에도 넣지 않는다(Node 와 같다).
        List<Block> blockRows = jdbc.query(
                "SELECT * FROM sq_quote_blocks WHERE quote_id = :id ORDER BY sort, id",
                new MapSqlParameterSource("id", id), BLOCK);
        Map<Long, List<Item>> itemsByBlock = groupBy(items, Item::blockId, blockRows, Block::id);
        Map<Long, List<Labor>> laborByBlock = groupBy(laborRows, Labor::blockId, blockRows, Block::id);
        List<Block> filledBlocks = blockRows.stream()
                .map(b -> new Block(b.id(), b.quoteId(), b.sectionId(), b.blockCode(), b.title(),
                        b.subtotal(), b.recurring(), b.sort(),
                        itemsByBlock.getOrDefault(b.id(), List.of()),
                        laborByBlock.getOrDefault(b.id(), List.of())))
                .toList();

        return Optional.of(new Quote(
                head.id(), head.quoteNo(), head.quoteType(), head.deployment(), head.templateCode(),
                head.quoteDate(), head.validUntil(), head.customerName(), head.customerContact(),
                head.discountType(), head.discountValue(), head.roundUnit(), head.monthlyDiscountType(),
                head.monthlyDiscountValue(), head.supplyAmount(), head.discountAmount(), head.vatAmount(),
                head.totalAmount(), head.onetimeTotal(), head.monthlyTotal(), head.status(), head.memo(),
                head.createdBy(), head.createdAt(), head.updatedAt(), head.conditions(), null,
                filledSections, filledBlocks));
    }

    /**
     * 자식 행을 부모 id 로 묶는다.
     *
     * <p>부모 목록에 없는 id 를 가진 자식은 <b>버린다</b> — Node 의 {@code map.get(id)?.push(...)}
     * 가 같은 동작이다(옵셔널 체이닝으로 조용히 넘어간다). 여기서도 같게 두는 것은 대조를
     * 위해서다. 고아 행이 실제로 생기면 J12 검증 규칙에서 잡는다.
     */
    private static <C, P> Map<Long, List<C>> groupBy(
            List<C> children, Function<C, Long> childKey,
            List<P> parents, Function<P, Long> parentKey) {
        Map<Long, List<C>> map = new LinkedHashMap<>();
        for (P p : parents) {
            map.put(parentKey.apply(p), new ArrayList<>());
        }
        for (C c : children) {
            Long k = childKey.apply(c);
            if (k == null) {
                continue;
            }
            List<C> bucket = map.get(k);
            if (bucket != null) {
                bucket.add(c);
            }
        }
        return map;
    }

    // ── 목록 조회 (Node GET /) ─────────────────────────────────────

    private static final List<String> STATUSES = List.of("DRAFT", "SENT", "WON", "LOST");

    public QuotePage search(QuoteSearch q) {
        List<String> conds = new ArrayList<>();
        MapSqlParameterSource p = new MapSqlParameterSource();

        if (q.status() != null && STATUSES.contains(q.status())) {
            conds.add("status = :status");
            p.addValue("status", q.status());
        }
        if (q.customer() != null && !q.customer().isEmpty()) {
            conds.add("customer_name LIKE :customer");
            p.addValue("customer", "%" + q.customer() + "%");
        }
        // 견적번호는 신형식(QT20260802_001)과 구형식(S20260802001)을 모두 찾는다.
        String noClause = quoteNoSearchClause(q.quoteNo(), p);
        if (noClause != null) {
            conds.add(noClause);
        }
        String where = conds.isEmpty() ? "" : "WHERE " + String.join(" AND ", conds);

        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) AS cnt FROM sq_quotes " + where, p, Long.class);

        MapSqlParameterSource pageParams = new MapSqlParameterSource(p.getValues());
        pageParams.addValue("size", q.size());
        pageParams.addValue("offset", q.offset());

        List<Quote> rows = jdbc.query(
                "SELECT q.*, u.name AS created_by_name"
                        + "   FROM sq_quotes q LEFT JOIN sq_users u ON u.id = q.created_by "
                        + where + " ORDER BY q.id DESC LIMIT :size OFFSET :offset",
                pageParams, quoteMapper(true));

        return new QuotePage(total == null ? 0 : total, q.page(), q.size(), rows);
    }

    /**
     * 견적번호 검색 조건 — Node {@code numbering.js} 의 {@code quoteNoSearchClause} 이식.
     *
     * <p>① 입력 문자열 부분 일치 ② 구분자·접두어를 뗀 숫자열 일치. 둘을 OR 로 묶는다.
     * 같은 날 구형식과 신형식이 섞여 있어도 한 번에 찾기 위한 것이다.
     *
     * @return 조건이 없으면 {@code null}
     */
    private static String quoteNoSearchClause(String term, MapSqlParameterSource p) {
        String raw = term == null ? "" : term.trim();
        if (raw.isEmpty()) {
            return null;
        }
        String digits = raw.replaceFirst("(?i)^(QT|S)", "").replaceAll("[^0-9]", "");
        List<String> like = new ArrayList<>();
        like.add("quote_no LIKE :qnoRaw");
        p.addValue("qnoRaw", "%" + raw + "%");
        if (!digits.isEmpty()) {
            like.add("REPLACE(REPLACE(REPLACE(quote_no, 'QT', ''), 'S', ''), '_', '') LIKE :qnoDigits");
            p.addValue("qnoDigits", "%" + digits + "%");
        }
        return "(" + String.join(" OR ", like) + ")";
    }

    // ── 마스터 조회 ────────────────────────────────────────────────

    /** {@code sq_settings} 전량 → key/value 맵. Node {@code loadSettings} 와 같다. */
    public Map<String, String> loadSettings() {
        Map<String, String> out = new LinkedHashMap<>();
        jdbc.query("SELECT `key`, value FROM sq_settings", rs -> {
            out.put(rs.getString("key"), rs.getString("value"));
        });
        return out;
    }

    /** 견적번호만 뽑는다. 존재 확인·중복 검사용. */
    public List<String> allQuoteNos() {
        return jdbc.queryForList(
                "SELECT quote_no FROM sq_quotes ORDER BY id", new MapSqlParameterSource(), String.class);
    }

    /** 전체 견적 id — 대조 도구가 순회에 쓴다. */
    public List<Long> allQuoteIds() {
        return jdbc.queryForList(
                "SELECT id FROM sq_quotes ORDER BY id", new MapSqlParameterSource(), Long.class);
    }
}
