require('dotenv').config({ path: './quote/.env' });
const fs = require('fs');
const mysql = require('mysql2/promise');

(async () => {
  const file = process.argv[2] || 'quote/sql/020_master_schema.sql';
  let sql = fs.readFileSync(file, 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    multipleStatements: true,
  });

  // DELIMITER 블록 처리: // 로 구분된 프로시저를 분리 실행
  // 1) DELIMITER // ~ DELIMITER ; 구간 추출
  const parts = sql.split(/DELIMITER\s+\/\/|DELIMITER\s+;/);
  // parts[0]=일반SQL, parts[1]=프로시저(//구분), parts[2]=이후 일반SQL ...
  try {
    // 일반 구간(세미콜론)
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i].trim();
      if (!chunk) continue;
      if (i % 2 === 1) {
        // 프로시저 구간: // 로 분리
        for (const stmt of chunk.split('//').map(s=>s.trim()).filter(Boolean)) {
          await conn.query(stmt);
        }
      } else {
        // 일반 구간: 통째 실행 (multipleStatements)
        await conn.query(chunk);
      }
    }
    console.log('스키마 적용 완료:', file);

    // 검증: 신규 테이블 확인
    const [t] = await conn.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('sq_service_types','sq_modules','sq_labor_roles','sq_thirdparty','sq_labor_rates')"
    );
    console.log('신규 테이블:', t.map(r=>r.TABLE_NAME).join(', '));

    const [c] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sq_price_items' AND COLUMN_NAME IN ('block','module_code','labor_role_code','thirdparty_code','service_type')"
    );
    console.log('price_items 추가컬럼:', c.map(r=>r.COLUMN_NAME).join(', '));
  } catch (e) {
    console.error('실패:', e.code, '-', e.sqlMessage || e.message);
  }
  await conn.end();
})().catch(e => console.error(e.message));