package kr.co.sepoasoft.quote.web.support;

import java.math.BigDecimal;

/**
 * 요청 값을 Node 와 같게 해석하는 데 필요한 JS 규칙 몇 가지. 라우트가 {@code Number(...)} 로
 * 받은 값을 Java 에서 다르게 읽으면 같은 요청에 다른 결과가 나온다.
 */
public final class Js {

    private Js() {
    }

    /** JS {@code Number(s)} — 없으면 NaN, 공백뿐이면 0, 숫자가 아니면 NaN */
    public static double number(String s) {
        if (s == null) return Double.NaN;
        String t = s.strip();
        if (t.isEmpty()) return 0;
        if (t.equals("Infinity") || t.equals("+Infinity")) return Double.POSITIVE_INFINITY;
        if (t.equals("-Infinity")) return Double.NEGATIVE_INFINITY;
        // Java 는 "1d"·"1f"·"NaN" 도 받아들이므로 JS 십진 표기만 통과시킨다
        if (!t.matches("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")) return Double.NaN;
        return Double.parseDouble(t);
    }

    /**
     * JS {@code Number(v)} — JSON 으로 받은 값(Map 의 값) 용. {@code null} 은 0 이다.
     * Map 에서는 "키 없음(undefined → NaN)" 과 "null" 이 구분되지 않으므로, 둘이 갈리는 곳은 호출부가 따로 본다.
     */
    public static double toNumber(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof Boolean b) return b ? 1 : 0;
        if (v instanceof String s) return number(s);
        return Double.NaN;
    }

    /** JS 참·거짓 — {@code Number(x) || fallback} 의 왼쪽 */
    public static boolean truthy(double d) {
        return d != 0 && !Double.isNaN(d);
    }

    /** {@code Number(x) || fallback} */
    public static double or(double d, double fallback) {
        return truthy(d) ? d : fallback;
    }

    /** JS {@code Math.round} — +∞ 방향 반올림, NaN 은 NaN 그대로 */
    public static double round(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return d;
        return Math.floor(d + 0.5);
    }

    /**
     * JS 숫자를 JSON 으로 낼 때 — 정수면 long, 아니면 double. NaN·Infinity 는
     * {@code JSON.stringify} 처럼 {@code null} 이다.
     */
    public static Number json(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return null;
        return d == Math.rint(d) && Math.abs(d) < 9.007199254740992E15 ? (Number) (long) d : (Number) d;
    }

    /** 엔진의 BigDecimal 을 JSON 숫자로 — {@code 1E+7} 같은 지수 표기를 피한다 */
    public static Number json(BigDecimal d) {
        if (d == null) return null;
        BigDecimal s = d.stripTrailingZeros();
        return s.scale() <= 0 ? (Number) s.longValueExact() : (Number) s.doubleValue();
    }
}
