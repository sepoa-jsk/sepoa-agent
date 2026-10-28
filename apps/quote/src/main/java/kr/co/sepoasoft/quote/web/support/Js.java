package kr.co.sepoasoft.quote.web.support;

/**
 * 쿼리스트링을 Node 와 같게 해석하는 데 필요한 JS 규칙 몇 가지. 라우트가 {@code Number(...)} 로
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

    /** JS 참·거짓 — {@code Number(x) || fallback} 의 왼쪽 */
    public static boolean truthy(double d) {
        return d != 0 && !Double.isNaN(d);
    }

    /** JS 숫자를 JSON 으로 낼 때 — 정수면 long, 아니면 double ({@code 2} 와 {@code 2.0} 을 구분) */
    public static Number json(double d) {
        return d == Math.rint(d) && !Double.isInfinite(d) ? (Number) (long) d : (Number) d;
    }
}
