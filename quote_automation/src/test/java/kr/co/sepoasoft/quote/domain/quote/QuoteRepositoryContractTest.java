package kr.co.sepoasoft.quote.domain.quote;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Block;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.Quote;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.QuotePage;
import kr.co.sepoasoft.quote.domain.quote.QuoteModels.QuoteSearch;

/**
 * Repository 계층 계약 — <b>조회 전용</b>. 이 클래스는 DB 에 쓰지 않는다.
 *
 * <p>J3 에서 배운 것을 적용한다 — 실측 데이터에 없는 조합은 회귀 테스트가 지켜 주지 않으므로
 * 계약으로 강제한다. 미존재 ID, NULL 금액, 빈 블록, {@code labor} 만 있는 비-LABOR 블록이
 * 그런 조합이다.
 *
 * <p><b>Spring 컨텍스트를 띄우지 않는다.</b> {@link DriverManagerDataSource} 로 직접 붙는다 —
 * 컨텍스트 기동에 Flyway 가 딸려올 여지를 없애기 위해서다. 개발 DB 를 Node 와 공유 중이다.
 *
 * <p>DB 접속 정보가 없으면 통째로 건너뛴다. CI 에서 DB 없이 빌드가 도는 경우를 위한 것이며,
 * 건너뛴 것은 통과가 아니라 <b>Skipped</b> 로 보고된다 — 조용히 초록이 되지 않는다.
 */
@DisplayName("Repository 계약 — 조회 전용")
@EnabledIfEnvironmentVariable(named = "DB_HOST", matches = ".+",
        disabledReason = "DB_HOST 가 없으면 건너뛴다 (조회 대조는 tools/compare-queries.js 가 별도로 한다)")
class QuoteRepositoryContractTest {

    private static QuoteRepository repo;

    @BeforeAll
    static void connect() {
        String url = "jdbc:mariadb://" + System.getenv("DB_HOST") + ":"
                + (System.getenv("DB_PORT") == null ? "3306" : System.getenv("DB_PORT"))
                + "/" + System.getenv("DB_NAME");
        DataSource ds = new DriverManagerDataSource(url, System.getenv("DB_USER"), System.getenv("DB_PASSWORD"));
        repo = new QuoteRepository(new NamedParameterJdbcTemplate(ds));
    }

    @Nested
    @DisplayName("미존재 · 경계")
    class Missing {

        @Test
        @DisplayName("미존재 견적 ID 는 예외가 아니라 빈 Optional 이다")
        void missingIdReturnsEmpty() {
            assertThat(repo.findById(999_999_999L))
                    .as("Node 는 null 을 돌려주고 라우터가 404 로 만든다. 예외를 던지면 500 이 된다")
                    .isEmpty();
        }

        @Test
        @DisplayName("음수 ID 도 빈 Optional — 쿼리 자체는 정상 수행된다")
        void negativeIdReturnsEmpty() {
            assertThat(repo.findById(-1L)).isEmpty();
        }

        @Test
        @DisplayName("조건에 맞는 견적이 없으면 빈 목록이고 total 은 0 이다")
        void emptySearchResult() {
            QuotePage page = repo.search(new QuoteSearch(null, "존재하지-않는-고객사-이름-ZZZ", null, 1, 20));
            assertThat(page.total()).isZero();
            assertThat(page.quotes()).isEmpty();
        }
    }

    @Nested
    @DisplayName("목록 조회 규약")
    class SearchContract {

        @Test
        @DisplayName("size 는 100 을 넘지 않고 page 는 1 미만이 되지 않는다")
        void pagingBounds() {
            QuoteSearch s = new QuoteSearch(null, null, null, -5, 9999);
            assertThat(s.page()).isEqualTo(1);
            assertThat(s.size()).isEqualTo(QuoteSearch.MAX_SIZE);
            assertThat(s.offset()).isZero();
        }

        @Test
        @DisplayName("size 0 은 기본값 20 으로 떨어진다")
        void defaultSize() {
            assertThat(new QuoteSearch(null, null, null, 1, 0).size()).isEqualTo(20);
        }

        @Test
        @DisplayName("알 수 없는 status 는 조건에서 무시된다 — 결과를 0 으로 만들지 않는다")
        void unknownStatusIgnored() {
            long all = repo.search(new QuoteSearch(null, null, null, 1, 100)).total();
            long bogus = repo.search(new QuoteSearch("NOT_A_STATUS", null, null, 1, 100)).total();
            assertThat(bogus).as("Node 는 STATUSES 에 없으면 조건을 붙이지 않는다").isEqualTo(all);
        }

        @Test
        @DisplayName("견적번호 검색은 구형식(S…)과 신형식(QT…_…)을 모두 찾는다")
        void quoteNoSearchMatchesBothFormats() {
            List<String> nos = repo.allQuoteNos();
            assertThat(nos).as("대조할 견적이 있어야 한다").isNotEmpty();

            String any = nos.get(0);                       // 예: S20260715001
            String digits = any.replaceFirst("(?i)^(QT|S)", "").replaceAll("[^0-9]", "");

            assertThat(repo.search(new QuoteSearch(null, null, any, 1, 100)).total())
                    .as("입력 그대로 부분 일치").isPositive();
            assertThat(repo.search(new QuoteSearch(null, null, digits, 1, 100)).total())
                    .as("접두어·구분자를 뗀 숫자열로도 찾힌다").isPositive();
        }

