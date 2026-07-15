require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  console.log('[모듈 네고율]');
  console.table(await c.query("SELECT company_key, onsite_key, rate FROM sq_module_rates WHERE solution='PROCURE' ORDER BY company_key, onsite_key").then(r=>r[0]));
  console.log('[인력 네고율]');
  console.table(await c.query("SELECT company_key, onsite_key, rate FROM sq_labor_rates_v2 WHERE solution='PROCURE' ORDER BY company_key, onsite_key").then(r=>r[0]));
  await c.end();
})().catch(e=>console.error(e.message));
