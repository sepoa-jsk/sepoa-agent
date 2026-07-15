require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  // 1) SAAS 행 전부 제거 (서비스구분은 sq_service_types로 이관됨)
  const [r1] = await c.query(
    "DELETE FROM sq_company_classes WHERE solution='PROCURE' AND deployment='SAAS'"
  );
  // 2) ONPREM 샘플 잔재 제거 (실제 6구분만 남김)
  const [r2] = await c.query(
    "DELETE FROM sq_company_classes WHERE solution='PROCURE' AND deployment='ONPREM' AND `key` IN ('LARGE','MID','SMALL')"
  );

  console.log('SAAS 행 삭제:', r1.affectedRows);
  console.log('ONPREM 샘플 삭제:', r2.affectedRows);

  const [rows] = await c.query(
    "SELECT `key`, label FROM sq_company_classes WHERE solution='PROCURE' AND deployment='ONPREM' ORDER BY sort"
  );
  console.log('\n남은 전자구매 온프 기업구분:');
  console.table(rows);
  await c.end();
})().catch(e => console.error(e.message));