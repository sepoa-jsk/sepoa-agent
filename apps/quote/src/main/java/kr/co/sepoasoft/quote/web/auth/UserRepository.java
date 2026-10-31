package kr.co.sepoasoft.quote.web.auth;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

/**
 * Node {@code provisionUser} 이식. SQL 문자열은 그대로다.
 *
 * <p>최초 로그인이면 {@code sq_users} 에 넣고(ADMIN_EMAILS 에 있으면 ADMIN), 이미 있으면
 * 이름·사진·마지막 로그인 시각만 갱신한다. 스키마는 건드리지 않는다.
 */
@Repository
public class UserRepository {

    private final JdbcTemplate jdbc;
    private final AuthSettings settings;

    public UserRepository(JdbcTemplate jdbc, AuthSettings settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    public SessionUser provision(String email, String name, String picture) {
        String normEmail = String.valueOf(email).toLowerCase();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM sq_users WHERE email = ?", normEmail);
        if (!rows.isEmpty()) {
            Map<String, Object> u = rows.get(0);
            // 사용자 화면에서 사용 중지한 계정은 로그인하지 못한다(V10 active 칸 — 칸이 없으면 예전대로)
            if (u.get("active") instanceof Number a && a.intValue() == 0) throw new DisabledUserException();
            long id = ((Number) u.get("id")).longValue();
            String newName = name != null ? name : (String) u.get("name");
            String newPicture = picture != null ? picture : (String) u.get("picture");
            jdbc.update("UPDATE sq_users SET name = ?, picture = ?, last_login_at = NOW() WHERE id = ?",
                    newName, newPicture, id);
            return new SessionUser(id, (String) u.get("email"), newName, newPicture, (String) u.get("role"));
        }
        String role = settings.isAdminEmail(normEmail) ? "ADMIN" : "USER";
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO sq_users (email, name, picture, role, last_login_at) VALUES (?, ?, ?, ?, NOW())",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, normEmail);
            ps.setString(2, name);
            ps.setString(3, picture);
            ps.setString(4, role);
            return ps;
        }, key);
        return new SessionUser(key.getKey().longValue(), normEmail, name, picture, role);
    }

    /** 사용 중지된 계정 */
    public static class DisabledUserException extends RuntimeException {
        public DisabledUserException() {
            super("사용 중지된 계정입니다. 관리자에게 문의하세요.");
        }
    }
}
