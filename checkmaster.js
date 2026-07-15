require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const tables = {
    'sq_company_classes': "WHERE solution='PROCURE' AND deployment='ONPREM'",
    'sq_service_types':   "WHERE solution='PROCURE'",
    'sq_modules':         "WHERE solution='PROCURE'",
    'sq_labor_roles':     "WHERE solution='PROCURE'",
    'sq_labor_rates':     "WHERE solution='PROCURE'",
    'sq_thirdparty':      "WHERE solution='PROCURE'",
  };
  for (const [t, where] of Object.entries(tables)) {
    const [r] = await c.query(`SELECT COUNT(*) n FROM ${t} ${where}`);
    console.log(t.padEnd(20), r[0].n, '건');
  }
  console.log('\n[모듈]');
  const [m] = await c.query("SELECT code,name,base_price FROM sq_modules WHERE solution='PROCURE' ORDER BY sort");
  console.table(m);
  console.log('[네고율]');
  const [lr] = await c.query("SELECT company_key,rate FROM sq_labor_rates WHERE solution='PROCURE' ORDER BY sort");
  console.table(lr);
  await c.end();
})().catch(e => console.error(e.message));