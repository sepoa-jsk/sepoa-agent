'use strict';
// Phase 5 공통+템플릿 시드 로더.
//   labor-rates-seed.json  → sq_labor_rate_years / sq_labor_rate_lines
//   templates-seed.json     → sq_blocks, sq_condition_sets/lines, sq_quote_templates(+blocks/items/labor)
// 섹션별 멱등: 각 테이블이 비어 있을 때만 투입(부분 재실행 안전). --force 시 재투입.
// 사용: node seed/phase5.js [--force[=labor,blocks,conditions,templates]]
//   --force              전 섹션 재투입
//   --force=labor,blocks 지정 섹션만 재투입 (나머지는 손대지 않음)
// blocks/conditions 는 외부 FK(sq_template_blocks.block_code, sq_quote_templates.condition_set)가
// 걸려 있어 삭제 대신 UPSERT 로 갱신한다. labor/templates 는 삭제 후 재투입(CASCADE).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const SECTIONS = ['labor', 'blocks', 'conditions', 'templates'];
const forceArg = process.argv.find((a) => a === '--force' || a.startsWith('--force='));
const forced = !forceArg ? new Set()
  : new Set(forceArg.includes('=') ? forceArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : SECTIONS);
for (const s of forced) if (!SECTIONS.includes(s)) { console.error(`알 수 없는 섹션: ${s} (가능: ${SECTIONS.join(', ')})`); process.exit(1); }
const isForced = (s) => forced.has(s);
const laborSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'labor-rates-seed.json'), 'utf8'));
const tplSeed = JSON.parse(fs.readFileSync(path.join(__dirname, 'templates-seed.json'), 'utf8'));

const n = (v) => (v === undefined ? null : v);
// 블록 → 시드의 기본항목 키 매핑 (LABOR 는 labor_default 로 별도 처리)
const BLOCK_ITEM_KEY = {
  SOLUTION: 'default_items', SETUP: 'setup_default', SERVICE: 'service_default',
  DATASVC: 'datasvc_default', MAINT: 'maint_default',
};

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  const count = async (t) => (await conn.query(`SELECT COUNT(*) AS c FROM ${t}`))[0][0].c;

  try {
    await conn.beginTransaction();

    if (forced.size) console.log(`--force: 재투입 섹션 = ${[...forced].join(', ')}`);
    // 삭제형 재투입(외부 FK 없음). blocks/conditions 는 아래에서 UPSERT.
    if (isForced('templates')) await conn.query('DELETE FROM sq_quote_templates'); // blocks/items/labor CASCADE
    if (isForced('labor')) await conn.query('DELETE FROM sq_labor_rate_years');    // lines CASCADE

    const done = {};

    // 1) 임금단가 연도 + 라인
    if ((await count('sq_labor_rate_years')) === 0) {
      let y = 0, r = 0;
      for (const yr of laborSeed.labor_rate_years) {
        const [ins] = await conn.query('INSERT INTO sq_labor_rate_years (`year`, source, active) VALUES (?, ?, ?)', [yr.year, n(yr.source), yr.active ? 1 : 0]);
        y++;
        const rates = yr.rates || [];
        for (let i = 0; i < rates.length; i++) {
          const it = rates[i];
          await conn.query(
            `INSERT INTO sq_labor_rate_lines (year_id, role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note, sort)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [ins.insertId, it.role_code, it.role_name, n(it.grade), n(it.wage_md), n(it.wage_mm),
             n(it.overhead), n(it.tech_fee), n(it.apply_price), n(it.note), i]
          );
          r++;
        }
      }
      done.labor = `연도 ${y} / 라인 ${r}`;
    }

    // 2) 블록 정의 (UPSERT — sq_template_blocks.block_code FK 때문에 삭제하지 않는다)
    if ((await count('sq_blocks')) === 0 || isForced('blocks')) {
      const blocks = tplSeed.blocks_master || [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        await conn.query(
          `INSERT INTO sq_blocks (code, name, \`columns\`, calc, has_subtotal, recurring, optional, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name=VALUES(name), \`columns\`=VALUES(\`columns\`), calc=VALUES(calc),
             has_subtotal=VALUES(has_subtotal), recurring=VALUES(recurring), optional=VALUES(optional), sort=VALUES(sort)`,
          [b.code, b.name, JSON.stringify(b.columns || []), n(b.calc), b.has_subtotal ?? 1, b.recurring ?? 0, b.optional ?? 0, i]
        );
      }
      done.blocks = `${blocks.length} (upsert)`;
    }

    // 3) 견적조건 세트 + 라인 (세트 UPSERT / 라인은 해당 세트만 교체 — 템플릿 FK 보존)
    if ((await count('sq_condition_sets')) === 0 || isForced('conditions')) {
      let ln = 0;
      const sets = tplSeed.condition_sets || [];
      for (const s of sets) {
        await conn.query('INSERT INTO sq_condition_sets (code, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name)', [s.code, s.name]);
        await conn.query('DELETE FROM sq_condition_lines WHERE set_code = ?', [s.code]);
        const lines = s.lines || [];
        for (let i = 0; i < lines.length; i++) { await conn.query('INSERT INTO sq_condition_lines (set_code, line_no, `text`) VALUES (?, ?, ?)', [s.code, i + 1, lines[i]]); ln++; }
      }
      done.conditions = `세트 ${sets.length} / 라인 ${ln}`;
    }

    // 4) 템플릿 (헤더 + 블록 + 기본모듈 + 인건비 기본)
    if ((await count('sq_quote_templates')) === 0) {
      let ti = 0, tl = 0, tb = 0;
      const tpls = tplSeed.templates || [];
      for (let ix = 0; ix < tpls.length; ix++) {
        const t = tpls[ix];
        const [ins] = await conn.query(
          `INSERT INTO sq_quote_templates
            (solution, code, name, deployment, brand, include_maintenance, include_component, condition_set, active, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [t.solution, t.code, t.name, t.deployment, n(t.brand), t.include_maintenance ?? 0, t.include_component ?? 0, n(t.condition_set), t.sort ?? ix]
        );
        const tid = ins.insertId;
        const blocks = t.blocks || [];
        for (let bi = 0; bi < blocks.length; bi++) {
          const bcode = blocks[bi];
          await conn.query('INSERT INTO sq_template_blocks (template_id, block_code, sort) VALUES (?, ?, ?)', [tid, bcode, bi]); tb++;
          if (bcode === 'LABOR') continue; // 인건비는 labor_default 로
          const items = t[BLOCK_ITEM_KEY[bcode]] || [];
          for (let j = 0; j < items.length; j++) {
            await conn.query('INSERT INTO sq_template_items (template_id, block_code, item_code, qty_default, sort) VALUES (?, ?, ?, 1, ?)', [tid, bcode, items[j], j]); ti++;
          }
        }
        const labor = t.labor_default || [];
        for (let j = 0; j < labor.length; j++) {
          const l = labor[j];
          await conn.query('INSERT INTO sq_template_labor (template_id, role_code, label, task, mm_default, sort) VALUES (?, ?, ?, ?, ?, ?)', [tid, l.role_code, n(l.label), n(l.task), l.mm ?? 0, j]); tl++;
        }
      }
      done.templates = `${tpls.length} (블록 ${tb} / 모듈 ${ti} / 인건비 ${tl})`;
    }

    await conn.commit();

    console.log('Phase5 시드 완료:');
    for (const [k, v] of Object.entries(done)) console.log(`  - ${k}: ${v}`);
    if (!Object.keys(done).length) console.log('  (모든 섹션이 이미 존재 — 변경 없음. 재투입은 --force)');
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
