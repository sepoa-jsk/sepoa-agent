require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  for (const t of ['sq_solutions', 'sq_deployments', 'sq_company_classes', 'sq_price_items', 'sq_price_variants']) {
    const [r] = await conn.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(t.padEnd(22), r[0].n, '건');
  }
  await conn.end();
})().catch(e => console.error(e.code, e.message));