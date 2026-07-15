require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [r] = await c.query("SELECT `key`, label, deployment FROM sq_company_classes WHERE solution='PROCURE' ORDER BY deployment, sort");
  console.table(r);
  await c.end();
})().catch(e => console.error(e.message));