'use strict';
// 마이그레이션 러너: db/migrations/ 하위 NNN_YYYYMMDD_설명.sql 을 번호순으로 실행한다.
// 각 파일을 세미콜론 기준으로 분리해 순차 실행 (mysql2는 기본 단일 statement).
//
// ⚠️ 적용 이력을 기록하지 않는다. 매 실행마다 전 파일을 다시 돌린다.
//    따라서 모든 구문이 멱등이어야 한다(CREATE TABLE IF NOT EXISTS / ADD COLUMN
//    IF NOT EXISTS / WHERE ... IS NULL 백필 등). 새 파일도 같은 규칙을 지킬 것.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function splitStatements(sql) {
  // 라인 주석(-- ) 제거 후 세미콜론 분리. (본 스키마엔 문자열 리터럴 세미콜론 없음)
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const dir = path.join(__dirname, 'migrations');
  // NNN_YYYYMMDD_설명.sql — NNN 이 실행 순서를 정한다(날짜는 정보용).
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_\d{8}_.*\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('실행할 마이그레이션 파일이 없습니다.');
    return;
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const statements = splitStatements(sql);
      process.stdout.write(`▶ ${file} (${statements.length} statements) ... `);
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      console.log('완료');
    }
    console.log(`\n마이그레이션 ${files.length}개 파일 적용 완료.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('마이그레이션 실패:', err.message);
  process.exit(1);
});
