// DB 덤프 — mysqldump 미설치 환경용 대체 도구.
//
// 이 머신에는 mysqldump · mariadb-dump 가 없고 WSL·Docker 도 없다(2026-08-02 확인).
// 백업 2~4차가 이 도구에 의존하며, 4차는 작업 20 DROP 직전이라 복원 실패 시 되돌릴 수 없다.
// 그래서 포맷 규칙은 dumpformat.js 한 곳에 두고 dbverify.js 가 같은 모듈로 읽는다.
//
// mysqldump 옵션 대응:
//   --single-transaction  START TRANSACTION WITH CONSISTENT SNAPSHOT (단일 커넥션, REPEATABLE READ)
//   --routines            SHOW CREATE PROCEDURE / FUNCTION
//   --triggers            SHOW CREATE TRIGGER
//   --default-character-set=utf8mb4   SET NAMES utf8mb4
//
// 사용:
//   node tools/ops/dbdump.js <출력경로.sql> [스키마명]
// 스키마명을 생략하면 quote/.env 의 DB_NAME 을 쓴다.
//
// 위험도: 안전 (읽기 전용 — 대상 DB 에 아무것도 쓰지 않는다)
require('dotenv').config({ path: require('path').join(__dirname, '../../quote/.env') });
const fs = require('fs');
const mysql = require('mysql2/promise');
const fmt = require('./dumpformat');

const q = (id) => '`' + String(id).replace(/`/g, '``') + '`';

async function dump({ out, schema, host, port, user, password }) {
  const conn = await mysql.createConnection({
    host, port: +port, user, password, database: schema,
    charset: 'utf8mb4',
    dateStrings: true,          // DATETIME/DATE/TIMESTAMP 를 문자열로 — 타임존 이동을 막는다
    supportBigNumbers: true,
    bigNumberStrings: true,     // BIGINT 정밀도 손실 방지
  });

  const w = fs.createWriteStream(out, { encoding: 'utf8' });
  const put = (s) => new Promise((r) => (w.write(s) ? r() : w.once('drain', r)));
  const stmt = (s) => put(fmt.statement(s));

  try {
    // --single-transaction 상당. DDL 조회 전에 스냅샷을 연다.
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');

    const [[ver]] = await conn.query('SELECT VERSION() v');
    await put(`-- DB 덤프 (mysqldump 미설치 환경용 대체 도구 — tools/ops/dbdump.js)\n`);
    await put(`-- 스키마: ${schema}   서버: ${ver.v}\n`);
    await put(`-- 옵션 대응: --single-transaction --routines --triggers --default-character-set=utf8mb4\n`);
    await put(`-- 문장 구분: 각 문장 뒤 "${fmt.EOS}" 한 줄. 복원은 tools/ops/dbverify.js 또는 mysql 클라이언트.\n`);
    await put(`-- 주의: 이 파일은 레포에 커밋하지 않는다.\n\n`);

    await stmt('SET NAMES utf8mb4');
    await stmt("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'");
    await stmt('SET SESSION time_zone = \'+00:00\'');
    // FK 순서 문제 회피 — 덤프 앞에서 끄고 맨 뒤에서 되돌린다.
    await stmt('SET FOREIGN_KEY_CHECKS = 0');

    const [objs] = await conn.query(
      `SELECT TABLE_NAME n, TABLE_TYPE t FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [schema]);
    const tables = objs.filter((r) => r.t === 'BASE TABLE').map((r) => r.n);
    const views = objs.filter((r) => r.t === 'VIEW').map((r) => r.n);

    // 컬럼 선언 타입 — 값 직렬화를 타입별로 하기 위해 미리 읽는다.
    const [colRows] = await conn.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?`, [schema]);
    const colType = {};
    for (const r of colRows) (colType[r.t] ||= {})[r.c] = r.d;

    const counts = {};
    let totalRows = 0;

    for (const t of tables) {
      const [[ct]] = await conn.query(`SHOW CREATE TABLE ${q(t)}`);
      await put(`\n-- 테이블 구조: ${t}\n`);
      await stmt(`DROP TABLE IF EXISTS ${q(t)}`);
      await stmt(ct['Create Table']);

      const [data] = await conn.query(`SELECT * FROM ${q(t)}`);
      counts[t] = data.length;
      totalRows += data.length;
      if (!data.length) { await put(`-- (${t}: 0행)\n`); continue; }

      await put(`\n-- 데이터: ${t} (${data.length}행)\n`);
      const names = Object.keys(data[0]);
      const cols = names.map(q).join(',');
      const types = colType[t] || {};
      const CHUNK = 200;
      for (let i = 0; i < data.length; i += CHUNK) {
        const tuples = data.slice(i, i + CHUNK).map(
          (row) => `(${names.map((n) => fmt.serialize(row[n], types[n])).join(',')})`);
        await stmt(`INSERT INTO ${q(t)} (${cols}) VALUES\n${tuples.join(',\n')}`);
      }
    }

    for (const v of views) {
      const [[cv]] = await conn.query(`SHOW CREATE VIEW ${q(v)}`);
      await put(`\n-- 뷰: ${v}\n`);
      await stmt(`DROP VIEW IF EXISTS ${q(v)}`);
      await stmt(cv['Create View']);
    }

    // --triggers
    const [trg] = await conn.query(
      'SELECT TRIGGER_NAME n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?', [schema]);
    if (trg.length) await put(`\n-- 트리거 ${trg.length}건\n`);
    for (const t of trg) {
      const [[ct]] = await conn.query(`SHOW CREATE TRIGGER ${q(t.n)}`);
      // 센티넬 방식이라 DELIMITER 없이도 본문의 세미콜론이 문제되지 않는다.
      await stmt(ct['SQL Original Statement']);
    }

    // --routines
    const [rt] = await conn.query(
      'SELECT ROUTINE_NAME n, ROUTINE_TYPE t FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?', [schema]);
    if (rt.length) await put(`\n-- 루틴 ${rt.length}건\n`);
    for (const r of rt) {
      const kind = r.t === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION';
      const [[cr]] = await conn.query(`SHOW CREATE ${kind} ${q(r.n)}`);
      await stmt(cr['Create Procedure'] || cr['Create Function']);
    }

    await put(`\n`);
    await stmt('SET FOREIGN_KEY_CHECKS = 1');
    await put(`-- 덤프 끝\n`);

    await conn.query('COMMIT');

    const meta = { schema, server: ver.v, generatedBy: 'tools/ops/dbdump.js',
      tables: tables.length, views: views.length, triggers: trg.length, routines: rt.length,
      totalRows, counts };
    fs.writeFileSync(out + '.counts.json', JSON.stringify(meta, null, 2));
    return meta;
  } finally {
    await new Promise((r) => w.end(r));
    await conn.end();
  }
}

module.exports = { dump };

if (require.main === module) {
  const out = process.argv[2];
  const schema = process.argv[3] || process.env.DB_NAME;
  if (!out) {
    console.error('사용법: node tools/ops/dbdump.js <출력경로.sql> [스키마명]');
    process.exit(1);
  }
  dump({ out, schema, host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD })
    .then((m) => {
      const size = fs.statSync(out).size;
      console.log(`덤프 완료: ${out}`);
      console.log(`  스키마 ${m.schema} · 테이블 ${m.tables} · 뷰 ${m.views} · 트리거 ${m.triggers} · 루틴 ${m.routines}`);
      console.log(`  총 ${m.totalRows}행 · ${size.toLocaleString('ko-KR')} B`);
      console.log(`  검증: node tools/ops/dbverify.js ${out}`);
    })
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
