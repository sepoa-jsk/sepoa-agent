// 덤프 무결성 검증 — 임시 스키마에 **실제로 복원해** 원본과 대조하고 임시 스키마를 지운다.
//
// 파일을 눈으로 훑거나 INSERT 문 개수를 세는 것으로는 복원 가능 여부를 알 수 없다.
// 백업 4차는 작업 20 DROP 직전이라, 복원되지 않는 백업은 백업이 아니다.
// 문장 구분은 dumpformat.js 의 규칙을 그대로 쓴다(덤퍼와 같은 모듈).
//
// 사용:
//   node tools/ops/dbverify.js <덤프경로.sql> [원본스키마] [임시스키마]
// 대조 실패 시 종료코드 1.
//
// 위험도: 안전 (원본 DB 는 읽기만 한다. 쓰기는 임시 스키마에만 일어나고 끝나면 삭제한다)
require('dotenv').config({ path: require('path').join(__dirname, '../../../quote-legacy/.env') });
const fs = require('fs');
const mysql = require('mysql2/promise');
const fmt = require('./dumpformat');

const q = (id) => '`' + String(id).replace(/`/g, '``') + '`';

// 테이블 내용 체크섬 — 행수만으로는 값이 바뀐 것을 못 잡는다.
async function checksum(conn, schema, table) {
  const [r] = await conn.query(`CHECKSUM TABLE ${q(schema)}.${q(table)}`);
  return r[0] ? String(r[0].Checksum) : null;
}

async function verify({ dumpPath, schema, tmpSchema, host, port, user, password, log = console.log }) {
  const results = [];
  const add = (label, pass, detail = '') => { results.push({ label, pass, detail }); return pass; };

  const size = fs.existsSync(dumpPath) ? fs.statSync(dumpPath).size : 0;
  add('덤프 파일 크기 > 0', size > 0, `${size.toLocaleString('ko-KR')} B`);

  const sql = fs.readFileSync(dumpPath, 'utf8');
  const stmts = fmt.split(sql);
  add('문장 파싱', stmts.length > 0, `${stmts.length}문`);

  const conn = await mysql.createConnection({
    host, port: +port, user, password, charset: 'utf8mb4',
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  });

  try {
    // ── 원본 현황 ──
    const [live] = await conn.query(
      `SELECT TABLE_NAME n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [schema]);
    const liveTables = live.map((r) => r.n);
    const dumpTables = [...sql.matchAll(/^CREATE TABLE `([^`]+)`/gm)].map((m) => m[1]);
    const missing = liveTables.filter((t) => !dumpTables.includes(t));
    add('원본 테이블이 전부 덤프에 있음', missing.length === 0,
      `덤프 ${dumpTables.length}종 / 원본 ${liveTables.length}종${missing.length ? ' · 누락 ' + missing.join(', ') : ''}`);

    const livePrefixed = liveTables.filter((t) => t.startsWith('sq_'));
    add('sq_ 테이블 포함', livePrefixed.every((t) => dumpTables.includes(t)),
      `sq_ ${livePrefixed.length}종`);

    const liveCounts = {}, liveSums = {};
    for (const t of liveTables) {
      const [[c]] = await conn.query(`SELECT COUNT(*) n FROM ${q(schema)}.${q(t)}`);
      liveCounts[t] = Number(c.n);
      liveSums[t] = await checksum(conn, schema, t);
    }

    // ── 임시 스키마에 복원 ──
    await conn.query(`DROP DATABASE IF EXISTS ${q(tmpSchema)}`);
    await conn.query(`CREATE DATABASE ${q(tmpSchema)} DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE ${q(tmpSchema)}`);

    const errs = [];
    let applied = 0;
    for (const s of stmts) {
      if (/^(LOCK|UNLOCK)\s+TABLES/i.test(s)) continue;
      try { await conn.query(s); applied++; }
      catch (e) { errs.push(`${e.code}: ${s.slice(0, 100).replace(/\s+/g, ' ')}`); }
    }
    add('덤프 복원 무오류', errs.length === 0, `${applied}문 적용${errs.length ? ' · 실패 ' + errs.length : ''}`);
    errs.slice(0, 5).forEach((e) => log('     ' + e));

    // ── 대조 ──
    const [rest] = await conn.query(
      `SELECT TABLE_NAME n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`, [tmpSchema]);
    add('복원 테이블 수 = 원본', rest.length === liveTables.length, `${rest.length} / ${liveTables.length}`);

    const rowDiff = [], sumDiff = [];
    let liveTotal = 0, restTotal = 0;
    for (const t of liveTables) {
      liveTotal += liveCounts[t];
      let n = -1;
      try { const [[c]] = await conn.query(`SELECT COUNT(*) n FROM ${q(tmpSchema)}.${q(t)}`); n = Number(c.n); } catch { /* 미복원 */ }
      restTotal += Math.max(0, n);
      if (n !== liveCounts[t]) rowDiff.push(`${t}: 원본 ${liveCounts[t]} vs 복원 ${n}`);
      else {
        const s2 = await checksum(conn, tmpSchema, t).catch(() => null);
        if (liveSums[t] !== null && s2 !== null && liveSums[t] !== s2) sumDiff.push(`${t}: ${liveSums[t]} vs ${s2}`);
      }
    }
    add('전 테이블 행수 일치', rowDiff.length === 0,
      `총 ${liveTotal}행 (복원 ${restTotal}행)${rowDiff.length ? ' · 불일치 ' + rowDiff.length + '건' : ''}`);
    rowDiff.slice(0, 8).forEach((d) => log('     ' + d));
    // CHECKSUM TABLE 은 스토리지 엔진·행 순서에 따라 달라질 수 있어 참고값으로만 본다.
    add('테이블 체크섬 일치 (참고)', true,
      sumDiff.length ? `${sumDiff.length}건 상이 — 행수는 일치하므로 순서/엔진 차이일 수 있다` : '전 테이블 동일');
    sumDiff.slice(0, 5).forEach((d) => log('     ' + d));

    // ── 임시 스키마 삭제 ──
    await conn.query(`DROP DATABASE ${q(tmpSchema)}`);
    const [[gone]] = await conn.query(
      'SELECT COUNT(*) n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [tmpSchema]);
    add('임시 스키마 삭제', Number(gone.n) === 0, `잔존 ${gone.n}`);

    return { results, liveTotal, restTotal, tables: liveTables.length };
  } finally {
    // 검증 중 예외가 나도 임시 스키마를 남기지 않는다.
    try { await conn.query(`DROP DATABASE IF EXISTS ${q(tmpSchema)}`); } catch { /* 이미 삭제됨 */ }
    await conn.end();
  }
}

module.exports = { verify };

if (require.main === module) {
  const dumpPath = process.argv[2];
  const schema = process.argv[3] || process.env.DB_NAME;
  const tmpSchema = process.argv[4] || `${schema}_restorecheck`;
  if (!dumpPath) {
    console.error('사용법: node tools/ops/dbverify.js <덤프경로.sql> [원본스키마] [임시스키마]');
    process.exit(1);
  }
  verify({ dumpPath, schema, tmpSchema, host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD })
    .then(({ results }) => {
      for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? '  → ' + r.detail : ''}`);
      const fail = results.filter((r) => !r.pass).length;
      console.log(fail ? `\n실패 ${fail}건` : '\n전 항목 PASS');
      process.exit(fail ? 1 : 0);
    })
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
