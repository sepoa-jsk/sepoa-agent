require('dotenv').config({ path: './quote/.env' });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'quote/sql/001_schema.sql'), 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,   // 여러 CREATE 문 한 번에 실행
  });

  console.log('접속:', process.env.DB_HOST, '/', process.env.DB_NAME);
  await conn.query(sql);
  console.log('스키마 적용 완료');

  const [rows] = await conn.query('SHOW TABLES');
  console.log('테이블 개수:', rows.length);
  console.table(rows);

  await conn.end();
})().catch(e => console.error('실패:', e.code, '-', e.message));