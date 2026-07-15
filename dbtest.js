require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  console.log('접속 정보:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD ? '(설정됨)' : '(비어있음!)',
  });

  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    console.log('DB 접속 성공');

    const [rows] = await conn.query('SHOW TABLES');
    console.log('테이블 개수:', rows.length);
    console.table(rows);

    await conn.end();
  } catch (e) {
    console.error('실패:', e.code, '-', e.message);
  }
})();