require('dotenv').config({ path: './quote/.env' });
const mysql = require('mysql2/promise');
const { calcLine } = require('./quote/lib/quote-engine');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  let pass = 0, fail = 0;

  // 공통 헬퍼: 품목 code + 옵션(companyClass, qty)으로 계산해 기대값과 비교
  async function check(label, code, opts, expect) {
    const [[it]] = await conn.query('SELECT * FROM sq_price_items WHERE code=?', [code]);
    if (!it) { console.log(`${label}: 품목없음(${code}) FAIL`); fail++; return; }
    const [vs] = await conn.query('SELECT * FROM sq_price_variants WHERE item_id=?', [it.id]);
    const r = calcLine(it, vs, { months: 1, ...opts });
    const ok = r.amount === expect;
    console.log(`${label}: ${r.amount.toLocaleString()} ${ok ? 'OK' : `FAIL(기대 ${expect.toLocaleString()})`} ${r.bandLabel||''}`);
    ok ? pass++ : fail++;
  }

  console.log('── 온프레미스 ──');
  // PM(MM) 대기업상주 → 25,000,000×0.70×1
  await check('PM ENT_R', 'PRO_ONP_PM', { companyClass:'ENT_R', qty: 1 }, 17500000);
  // Poa Sourcing(DISCOUNT) 대기업상주
  await check('Sourcing ENT_R', 'PRO_ONP_SOURCING', { companyClass:'ENT_R', qty: 1 }, 50000000);
  // 컨설턴트(PI, MM) 대기업상주 → 25,000,000×0.70×0.2
  await check('PI ENT_R', 'PRO_ONP_PI', { companyClass:'ENT_R', qty: 0.2 }, 3500000);
  // 중견#1 솔루션(DISCOUNT)
  await check('Sourcing MID1', 'PRO_ONP_SOURCING', { companyClass:'MID1', qty: 1 }, 30000000);
  // PKI툴킷(FIXED)
  await check('PKI FIXED', 'PRO_ONP_PKI', { companyClass:'ENT_R', qty: 1 }, 10000000);

  console.log('── SaaS (BAND) ──');
  await check('S2C 1명',  'PRO_SAAS_S2C', { qty: 1 },  500000);
  await check('S2C 2명',  'PRO_SAAS_S2C', { qty: 2 },  500000);   // 사용자 확정값
  await check('S2C 7명',  'PRO_SAAS_S2C', { qty: 7 },  1500000);  // 6~10 구간
  await check('S2P 25명', 'PRO_SAAS_S2P', { qty: 25 }, 3000000);  // 21~30 구간
  await check('P2P 50명', 'PRO_SAAS_P2P', { qty: 50 }, 3000000);  // 41~50 구간
  await check('Sourcing 30명', 'PRO_SAAS_SOURCING', { qty: 30 }, 3000000); // 26+ 구간

  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
  await conn.end();
})().catch(e => console.error(e.message));