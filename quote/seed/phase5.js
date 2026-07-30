'use strict';
// Phase 5 공통 마스터 시드 로더.
//   labor-rates-seed.json  → sq_labor_rate_years / sq_labor_rate_lines
//   templates-seed.json     → sq_blocks (blocks_master), sq_condition_sets/lines (condition_sets)
// 재실행 안전: 이미 임금단가 연도 데이터가 있으면 skip. --force 시 공통 마스터 삭제 후 재투입.
// 사용: node seed/phase5.js [--force]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const FORCE = process.argv.includes('--force');
const laborSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'labor-rates-seed.json'), 'utf8'));
const tplSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'templates-seed.json'), 'utf8'));

const n = (v) => (v === undefined ? null : v);

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM sq_labor_rate_years');
    if (cnt > 0 && !FORCE) {
      console.log(`이미 Phase5 공통 마스터가 존재합니다 (임금단가 연도 ${cnt}건). 재투입하려면 --force 를 사용하세요.`);
      return;
    }

    await conn.beginTransaction();

    if (FORCE) {
      console.log('--force: 기존 Phase5 공통 마스터를 삭제합니다.');
      // rates/lines 는 FK CASCADE 로 함께 삭제됨
      await conn.query('DELETE FROM sq_labor_rate_years');
      await conn.query('DELETE FROM sq_condition_sets');
      await conn.query('DELETE FROM sq_blocks');
    }

    // 1) 임금단가 연도 + 라인
    let yearCnt = 0, rateCnt = 0;
    for (const y of laborSeed.labor_rate_years) {
      const [r] = await conn.query(
        'INSERT INTO sq_labor_rate_years (`year`, source, active) VALUES (?, ?, ?)',
        [y.year, n(y.source), y.active ? 1 : 0]
      );
      const yearId = r.insertId;
      yearCnt++;
      const rates = y.rates || [];
      for (let i = 0; i < rates.length; i++) {
        const it = rates[i];
        await conn.query(
          `INSERT INTO sq_labor_rate_lines
            (year_id, role_code, role_name, grade, wage_md, wage_mm, apply_price, note, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [yearId, it.role_code, it.role_name, n(it.grade), n(it.wage_md), n(it.wage_mm), n(it.apply_price), n(it.note), i]
        );
        rateCnt++;
      }
    }

    // 2) 블록 정의 (blocks_master)
    let blockCnt = 0;
    const blocks = tplSeed.blocks_master || [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      await conn.query(
        `INSERT INTO sq_blocks (code, name, \`columns\`, calc, has_subtotal, recurring, optional, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.code, b.name, JSON.stringify(b.columns || []), n(b.calc), b.has_subtotal ?? 1, b.recurring ?? 0, b.optional ?? 0, i]
      );
      blockCnt++;
    }

    // 3) 견적조건 세트 + 라인 (condition_sets)
    let setCnt = 0, lineCnt = 0;
    const sets = tplSeed.condition_sets || [];
    for (const s of sets) {
      await conn.query('INSERT INTO sq_condition_sets (code, name) VALUES (?, ?)', [s.code, s.name]);
      setCnt++;
      const lines = s.lines || [];
      for (let i = 0; i < lines.length; i++) {
        await conn.query('INSERT INTO sq_condition_lines (set_code, line_no, `text`) VALUES (?, ?, ?)', [s.code, i + 1, lines[i]]);
        lineCnt++;
      }
    }

    await conn.commit();

    console.log('Phase5 공통 마스터 시드 완료:');
    console.log(`  - 임금단가 연도   ${yearCnt} (라인 ${rateCnt})`);
    console.log(`  - 블록 정의       ${blockCnt}`);
    console.log(`  - 견적조건 세트   ${setCnt} (라인 ${lineCnt})`);

    const [[{ ay }]] = await conn.query('SELECT `year` AS ay FROM sq_labor_rate_years WHERE active=1 LIMIT 1');
    console.log(`  - 활성 연도       ${ay ?? '(없음)'}`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Phase5 시드 실패:', err.message);
  process.exit(1);
});
