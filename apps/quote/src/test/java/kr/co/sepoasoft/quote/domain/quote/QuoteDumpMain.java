package kr.co.sepoasoft.quote.domain.quote;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import com.fasterxml.jackson.databind.ObjectMapper;

import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Block;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Item;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Labor;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Quote;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Section;

/**
 * 견적 전량을 Java Repository 로 조회해 JSON 으로 덤프한다.
 *
 * <p>{@code tools/compare-queries.js} 가 이 출력을 Node 조회 결과와 대조한다.
 * Spring 컨텍스트를 띄우지 않고 {@link DriverManagerDataSource} 로 직접 붙는다 —
 * <b>Flyway 를 절대 실행하지 않기 위해서다.</b> 개발 DB 를 Node 와 공유 중이므로
 * 컨텍스트 기동에 딸려오는 자동 실행 여지를 아예 없앤다.
 *
 * <p><b>읽기만 한다.</b> 이 클래스에 쓰기 경로는 없다.
 *
 * <p>사용: {@code java -cp <test-cp> ...QuoteDumpMain <출력경로> <jdbcUrl> <user> <password>}
 */
public final class QuoteDumpMain {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private QuoteDumpMain() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            System.err.println("사용: QuoteDumpMain <출력경로.json> <jdbcUrl> <user> <password>");
            System.exit(1);
        }
        DataSource ds = new DriverManagerDataSource(args[1], args[2], args[3]);
        QuoteRepository repo = new QuoteRepository(new NamedParameterJdbcTemplate(ds));

        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> quotes = new ArrayList<>();
        for (Long id : repo.allQuoteIds()) {
            repo.findById(id).ifPresent(q -> quotes.add(quote(q)));
        }
        out.put("quotes", quotes);
        out.put("settings", repo.loadSettings());

        Path p = Path.of(args[0]);
        if (p.getParent() != null) {
            Files.createDirectories(p.getParent());
        }
        Files.writeString(p, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(out));
        System.out.println("Java 조회 덤프: " + p.toAbsolutePath() + " (견적 " + quotes.size() + "건)");
    }

    // ── 정규화 ─────────────────────────────────────────────────────
    // 금액·수량은 "뒤따르는 0 을 뗀 평문 십진수 문자열". null 은 null 로 둔다.
    // NULL 과 빈 문자열을 구분해야 하므로 문자열은 그대로 낸다.

    private static String n(BigDecimal v) {
        return v == null ? null : v.stripTrailingZeros().toPlainString();
    }

    private static String d(LocalDate v) {
        return v == null ? null : v.toString();
    }

    private static String t(LocalDateTime v) {
        return v == null ? null : v.format(TS);
    }

    private static Map<String, Object> quote(Quote q) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", q.id());
        m.put("quote_no", q.quoteNo());
        m.put("quote_type", q.quoteType());
        m.put("deployment", q.deployment());
        m.put("template_code", q.templateCode());
        m.put("quote_date", d(q.quoteDate()));
        m.put("valid_until", d(q.validUntil()));
        m.put("customer_name", q.customerName());
        m.put("customer_contact", q.customerContact());
        m.put("discount_type", q.discountType());
        m.put("discount_value", n(q.discountValue()));
        m.put("round_unit", q.roundUnit());
        m.put("monthly_discount_type", q.monthlyDiscountType());
        m.put("monthly_discount_value", n(q.monthlyDiscountValue()));
        m.put("supply_amount", n(q.supplyAmount()));
        m.put("discount_amount", n(q.discountAmount()));
        m.put("vat_amount", n(q.vatAmount()));
        m.put("total_amount", n(q.totalAmount()));
        m.put("onetime_total", n(q.onetimeTotal()));
        m.put("monthly_total", n(q.monthlyTotal()));
        m.put("status", q.status());
        m.put("memo", q.memo());
        m.put("created_by", q.createdBy());
        m.put("created_at", t(q.createdAt()));
        m.put("updated_at", t(q.updatedAt()));
        m.put("conditions", q.conditions());
        m.put("sections", q.sections() == null ? List.of()
                : q.sections().stream().map(QuoteDumpMain::section).toList());
        m.put("blocks", q.blocks() == null ? List.of()
                : q.blocks().stream().map(QuoteDumpMain::block).toList());
        return m;
    }

    private static Map<String, Object> section(Section s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", s.id());
        m.put("quote_id", s.quoteId());
        m.put("solution", s.solution());
        m.put("template_code", s.templateCode());
        m.put("brand", s.brand());
        m.put("deployment", s.deployment());
        m.put("company_class", s.companyClass());
        m.put("contract_months", s.contractMonths());
        m.put("params", s.params());
        m.put("subtotal", n(s.subtotal()));
        m.put("sort", s.sort());
        m.put("items", s.items() == null ? List.of() : s.items().stream().map(QuoteDumpMain::item).toList());
        m.put("labor", s.labor() == null ? List.of() : s.labor().stream().map(QuoteDumpMain::labor).toList());
        return m;
    }

    private static Map<String, Object> block(Block b) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", b.id());
        m.put("quote_id", b.quoteId());
        m.put("section_id", b.sectionId());
        m.put("block_code", b.blockCode());
        m.put("title", b.title());
        m.put("subtotal", n(b.subtotal()));
        // Node 는 !!recurring 으로 boolean 을 낸다. 대조를 위해 같은 형태로 맞춘다.
        m.put("recurring", b.isRecurring());
        m.put("sort", b.sort());
        m.put("items", b.items() == null ? List.of() : b.items().stream().map(QuoteDumpMain::item).toList());
        m.put("labor", b.labor() == null ? List.of() : b.labor().stream().map(QuoteDumpMain::labor).toList());
        return m;
    }

    private static Map<String, Object> item(Item i) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", i.id());
        m.put("section_id", i.sectionId());
        m.put("block_id", i.blockId());
        m.put("item_code", i.itemCode());
        m.put("category", i.category());
        m.put("block_code", i.blockCode());
        m.put("name", i.name());
        m.put("spec", i.spec());
        m.put("qty", n(i.qty()));
        m.put("unit", i.unit());
        m.put("months", i.months());
        m.put("unit_price", n(i.unitPrice()));
        m.put("base_price", n(i.basePrice()));
        m.put("proposed_price", n(i.proposedPrice()));
        m.put("amount", n(i.amount()));
        m.put("note", i.note());
        m.put("sort", i.sort());
        return m;
    }

    private static Map<String, Object> labor(Labor l) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", l.id());
        m.put("section_id", l.sectionId());
        m.put("block_id", l.blockId());
        m.put("role_code", l.roleCode());
        m.put("role_name", l.roleName());
        m.put("role_label", l.roleLabel());
        m.put("grade", l.grade());
        m.put("task", l.task());
        m.put("mm", n(l.mm()));
        m.put("base_price", n(l.basePrice()));
        m.put("proposed_price", n(l.proposedPrice()));
        m.put("amount", n(l.amount()));
        m.put("month_alloc", l.monthAlloc());
        m.put("sort", l.sort());
        return m;
    }
}
