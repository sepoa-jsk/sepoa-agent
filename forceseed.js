require('dotenv').config({ path: './quote/.env' });
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
  const sql = fs.readFileSync('./quote/sql/011_procure_saas_seed.sql', 'utf8');
  console.log('파일 길이:', sql.length, '자');
  console.log('S2C 포함?', sql.includes('PRO_SAAS_S2C'));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const stmts = sql.split(/;\s*[\r\n]/).map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));
  let ok = 0;
  for (const s of stmts) {
    try { await conn.query(s); ok++; }
    catch (e) { console.error('실패:', e.code, '-', s.slice(0, 70).replace(/\n/g,' ')); }
  }
  console.log(`실행: ${ok}/${stmts.length}`);

  const [r] = await conn.query("SELECT COUNT(*) n FROM sq_price_items WHERE code LIKE 'PRO_SAAS_S%'");
  console.log('PRO_SAAS_S* 품목수:', r[0].n);
  await conn.end();
})().catch(e => console.error(e.message));