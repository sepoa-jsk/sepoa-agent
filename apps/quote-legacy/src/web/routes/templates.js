'use strict';
// 블록/견적조건/템플릿 조회 + 템플릿 관리(ADMIN). 마운트: /api
const express = require('express');
const { query, pool } = require('../../infra/db');
const { requireAuth, requireAdmin } = require('../../infra/auth');

const router = express.Router();

function parseCols(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

// ── 블록 정의 목록 ────────────────────────────────────────────
router.get('/blocks', requireAuth, async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM sq_blocks ORDER BY sort, code');
    res.json({ blocks: rows.map((b) => ({ ...b, columns: parseCols(b.columns) })) });
  } catch (err) { next(err); }
});

// ── 견적조건 세트(+라인) 목록 ─────────────────────────────────
router.get('/conditions', requireAuth, async (req, res, next) => {
  try {
    const sets = await query('SELECT * FROM sq_condition_sets ORDER BY code');
    const lines = await query('SELECT set_code, line_no, `text` FROM sq_condition_lines ORDER BY set_code, line_no');
    const bySet = {};
    for (const l of lines) (bySet[l.set_code] = bySet[l.set_code] || []).push(l.text);
    res.json({ conditions: sets.map((s) => ({ ...s, lines: bySet[s.code] || [] })) });
  } catch (err) { next(err); }
});

