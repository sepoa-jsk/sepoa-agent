'use strict';
// Flyway baseline 생성기 — 현재 스키마의 sq_ 테이블 DDL 을 V1__baseline.sql 로 뽑는다.
//
// ── 왜 필요한가 ──────────────────────────────────────────────────
// db/migrations/ 25개를 빈 DB 에 순서대로 돌리면 013·015 에서 걸린다(작업 10.5 참조).
// 그 결함을 Java 쪽으로 물려받지 않으려고, **과거 마이그레이션을 재생하지 않고
// 현재 스키마를 한 장으로 떠서** baseline 으로 삼는다.
//
// ── 무엇을 뽑나 ──────────────────────────────────────────────────
// sq_ 접두어 테이블만. 같은 스키마에 다른 앱의 테이블 8종이 함께 있으나
// 이 앱의 소유가 아니다(PROGRESS.md 백업 기록 참조).
// **데이터는 넣지 않는다.** 스키마만이다.
//
// ── 사용 ────────────────────────────────────────────────────────
//   node tools/gen-flyway-baseline.js [출력경로]
//   기본 출력: quote_automation/src/main/resources/db/migration/V1__baseline.sql
//
// 위험도: 안전 (원본 DB 를 읽기만 한다)

const path = require('path');
require(path.join(__dirname, '..', '..', 'quote-legacy', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', '..', 'quote-legacy', '.env') });
const fs = require('fs');
const mysql = require(path.join(__dirname, '..', '..', 'quote-legacy', 'node_modules', 'mysql2', 'promise'));

const DEFAULT_OUT = path.join(
  __dirname, '..', 'src', 'main', 'resources', 'db', 'migration', 'V1__baseline.sql');

async function generate({ out, schema, host, port, user, password }) {
  const conn = await mysql.createConnection({
    host, port: +port, user, password, database: schema, charset: 'utf8mb4',
  });
  try {
    const [rows] = await conn.query(
      `SELECT TABLE_NAME n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'sq\\_%'
        ORDER BY TABLE_NAME`, [schema]);
    const tables = rows.map((r) => r.n);
    if (tables.length === 0) throw new Error('sq_ 테이블이 없다');

    const parts = [];
    parts.push('-- Flyway baseline — 현재 스키마 스냅샷 (sq_ 테이블만, 데이터 없음)');
    parts.push('--');
    parts.push('-- 생성: tools/gen-flyway-baseline.js');
    parts.push(`-- 대상 스키마: ${schema}   테이블 ${tables.length}종`);
    parts.push('--');
    parts.push('-- db/migrations/ 25개를 재생하지 않는다. 그 경로에는 013·015 결함이 있어');
    parts.push('-- 빈 DB 에 순서대로 적용하면 실패한다(작업 10.5). 이 파일이 그 결함을 끊는다.');
    parts.push('--');
    parts.push('-- AUTO_INCREMENT 시작값은 제거했다. 새 환경은 1 부터 시작한다.');
    parts.push('-- FK 를 잠시 끄는 이유는 테이블 생성 순서에 의존하지 않기 위함이다.');
    parts.push('');
    parts.push('SET FOREIGN_KEY_CHECKS = 0;');
    parts.push('');

    for (const t of tables) {
      const [[ddlRow]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      let ddl = ddlRow['Create Table'];
      // 새 환경이 1 부터 채번하도록 시작값을 뗀다.
      ddl = ddl.replace(/\s+AUTO_INCREMENT=\d+/g, '');
      parts.push(`-- ── ${t} ──`);
      parts.push('DROP TABLE IF EXISTS `' + t + '`;');
      parts.push(ddl + ';');
      parts.push('');
    }

    parts.push('SET FOREIGN_KEY_CHECKS = 1;');
    parts.push('');

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, parts.join('\n'), 'utf8');

    const size = fs.statSync(out).size;
    console.log(`baseline 생성: ${out}`);
    console.log(`  테이블 ${tables.length}종 · ${size.toLocaleString('ko-KR')} B`);
    return { tables, out, size };
  } finally {
    await conn.end();
  }
}

module.exports = { generate };

if (require.main === module) {
  const out = process.argv[2] || DEFAULT_OUT;
  generate({
    out,
    schema: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  }).catch((e) => { console.error('생성 실패:', e.message); process.exit(1); });
}
