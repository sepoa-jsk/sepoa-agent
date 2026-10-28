package kr.co.sepoasoft.quote.web;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import kr.co.sepoasoft.quote.web.auth.Access;
import kr.co.sepoasoft.quote.web.auth.Access.Level;
import kr.co.sepoasoft.quote.web.support.Rows;

/** {@code /api/settings} — Node {@code routes/settings.js} 이식. 명세 2-7절. J5-2 는 조회(#34)만. */
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

    Map<String, Object> all() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map<String, Object> r : db.query("SELECT `key`, value FROM sq_settings ORDER BY `key`")) {
            out.put(String.valueOf(r.get("key")), r.get("value"));
        }
        return out;
    }
}
