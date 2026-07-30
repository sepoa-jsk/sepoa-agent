'use strict';
// 블록/견적조건/템플릿 조회 + 템플릿 관리(ADMIN). 마운트: /api
const express = require('express');
const { query, pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');

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

// ── 템플릿 목록 (solution 필터) ───────────────────────────────
router.get('/templates', requireAuth, async (req, res, next) => {
  try {
    const conds = [], params = [];
    if (req.query.solution) { conds.push('solution = ?'); params.push(req.query.solution); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`SELECT * FROM sq_quote_templates ${where} ORDER BY solution, sort, id`, params);
    res.json({ templates: rows });
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
    const items = await query('SELECT block_code, item_code, qty_default, sort FROM sq_template_items WHERE template_id = ? ORDER BY block_code, sort', [tpl.id]);
    const labor = await query('SELECT role_code, label, task, mm_default, sort FROM sq_template_labor WHERE template_id = ? ORDER BY sort', [tpl.id]);
    let conditions = [];
    if (tpl.condition_set) conditions = (await query('SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no', [tpl.condition_set])).map((r) => r.text);
    const itemsByBlock = {};
    for (const it of items) (itemsByBlock[it.block_code] = itemsByBlock[it.block_code] || []).push(it);
    res.json({
      template: tpl,
      blocks: blocks.map((b) => ({ ...b, columns: parseCols(b.columns) })),
      items: itemsByBlock,
      labor,
      conditions,
    });
  } catch (err) { next(err); }
});

// ── (ADMIN) 템플릿 생성/수정 — 헤더 + 블록/모듈/인건비 통째 교체 ─
async function writeTemplate(conn, id, body) {
  const cols = ['solution', 'code', 'name', 'deployment', 'brand', 'include_maintenance', 'include_component', 'condition_set', 'active', 'sort'];
  const vals = cols.map((c) => (body[c] === undefined ? null : body[c]));
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
  for (let i = 0; i < labor.length; i++) { const l = labor[i]; await conn.execute('INSERT INTO sq_template_labor (template_id, role_code, label, task, mm_default, sort) VALUES (?, ?, ?, ?, ?, ?)', [tid, l.role_code, l.label ?? null, l.task ?? null, l.mm_default ?? 0, i]); }
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
