'use strict';
// 견적번호 채번.
//
//   신형식  QT{YYYYMMDD}_{NNN}   예) QT20260802_001   ← 지금 채번하는 형식
//   구형식  S{YYYYMMDD}{NNN}     예) S20260415005     ← 기존 레코드. 절대 바꾸지 않는다
//
// ── 시퀀스 구조는 바꾸지 않는다 ────────────────────────────────
// `sq_quote_seq` 는 (seq_date PK, last_no) 이며 **형식과 무관한 일자별 카운터**다.
// 번호 문자열을 만드는 방식만 바뀌므로 테이블 구조·기존 행을 손대지 않는다.
// 같은 날짜에 구형식과 신형식이 섞여도 카운터가 하나라 순번이 겹치지 않는다.
//   예) 2026-08-02 에 구형식 S20260802001 이 이미 있으면 last_no=1 이므로
//       다음 채번은 002 가 되어 QT20260802_002 가 된다.
// 카운터는 되돌아가지 않는다(삭제된 견적의 번호는 재사용하지 않는다).
//
// 채번 기준일은 **견적일자(quote_date)** 다. 생성일시가 아니다 — 기존 동작 그대로다.
// 반드시 트랜잭션 커넥션(conn)을 받아 호출한다.

const PREFIX = 'QT';

function ymd(dateStr) {
  return String(dateStr).slice(0, 10).replace(/-/g, '');
}

function formatQuoteNo(dateStr, seq) {
  return `${PREFIX}${ymd(dateStr)}_${String(seq).padStart(3, '0')}`;
}

async function nextQuoteNo(conn, quoteDate) {
  const date = quoteDate ? String(quoteDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  // 원자적 증가: 없으면 1, 있으면 +1 (행 잠금으로 동시 채번 중복 방지)
  await conn.execute(
    `INSERT INTO sq_quote_seq (seq_date, last_no) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_no = last_no + 1`,
    [date]
  );
  const [rows] = await conn.execute('SELECT last_no FROM sq_quote_seq WHERE seq_date = ?', [date]);
  return formatQuoteNo(date, rows[0].last_no);
}

// ── 조회·검색 ─────────────────────────────────────────────────
// 두 형식을 모두 인식한다. 반환값은 { date: 'YYYY-MM-DD', seq: n } 또는 null.
const RE_NEW = /^QT(\d{8})_(\d{1,})$/i;
const RE_OLD = /^S(\d{8})(\d{3})$/i;

function parseQuoteNo(no) {
  const s = String(no || '').trim();
  const m = s.match(RE_NEW) || s.match(RE_OLD);
  if (!m) return null;
  const d = m[1];
  return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, seq: Number(m[2]) };
}

// 검색어를 두 형식 모두에 걸리게 만든다.
// 사용자가 어느 형식으로 입력하든(또는 접두어 없이 숫자만 입력해도) 찾아야 한다.
//   'QT20260802_001' · 'S20260802001' · '20260802001' · '20260802' · '001'
// → { sql, params } 를 돌려주며 호출부가 WHERE 절에 끼운다.
function quoteNoSearchClause(term) {
  const raw = String(term || '').trim();
  if (!raw) return null;
  // 구분자·접두어를 뗀 숫자열로 정규화해 양쪽 형식을 함께 맞춘다.
  const digits = raw.replace(/^(QT|S)/i, '').replace(/[^0-9]/g, '');
  const like = [];
  const params = [];
  // ① 입력 문자열 그대로 부분 일치 (형식을 그대로 친 경우)
  like.push('quote_no LIKE ?');
  params.push(`%${raw}%`);
  // ② 구분자를 무시한 숫자열 일치 — 저장된 번호에서 접두어·밑줄을 제거해 비교한다
  if (digits) {
    like.push("REPLACE(REPLACE(REPLACE(quote_no, 'QT', ''), 'S', ''), '_', '') LIKE ?");
    params.push(`%${digits}%`);
  }
  return { sql: `(${like.join(' OR ')})`, params };
}

module.exports = { nextQuoteNo, formatQuoteNo, parseQuoteNo, quoteNoSearchClause, PREFIX };
