package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.advice.ApiException;
import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Js;
import kr.co.sepoasoft.quote.web.support.Rows;

/** {@code /api/settings} — Node {@code routes/settings.js} 이식. 명세 2-7절. 조회는 로그인, 수정은 관리자. */
@RestController
@RequestMapping("/api/settings")
@Access(Level.LOGIN)
public class SettingsController {

    private final Rows db;

    public SettingsController(Rows db) {
        this.db = db;
    }

    /** #34 전체 key-value */
    @GetMapping
    public Map<String, Object> get() {
        return Map.of("settings", all());
    }

    /**
     * #35 {@code {settings: {key: value}}} 일괄 upsert. 값은 JS {@code String(v)} 로 저장하고 null 은 null.
     * Node 처럼 키마다 따로 쓴다(트랜잭션 없음). 배열도 객체라 통과한다 — 키는 인덱스다.
     */
    @PutMapping
    @Access(Level.ADMIN)
    public Map<String, Object> put(@RequestBody(required = false) Map<String, Object> body) {
        Object settings = body == null ? null : body.get("settings");
        Map<String, Object> entries = new LinkedHashMap<>();
        if (settings instanceof Map<?, ?> m) {
            m.forEach((k, v) -> entries.put(String.valueOf(k), v));
        } else if (settings instanceof List<?> l) {
            for (int i = 0; i < l.size(); i++) entries.put(String.valueOf(i), l.get(i));
        } else {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BODY", "settings 객체가 필요합니다.");
        }
        for (Map.Entry<String, Object> e : entries.entrySet()) {
            db.update("INSERT INTO sq_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
                    e.getKey(), e.getValue() == null ? null : Js.string(e.getValue()));
        }
        return Map.of("settings", all());
    }

    Map<String, Object> all() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map<String, Object> r : db.query("SELECT `key`, value FROM sq_settings ORDER BY `key`")) {
            out.put(String.valueOf(r.get("key")), r.get("value"));
        }
        return out;
    }
}
