require('dotenv').config({ path: './quote/.env' });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node seeddb.js <sql파일경로>'); process.exit(1); }

  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    multipleStatements: true,   // ← 핵심
    charset: 'utf8mb4',         // 한글 시드가 깨지지 않게 클라이언트 인코딩 고정
  });
  await conn.query(sql);
  console.log('적용 완료:', file);
  await conn.end();
})().catch(e => console.error('실패:', e.code, '-', e.message));