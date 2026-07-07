'use strict';
// 견적번호 채번: S + YYYYMMDD + 3자리 시퀀스 (예: S20260707001)
// 일자별 시퀀스. sq_quote_seq 행 잠금 + 트랜잭션으로 중복 방지.
// 반드시 트랜잭션 커넥션(conn)을 받아 호출한다.

function ymd(dateStr) {
  // dateStr: 'YYYY-MM-DD' → 'YYYYMMDD'
  return String(dateStr).slice(0, 10).replace(/-/g, '');
}

async function nextQuoteNo(conn, quoteDate) {
  const date = quoteDate ? String(quoteDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  // 원자적 증가: 없으면 1, 있으면 +1
  await conn.execute(
    `INSERT INTO sq_quote_seq (seq_date, last_no) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE last_no = last_no + 1`,
    [date]
  );
  const [rows] = await conn.execute('SELECT last_no FROM sq_quote_seq WHERE seq_date = ?', [date]);
  const seq = rows[0].last_no;
  return `S${ymd(date)}${String(seq).padStart(3, '0')}`;
}

module.exports = { nextQuoteNo };