// ── 템플릿 목록 (quote_type / solution / active 필터) ─────────
router.get('/templates', requireAuth, async (req, res, next) => {
  try {
    const conds = [], params = [];
    if (req.query.quote_type) { conds.push('quote_type = ?'); params.push(req.query.quote_type); }
    if (req.query.solution) { conds.push('solution = ?'); params.push(req.query.solution); }
    if (req.query.active !== undefined) { conds.push('active = ?'); params.push(Number(req.query.active) ? 1 : 0); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(
      `SELECT t.*, (SELECT GROUP_CONCAT(tb.block_code ORDER BY tb.sort) FROM sq_template_blocks tb WHERE tb.template_id = t.id) AS block_codes
         FROM sq_quote_templates t ${where} ORDER BY t.quote_type, t.solution, t.sort, t.id`, params);
    res.json({ templates: rows.map((t) => ({ ...t, block_codes: t.block_codes ? t.block_codes.split(',') : [] })) });
  } catch (err) { next(err); }
});

// ── 템플릿 상세 (블록/기본모듈/인건비/조건) ───────────────────
router.get('/templates/:code', requireAuth, async (req, res, next) => {
  try {
    const [tpl] = await query('SELECT * FROM sq_quote_templates WHERE code = ?', [req.params.code]);
    if (!tpl) return res.status(404).json({ error: 'NOT_FOUND' });
    const blocks = await query(
      `SELECT tb.block_code, tb.sort, b.name, b.\`columns\`, b.calc, b.has_subtotal, b.recurring, b.optional
         FROM sq_template_blocks tb JOIN sq_blocks b ON b.code = tb.block_code
        WHERE tb.template_id = ? ORDER BY tb.sort`, [tpl.id]);
    // 기본모듈은 price_items 소프트 참조 — 마스터에 없는 코드도 그대로 보여주고 registered=false 로 표시한다
    const items = await query(
      `SELECT ti.block_code, ti.item_code, ti.qty_default, ti.sort,
              p.name AS item_name, p.base_price, p.recurring, p.unit,
              (p.code IS NOT NULL) AS registered
         FROM sq_template_items ti
         LEFT JOIN sq_price_items p ON p.code = ti.item_code
        WHERE ti.template_id = ? ORDER BY ti.block_code, ti.sort`, [tpl.id]);
    // 인건비 기본단가는 active 연도 임금단가에서 끌어온다(스냅샷은 견적 저장 시점에)
    const labor = await query(
      `SELECT tl.block_code, tl.role_code, tl.role_label, tl.grade, tl.task, tl.mm_default, tl.sort,
              r.role_name, r.apply_price AS base_price
         FROM sq_template_labor tl
         LEFT JOIN sq_labor_rate_lines r
           ON r.role_code = tl.role_code
          AND r.year_id = (SELECT id FROM sq_labor_rate_years WHERE active = 1 LIMIT 1)
        WHERE tl.template_id = ? ORDER BY tl.sort`, [tpl.id]);
    let conditions = [];
    if (tpl.condition_set) conditions = (await query('SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no', [tpl.condition_set])).map((r) => r.text);
    const itemsByBlock = {}, laborByBlock = {};
    for (const it of items) (itemsByBlock[it.block_code] = itemsByBlock[it.block_code] || []).push({ ...it, registered: !!it.registered });
    for (const l of labor) (laborByBlock[l.block_code] = laborByBlock[l.block_code] || []).push(l);
    res.json({
      template: tpl,
      blocks: blocks.map((b) => ({ ...b, columns: parseCols(b.columns) })),
      items: itemsByBlock,
      labor,          // 하위호환(평면 목록)
      laborByBlock,   // 블록별(LABOR / SETUP)
      conditions,
      unregistered: items.filter((i) => !i.registered).map((i) => i.item_code),
    });
  } catch (err) { next(err); }
});

// ── (ADMIN) 템플릿 생성/수정 — 헤더 + 블록/모듈/인건비 통째 교체 ─
async function writeTemplate(conn, id, body) {
  const cols = ['quote_type', 'solution', 'code', 'name', 'deployment', 'brand', 'include_maintenance',
    'include_component', 'condition_set', 'has_labor_plan', 'active', 'sort'];
  const DEFAULTS = { quote_type: 'BUILD', has_labor_plan: 0, include_maintenance: 0, include_component: 0, active: 1, sort: 0 };
  const vals = cols.map((c) => (body[c] === undefined ? (DEFAULTS[c] ?? null) : body[c]));
  let tid = id;
  if (id) {
    await conn.execute(
      `UPDATE sq_quote_templates SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
      [...vals, id]
    );
    await conn.execute('DELETE FROM sq_template_blocks WHERE template_id = ?', [id]);
    await conn.execute('DELETE FROM sq_template_items WHERE template_id = ?', [id]);
    await conn.execute('DELETE FROM sq_template_labor WHERE template_id = ?', [id]);
  } else {
    const [ins] = await conn.execute(
      `INSERT INTO sq_quote_templates (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      vals
    );
    tid = ins.insertId;
  }
  const blocks = body.blocks || [];
  for (let i = 0; i < blocks.length; i++) await conn.execute('INSERT INTO sq_template_blocks (template_id, block_code, sort) VALUES (?, ?, ?)', [tid, blocks[i], i]);
  const items = body.items || [];
  for (let i = 0; i < items.length; i++) { const it = items[i]; await conn.execute('INSERT INTO sq_template_items (template_id, block_code, item_code, qty_default, sort) VALUES (?, ?, ?, ?, ?)', [tid, it.block_code, it.item_code, it.qty_default ?? 1, i]); }
  const labor = body.labor || [];
  for (let i = 0; i < labor.length; i++) {
    const l = labor[i];
    await conn.execute(
      'INSERT INTO sq_template_labor (template_id, block_code, role_code, role_label, grade, task, mm_default, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [tid, l.block_code || 'LABOR', l.role_code, l.role_label ?? null, l.grade ?? null, l.task ?? null, l.mm_default ?? 0, i]);
  }
  return tid;
}

router.post('/templates', requireAdmin, async (req, res, next) => {
  if (!req.body.code || !req.body.solution || !req.body.name) return res.status(400).json({ error: 'MISSING', message: 'code/solution/name 은 필수입니다.' });
  const conn = await pool.getConnection();
  try {
    const [dup] = await conn.execute('SELECT id FROM sq_quote_templates WHERE code = ?', [req.body.code]);
    if (dup.length) { conn.release(); return res.status(409).json({ error: 'DUPLICATE_CODE', message: `${req.body.code} 는 이미 존재합니다.` }); }
    await conn.beginTransaction();
    const tid = await writeTemplate(conn, null, req.body);
    await conn.commit();
    res.status(201).json({ id: tid, code: req.body.code });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
});

router.put('/templates/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    const [ex] = await conn.execute('SELECT id FROM sq_quote_templates WHERE id = ?', [id]);
    if (!ex.length) { conn.release(); return res.status(404).json({ error: 'NOT_FOUND' }); }
    await conn.beginTransaction();
    await writeTemplate(conn, id, req.body);
    await conn.commit();
    res.json({ ok: true, id });
  } catch (err) { await conn.rollback(); next(err); } finally { conn.release(); }
});

module.exports = router;
