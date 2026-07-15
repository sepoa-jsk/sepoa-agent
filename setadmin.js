require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [r] = await c.query("UPDATE sq_users SET role='ADMIN' WHERE email='jsk@sepoasoft.co.kr'");
  console.log('업데이트:', r.affectedRows, '건');
  const [u] = await c.query("SELECT id, email, role FROM sq_users");
  console.table(u);
  await c.end();
})().catch(e => console.error(e.message));
