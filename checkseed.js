require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [r] = await c.query("SELECT code, name FROM sq_price_items WHERE code LIKE 'PRO_SAAS%'");
  console.log('SaaS 품목수:', r.length);
  console.table(r);
  await c.end();
})().catch(e => console.error(e.message));