'use strict';
// 마이그레이션 러너: sql/ 하위 NNN_*.sql 파일을 번호순으로 실행한다.
// 각 파일을 세미콜론 기준으로 분리해 순차 실행 (mysql2는 기본 단일 statement).
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
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
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
