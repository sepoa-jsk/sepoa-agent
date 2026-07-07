'use strict';
// 마스터/가격정책 라우트
const express = require('express');
const { query, pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();
const PRICING_TYPES = ['DISCOUNT', 'BAND', 'FIXED', 'MM'];

// 품목 + variants 를 묶어 반환
async function loadItemsWithVariants(where, params) {
  const items = await query(
    `SELECT * FROM sq_price_items ${where} ORDER BY sort, id`,
    params
  );
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const placeholders = ids.map(() => '?').join(',');
  const variants = await query(
    `SELECT * FROM sq_price_variants WHERE item_id IN (${placeholders}) ORDER BY sort, id`,
    ids
  );
  const byItem = new Map(ids.map((id) => [id, []]));
  for (const v of variants) byItem.get(v.item_id)?.push(v);
  return items.map((it) => ({ ...it, variants: byItem.get(it.id) || [] }));
}

// GET /api/master — 솔루션·배포형태·기업구분
router.get('/master', requireAuth, async (req, res, next) => {
  try {
    const [solutions, deployments, companyClasses] = await Promise.all([
      query('SELECT * FROM sq_solutions ORDER BY code'),
      query('SELECT * FROM sq_deployments ORDER BY code'),
      query('SELECT * FROM sq_company_classes ORDER BY solution, deployment, sort'),
    ]);
    res.json({ solutions, deployments, companyClasses });
  } catch (err) {
    next(err);
  }
});

// GET /api/pricing?solution=&deployment=&all= — 항목+variants
router.get('/pricing', requireAuth, async (req, res, next) => {
  try {
    const { solution, deployment, all } = req.query;
    const conds = [];
    const params = [];
    if (!all) {
      conds.push('active = 1');
    }
    if (solution) {
      conds.push('solution = ?');
      params.push(solution);
    }
    if (deployment) {
      conds.push('deployment = ?');
      params.push(deployment);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const items = await loadItemsWithVariants(where, params);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ── ADMIN: 품목 생성 ────────────────────────────────────────
router.post('/pricing/items', requireAdmin, async (req, res, next) => {
  const b = req.body || {};
  if (!b.code || !b.name || !b.solution || !b.deployment || !b.pricing_type) {
    return res.status(400).json({ error: 'MISSING_FIELDS', message: 'solution, deployment, code, name, pricing_type는 필수입니다.' });
  }
  if (!PRICING_TYPES.includes(b.pricing_type)) {
    return res.status(400).json({ error: 'INVALID_PRICING_TYPE', message: `pricing_type은 ${PRICING_TYPES.join('/')} 중 하나여야 합니다.` });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `INSERT INTO sq_price_items
        (solution, deployment, category, code, name, spec, pricing_type,
         base_price, unit, qty_default, required, recurring, note, active, sort)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.solution, b.deployment, b.category ?? null, b.code, b.name, b.spec ?? null,
        b.pricing_type, b.base_price ?? 0, b.unit ?? null, b.qty_default ?? 1,
        b.required ?? 0, b.recurring ?? 0, b.note ?? null, b.active ?? 1, b.sort ?? 0,
      ]
    );
    const itemId = r.insertId;
    await replaceVariants(conn, itemId, b.variants);
    await conn.commit();
    const [items] = await conn.execute('SELECT * FROM sq_price_items WHERE id = ?', [itemId]);
    res.status(201).json({ item: items[0] });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'DUPLICATE_CODE', message: '이미 존재하는 품목 코드입니다.' });
    }
    next(err);
  } finally {
    conn.release();
  }
});

// ── ADMIN: 품목 수정 ────────────────────────────────────────
router.put('/pricing/items/:id', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const fields = [];
  const params = [];
  const allowed = ['solution', 'deployment', 'category', 'name', 'spec', 'pricing_type',
    'base_price', 'unit', 'qty_default', 'required', 'recurring', 'note', 'active', 'sort'];
  for (const f of allowed) {
    if (b[f] !== undefined) {
      if (f === 'pricing_type' && !PRICING_TYPES.includes(b[f])) {
        return res.status(400).json({ error: 'INVALID_PRICING_TYPE' });
      }
      fields.push(`${f} = ?`);
      params.push(b[f]);
    }
  }
  if (fields.length === 0 && b.variants === undefined) {
    return res.status(400).json({ error: 'NOTHING_TO_UPDATE' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (fields.length > 0) {
      params.push(id);
      const [r] = await conn.execute(`UPDATE sq_price_items SET ${fields.join(', ')} WHERE id = ?`, params);
      if (r.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'NOT_FOUND' });
      }
    }
    if (b.variants !== undefined) {
      await replaceVariants(conn, id, b.variants);
    }
    await conn.commit();
    const [items] = await conn.execute('SELECT * FROM sq_price_items WHERE id = ?', [id]);
    res.json({ item: items[0] });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ── ADMIN: variants 일괄 교체 ───────────────────────────────
router.put('/pricing/items/:id/variants', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const variants = req.body.variants;
  if (!Array.isArray(variants)) {
    return res.status(400).json({ error: 'INVALID_VARIANTS', message: 'variants 배열이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    const [items] = await conn.execute('SELECT id FROM sq_price_items WHERE id = ?', [id]);
    if (items.length === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    await conn.beginTransaction();
    await replaceVariants(conn, id, variants);
    await conn.commit();
    const [rows] = await conn.execute('SELECT * FROM sq_price_variants WHERE item_id = ? ORDER BY sort, id', [id]);
    res.json({ variants: rows });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ── ADMIN: 품목 soft delete ─────────────────────────────────
router.delete('/pricing/items/:id', requireAdmin, async (req, res, next) => {
  try {
    const r = await query('UPDATE sq_price_items SET active = 0 WHERE id = ?', [Number(req.params.id)]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// variants 전체 삭제 후 재삽입 (트랜잭션 커넥션 사용)
async function replaceVariants(conn, itemId, variants) {
  await conn.execute('DELETE FROM sq_price_variants WHERE item_id = ?', [itemId]);
  if (!Array.isArray(variants)) return;
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    await conn.execute(
      `INSERT INTO sq_price_variants (item_id, \`key\`, label, min_qty, max_qty, rate, price, sort)
       VALUES (?,?,?,?,?,?,?,?)`,
      [itemId, v.key ?? null, v.label ?? null, v.min_qty ?? null, v.max_qty ?? null,
       v.rate ?? null, v.price ?? null, v.sort ?? i]
    );
  }
}

module.exports = router;
