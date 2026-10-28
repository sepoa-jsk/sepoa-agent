package kr.co.sepoasoft.quote.web;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.auth.AuthSettings;

/**
 * 헬스체크. context path 가 {@code /quote2} 이므로 실제 경로는 {@code /quote2/api/health} 다.
 *
 * <p><b>DB 는 {@code SELECT 1} 로만 확인한다.</b> 개발 DB 를 Node 앱과 공유 중이라
 * 쓰기 쿼리를 넣지 않는다. 커넥션이 실제로 열리는지까지 봐야 하므로 단순 풀 상태 조회로
 * 갈음하지 않는다.
 *
 * <p><b>실패를 삼키지 않는다.</b> DB 가 죽었는데 200 을 돌려주면 헬스체크가 존재할 이유가
 * 없다. 예외는 로그에 스택과 함께 남기고, 응답에는 예외 종류와 메시지를 담아 500 으로
 * 내린다. {@code docs/LESSONS.md} 의 '조용한 실패' 원칙에 따른 것이다 — Node 쪽에서
 * {@code dataUri()} 가 try/catch 로 null 을 돌려주는 바람에 이미지 빠진 PDF 가 정상으로
 * 보였던 전례가 있다.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final JdbcTemplate jdbcTemplate;
    private final AuthSettings authSettings;

    public HealthController(DataSource dataSource, AuthSettings authSettings) {
        this.jdbcTemplate = new JdbcTemplate(dataSource);
        this.authSettings = authSettings;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("time", OffsetDateTime.now().toString());

        try {
            Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            if (one == null || one != 1) {
                // 예외 없이 이상한 값이 온 경우. 조용히 UP 으로 넘기지 않는다.
                throw new IllegalStateException("SELECT 1 이 " + one + " 을 반환했다");
            }
            body.put("status", "UP");
            body.put("db", "UP");
            return ResponseEntity.ok(reorder(body));
        } catch (Exception e) {
            log.error("헬스체크 DB 확인 실패", e);
            body.put("status", "DOWN");
            body.put("db", "DOWN");
            body.put("error", e.getClass().getSimpleName());
            body.put("message", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(reorder(body));
        }
    }

    /**
     * 응답 키 순서를 status → db → time → ok → authMode → (오류) 로 맞춘다.
     *
     * <p>{@code ok}·{@code authMode} 는 J5 에서 더했다(명세 3장 B). 로그인 화면이 Node 응답
     * {@code {ok, authMode}} 의 {@code authMode} 를 읽어 dev 로그인 버튼을 띄우기 때문이다.
     * {@code status}·{@code db} 는 게이트웨이·dev.ps1 이 쓰므로 지우지 않는다.
     * Node 는 실패 시 {@code db} 에 오류 문구를 담지만 여기서는 {@code "DOWN"} 을 유지한다 —
     * 화면은 실패 응답을 읽지 않는다.
     */
    private Map<String, Object> reorder(Map<String, Object> src) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", src.get("status"));
        out.put("db", src.get("db"));
        out.put("time", src.get("time"));
        out.put("ok", "UP".equals(src.get("status")));
        out.put("authMode", authSettings.authMode());
        if (src.containsKey("error")) {
            out.put("error", src.get("error"));
            out.put("message", src.get("message"));
        }
        return out;
    }
}
