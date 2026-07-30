'use strict';
// 임금단가(개발인건비) 전용 관리 API — 연도별 이력 + active 지정 + 연도 복제.
// 마운트: /api/labor-rates
const express = require('express');
const { query, pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();

const RATE_COLS = ['role_name', 'grade', 'wage_md', 'wage_mm', 'overhead', 'tech_fee', 'apply_price', 'note'];

// ── 연도 목록 (active 표시 + 라인 수) ─────────────────────────
router.get('/years', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT y.id, y.\`year\`, y.source, y.active,
              (SELECT COUNT(*) FROM sq_labor_rate_lines r WHERE r.year_id = y.id) AS rate_count
         FROM sq_labor_rate_years y
        ORDER BY y.\`year\` DESC`
    );
    res.json({ years: rows });
  } catch (err) { next(err); }
});

// ── 특정 연도 단가 목록 (year 미지정 시 active 연도) ──────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    let yearRow;
    if (req.query.year) {
      [yearRow] = await query('SELECT * FROM sq_labor_rate_years WHERE `year` = ?', [Number(req.query.year)]);
    } else {
      [yearRow] = await query('SELECT * FROM sq_labor_rate_years WHERE active = 1 LIMIT 1');
      if (!yearRow) [yearRow] = await query('SELECT * FROM sq_labor_rate_years ORDER BY `year` DESC LIMIT 1');
    }
    if (!yearRow) return res.json({ year: null, rates: [] });
    const rates = await query('SELECT * FROM sq_labor_rate_lines WHERE year_id = ? ORDER BY sort, id', [yearRow.id]);
    res.json({ year: yearRow.year, year_id: yearRow.id, source: yearRow.source, active: yearRow.active, rates });
  } catch (err) { next(err); }
});

// ── (ADMIN) 새 연도 생성 — clone_from_year 주면 그 연도 단가 복제 ─
router.post('/years', requireAdmin, async (req, res, next) => {
  const year = Number(req.body.year);
  const source = req.body.source ?? null;
  const cloneFrom = req.body.clone_from_year ? Number(req.body.clone_from_year) : null;
  if (!year || year < 2000 || year > 2100) return res.status(400).json({ error: 'INVALID_YEAR', message: '연도가 올바르지 않습니다.' });
  const conn = await pool.getConnection();
  try {
    const [dup] = await conn.execute('SELECT id FROM sq_labor_rate_years WHERE `year` = ?', [year]);
    if (dup.length) { conn.release(); return res.status(409).json({ error: 'DUPLICATE_YEAR', message: `${year}년은 이미 존재합니다.` }); }

    await conn.beginTransaction();
    const [ins] = await conn.execute('INSERT INTO sq_labor_rate_years (`year`, source, active) VALUES (?, ?, 0)', [year, source]);
    const newId = ins.insertId;
    let cloned = 0;
    if (cloneFrom) {
      const [src] = await conn.execute('SELECT id FROM sq_labor_rate_years WHERE `year` = ?', [cloneFrom]);
      if (src.length) {
        const [r] = await conn.execute(
          `INSERT INTO sq_labor_rate_lines (year_id, role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note, sort)
             SELECT ?, role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note, sort
               FROM sq_labor_rate_lines WHERE year_id = ?`,
          [newId, src[0].id]
        );
        cloned = r.affectedRows;
      }
    }
    await conn.commit();
    res.status(201).json({ id: newId, year, cloned });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ── (ADMIN) 단가 라인 수정 ────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const sets = [], vals = [];
    for (const c of RATE_COLS) {
      if (c in req.body) { sets.push(`\`${c}\` = ?`); vals.push(req.body[c] === '' ? null : req.body[c]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'NO_FIELDS', message: '수정할 항목이 없습니다.' });
    vals.push(id);
    const r = await query(`UPDATE sq_labor_rate_lines SET ${sets.join(', ')} WHERE id = ?`, vals);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    const [row] = await query('SELECT * FROM sq_labor_rate_lines WHERE id = ?', [id]);
    res.json({ rate: row });
  } catch (err) { next(err); }
});

// ── (ADMIN) 활성 연도 지정 (나머지 해제) ──────────────────────
router.patch('/years/:id/active', requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    const [exist] = await conn.execute('SELECT id FROM sq_labor_rate_years WHERE id = ?', [id]);
    if (!exist.length) { conn.release(); return res.status(404).json({ error: 'NOT_FOUND' }); }
    await conn.beginTransaction();
    await conn.execute('UPDATE sq_labor_rate_years SET active = 0');
    await conn.execute('UPDATE sq_labor_rate_years SET active = 1 WHERE id = ?', [id]);
    await conn.commit();
    res.json({ ok: true, active_id: id });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