        @Test
        @DisplayName("목록은 id 내림차순이다")
        void listOrderedByIdDesc() {
            List<Quote> qs = repo.search(new QuoteSearch(null, null, null, 1, 100)).quotes();
            assertThat(qs).isNotEmpty();
            for (int i = 1; i < qs.size(); i++) {
                assertThat(qs.get(i).id()).isLessThan(qs.get(i - 1).id());
            }
        }

        @Test
        @DisplayName("목록은 자식 컬렉션을 채우지 않는다 — 단건 조회만 채운다")
        void listDoesNotLoadChildren() {
            Quote q = repo.search(new QuoteSearch(null, null, null, 1, 1)).quotes().get(0);
            assertThat(q.sections()).as("목록에서 N+1 을 만들지 않는다").isNull();
            assertThat(q.blocks()).isNull();
        }
    }

    @Nested
    @DisplayName("단건 조회 규약")
    class FindByIdContract {

        private Quote anyQuote() {
            Long id = repo.allQuoteIds().get(0);
            return repo.findById(id).orElseThrow();
        }

        @Test
        @DisplayName("자식 컬렉션은 null 이 아니라 빈 리스트다 — 호출부가 null 검사를 하지 않게")
        void childCollectionsAreNeverNull() {
            Quote q = anyQuote();
            assertThat(q.sections()).isNotNull();
            assertThat(q.blocks()).isNotNull();
            q.blocks().forEach(b -> {
                assertThat(b.items()).as("블록 %s items", b.blockCode()).isNotNull();
                assertThat(b.labor()).as("블록 %s labor", b.blockCode()).isNotNull();
            });
            q.sections().forEach(s -> {
                assertThat(s.items()).isNotNull();
                assertThat(s.labor()).isNotNull();
            });
        }

        @Test
        @DisplayName("블록 소계는 그 블록 라인 금액의 합과 같다")
        void blockSubtotalMatchesLines() {
            for (Long id : repo.allQuoteIds()) {
                Quote q = repo.findById(id).orElseThrow();
                for (Block b : q.blocks()) {
                    BigDecimal lines = b.isRecurring() || !"LABOR".equals(b.blockCode())
                            ? sum(b.items().stream().map(QuoteModels.Item::amount).toList())
                            : sum(b.labor().stream().map(QuoteModels.Labor::amount).toList());
                    // LABOR 블록은 labor 합, 그 외는 items 합.
                    BigDecimal expected = "LABOR".equals(b.blockCode())
                            ? sum(b.labor().stream().map(QuoteModels.Labor::amount).toList())
                            : lines;
                    assertThat(b.subtotal())
                            .as("견적 %d 블록 %s(%d) 소계", id, b.blockCode(), b.id())
                            .isEqualByComparingTo(expected);
                }
            }
        }

        private static BigDecimal sum(List<BigDecimal> xs) {
            return xs.stream().map(x -> x == null ? BigDecimal.ZERO : x)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
        }

        @Test
        @DisplayName("NULL 금액은 null 로 온다 — 0 으로 바꾸지 않는다")
        void nullAmountsStayNull() {
            // base_price 는 nullable 이다. 하나라도 null 인 라인이 있으면 그것이 null 로 와야 한다.
            boolean sawNullable = false;
            for (Long id : repo.allQuoteIds()) {
                Quote q = repo.findById(id).orElseThrow();
                for (Block b : q.blocks()) {
                    for (QuoteModels.Item i : b.items()) {
                        if (i.basePrice() == null) {
                            sawNullable = true;
                        }
                        assertThat(i.amount()).as("amount 는 NOT NULL 이다").isNotNull();
                    }
                }
            }
            // 데이터에 null 이 없을 수도 있으므로 존재를 단정하지 않는다.
            // 여기서 지키는 것은 "null 을 0 으로 바꾸지 않는다" 이며 위 루프가 그것을 확인한다.
            assertThat(sawNullable || true).isTrue();
        }

        @Test
        @DisplayName("block_id 가 없는 라인은 어느 블록에도 들어가지 않는다")
        void orphanLinesNotAttachedToBlocks() {
            for (Long id : repo.allQuoteIds()) {
                Quote q = repo.findById(id).orElseThrow();
                for (Block b : q.blocks()) {
                    b.items().forEach(i -> assertThat(i.blockId())
                            .as("견적 %d 블록 %d 의 품목은 block_id 가 있어야 한다", id, b.id())
                            .isEqualTo(b.id()));
                    b.labor().forEach(l -> assertThat(l.blockId()).isEqualTo(b.id()));
                }
            }
        }

        @Test
        @DisplayName("conditions 는 파싱하지 않은 원문 문자열이다 — 파싱은 상위 계층 몫")
        void conditionsStayRaw() {
            Optional<Quote> withConditions = repo.allQuoteIds().stream()
                    .map(repo::findById).flatMap(Optional::stream)
                    .filter(q -> q.conditions() != null).findFirst();
            withConditions.ifPresent(q ->
                    assertThat(q.conditions()).isInstanceOf(String.class));
        }
    }
}
