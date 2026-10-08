// 덤프 파일 포맷 규칙 — dbdump(쓰기)와 dbverify(읽기)가 **같은 모듈**을 쓴다.
// 규칙이 한쪽에만 있으면 반드시 어긋난다. 실제로 어긋났었다:
//   sq_blocks.calc = "소계합→특별DC→십만절사; VAT별도; 일시불/월 분리"
// 값 안의 세미콜론 때문에 단순 split(';') 이 문장을 잘못 잘랐다.
//
// ── 문장 구분 방식 ────────────────────────────────────────────
// 모든 문장은 `;` 로 끝내고, 바로 다음 줄에 센티넬 주석 한 줄을 둔다.
//
//     INSERT INTO `t` (`a`) VALUES ('세미콜론; 포함');
//     -- @@SQ-EOS@@
//
// 읽기는 **센티넬 줄로만** 자른다. 세미콜론은 보지 않는다.
// 센티넬이 값 안에 나타날 수 없는 이유:
//   ① 값의 개행은 전부 `\n` 으로 이스케이프되므로 리터럴 안에 생(raw) 개행이 없다.
//      → 값이 "한 줄 전체"를 만들어 낼 수 없다.
//   ② 그래도 방어적으로, 쓰기 시 센티넬 문자열이 문장 안에 있으면 예외를 던진다.
// 센티넬은 SQL 주석이라, 진짜 mysql 클라이언트로 읽어도 `;` 기준으로 정상 복원된다.
'use strict';

// mysql2 가 직접 의존성이므로 그 escape 를 쓴다(내부적으로 sqlstring).
// 작은따옴표 · 역슬래시 · 개행(\n) · CR(\r) · 탭(\t) · NUL(\0) · Ctrl-Z(\Z) 전부 처리한다.
const { escape: sqlEscape } = require('mysql2');

const EOS = '-- @@SQ-EOS@@';

// ── 값 직렬화 ────────────────────────────────────────────────
// 컬럼의 선언 타입(information_schema.COLUMNS.DATA_TYPE)을 받아 타입별로 쓴다.
// NULL 과 빈 문자열은 반드시 구분한다 — NULL 을 '' 로 쓰면 복원 시 의미가 바뀐다.
const NUMERIC = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
  'decimal', 'numeric', 'float', 'double', 'real', 'bit']);
const BINARY = new Set(['binary', 'varbinary', 'tinyblob', 'blob', 'mediumblob', 'longblob']);
const NUMERIC_RE = /^-?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/i;

function serialize(value, dataType) {
  if (value === null || value === undefined) return 'NULL';   // 빈 문자열과 구분된다
  const type = String(dataType || '').toLowerCase();

  if (Buffer.isBuffer(value)) {
    return value.length ? `X'${value.toString('hex')}'` : `''`;
  }
  if (BINARY.has(type)) {
    // 드라이버가 문자열로 준 경우에도 바이트를 보존한다
    return `X'${Buffer.from(String(value), 'binary').toString('hex')}'`;
  }
  if (type === 'json') {
    // mysql2 는 JSON 컬럼을 파싱해 객체로 준다. SqlString.escape 에 객체를 그대로
    // 넘기면 `k = v` 형태(SET 절용)로 펼쳐지므로 반드시 직접 문자열화한다.
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return escapeString(text);
  }
  if (NUMERIC.has(type)) {
    if (typeof value === 'boolean') return value ? '1' : '0';
    const s = String(value);
    // BIGINT 는 정밀도 손실을 피하려 문자열로 받는다(bigNumberStrings).
    // 숫자 모양이면 따옴표 없이 그대로 쓴다.
    if (NUMERIC_RE.test(s)) return s;
    return escapeString(s);   // 예상 밖 값이면 문자열로라도 보존한다
  }
  if (value instanceof Date) {
    // dateStrings 를 켜서 여기 오지 않는 것이 정상이다. 와도 UTC 로 고정한다.
    return escapeString(value.toISOString().slice(0, 19).replace('T', ' '));
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return escapeString(String(value));
}

// 문자열 이스케이프. 우리가 추가로 보장할 것은 "생 개행이 남지 않는다" 뿐이다 —
// 이 불변식이 센티넬 방식의 전제다(값이 한 줄 전체를 만들어 낼 수 없다).
function escapeString(s) {
  const out = sqlEscape(s);
  if (/[\r\n]/.test(out)) {
    throw new Error('이스케이프 후에도 생 개행이 남았습니다. 덤프 포맷 규칙 위반입니다.');
  }
  return out;
}

// ── 쓰기 ──────────────────────────────────────────────────────
// 문장 하나를 센티넬과 함께 직렬화한다.
// 불변식은 "센티넬을 포함하지 않는다"가 아니라 **"센티넬만으로 이뤄진 줄이 없다"** 이다.
// 값 안에 센티넬 문자열이 들어 있는 것은 정상이며 덤프할 수 있어야 한다 —
// 값은 언제나 따옴표와 튜플 괄호에 둘러싸여 한 줄을 통째로 차지할 수 없기 때문이다.
// (값의 개행은 escapeString 이 전부 `\n` 으로 바꾸므로 값이 줄을 새로 만들지도 못한다)
function statement(sql) {
  const body = sql.trim().replace(/;+$/, '');
  for (const line of body.split('\n')) {
    if (line.trim() === EOS) {
      throw new Error(`문장 안에 센티넬(${EOS})만으로 이뤄진 줄이 있습니다. 덤프 포맷 규칙 위반입니다.`);
    }
  }
  return `${body};\n${EOS}\n`;
}

// ── 읽기 ──────────────────────────────────────────────────────
// 센티넬 줄로만 자른다. 값 안의 세미콜론은 영향을 주지 않는다.
function split(text) {
  const out = [];
  let buf = [];
  const flush = () => {
    const s = clean(buf);
    if (s) out.push(s);
    buf = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === EOS) { flush(); continue; }
    buf.push(line);
  }
  flush();   // 센티넬 없이 남은 꼬리(끝 주석 등)는 clean 이 걸러 낸다
  return out;
}

// 한 덩어리에서 문장만 남긴다.
// 각 문장 앞에는 설명 주석이 붙어 있다(`-- 데이터: sq_quotes (11행)`).
// **선행 주석 줄만** 벗겨야 한다. 덩어리 전체를 "주석으로 시작한다"고 버리면
// 뒤따르는 진짜 문장까지 통째로 사라진다(실제로 그렇게 만들었다가 INSERT 가 전부 날아갔다).
function clean(lines) {
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('--')) { i++; continue; }
    break;
  }
  return lines.slice(i).join('\n').trim().replace(/;\s*$/, '');
}

module.exports = { EOS, serialize, escapeString, statement, split };
