'use strict';
// 시드 로더: seed/pricing-seed.json → sq_ 테이블 투입.
// 재실행 안전: 기존 가격정책 데이터가 있으면 skip. --force 시 기존 데이터 삭제 후 재투입.
// 사용: node seed/seed.js [--force]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const FORCE = process.argv.includes('--force');
const SEED_FILE = path.join(__dirname, 'pricing-seed.json');

// PLAN.md 2번 — 공급자 정보(하드코딩 금지, settings로 관리)
const SUPPLIER_SETTINGS = {
  supplier_name: '세포아소프트(주)',
  supplier_biz_no: '119-81-95026',
  supplier_ceo: '이희림',
  supplier_address: '서울특별시 구로구 디지털로31길 62, 아티스포럼 714~717호',
  seal_image_path: 'assets/seal.png',
};

function n(v) {
  return v === undefined ? null : v;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM sq_price_items');
    if (cnt > 0 && !FORCE) {
      console.log(`이미 가격정책 데이터가 존재합니다 (품목 ${cnt}건). 재투입하려면 --force 옵션을 사용하세요.`);
      return;
    }

    await conn.beginTransaction();

    if (FORCE) {
      console.log('--force: 기존 가격정책 데이터를 삭제합니다.');
      // variants는 items FK CASCADE로 함께 삭제됨
      await conn.query('DELETE FROM sq_price_items');
      await conn.query('DELETE FROM sq_company_classes');
      await conn.query('DELETE FROM sq_deployments');
      await conn.query('DELETE FROM sq_solutions');
    }

    // 1) 솔루션
    for (const s of seed.solutions) {
      await conn.query(
        'INSERT INTO sq_solutions (code, name, source) VALUES (?, ?, ?)',
        [s.code, s.name, n(s.source)]
      );
    }

    // 2) 배포형태
    for (const d of seed.deployments) {
      await conn.query('INSERT INTO sq_deployments (code, name) VALUES (?, ?)', [d.code, d.name]);
    }

    // 3) 기업구분 (키: "SOLUTION.DEPLOYMENT")
    let ccCount = 0;
    for (const [combo, classes] of Object.entries(seed.companyClasses)) {
      const [solution, deployment] = combo.split('.');
      for (let i = 0; i < classes.length; i++) {
        const c = classes[i];
        await conn.query(
          'INSERT INTO sq_company_classes (solution, deployment, `key`, label, sort) VALUES (?, ?, ?, ?, ?)',
          [solution, deployment, c.key, c.label, i]
        );
        ccCount++;
      }
    }

    // 4) 가격 품목 + 변형
    let itemCount = 0;
    let variantCount = 0;
    for (let i = 0; i < seed.items.length; i++) {
      const it = seed.items[i];
      const [res] = await conn.query(
        `INSERT INTO sq_price_items
          (solution, deployment, category, code, name, spec, pricing_type,
           base_price, unit, qty_default, required, recurring, note, active, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          it.solution, it.deployment, n(it.category), it.code, it.name, n(it.spec),
          it.pricing_type, it.base_price ?? 0, n(it.unit), it.qty_default ?? 1,
          it.required ?? 0, it.recurring ?? 0, n(it.note), i,
        ]
      );
      const itemId = res.insertId;
      itemCount++;

      const variants = it.variants || [];
      for (let j = 0; j < variants.length; j++) {
        const v = variants[j];
        await conn.query(
          `INSERT INTO sq_price_variants
            (item_id, \`key\`, label, min_qty, max_qty, rate, price, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [itemId, n(v.key), n(v.label), n(v.min_qty), n(v.max_qty), n(v.rate), n(v.price), j]
        );
        variantCount++;
      }
    }

    // 5) 설정(공급자 정보) — 이미 있으면 유지, 없으면 생성
    for (const [k, val] of Object.entries(SUPPLIER_SETTINGS)) {
      await conn.query(
        'INSERT INTO sq_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = value',
        [k, val]
      );
    }

    await conn.commit();

    console.log('시드 투입 완료:');
    console.log(`  - 솔루션        ${seed.solutions.length}`);
    console.log(`  - 배포형태      ${seed.deployments.length}`);
    console.log(`  - 기업구분      ${ccCount}`);
    console.log(`  - 가격품목      ${itemCount}`);
    console.log(`  - 가격변형      ${variantCount}`);

    // 검증: 솔루션×배포형태별 품목 수 집계
    const [agg] = await conn.query(
      `SELECT solution, deployment, COUNT(*) AS items
         FROM sq_price_items
        GROUP BY solution, deployment
        ORDER BY solution, deployment`
    );
    console.log('\n[검증] 솔루션 × 배포형태별 품목 수');
    console.log('  solution  deployment  items');
    for (const r of agg) {
      console.log(`  ${r.solution.padEnd(9)} ${r.deployment.padEnd(11)} ${r.items}`);
    }
    const total = agg.reduce((s, r) => s + r.items, 0);
    console.log(`  총 품목 수: ${total}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('시드 실패:', err.message);
  process.exit(1);
});
