'use strict';
// 마스터 관리 라우트 — 제네릭 CRUD.
// 8개 마스터를 화이트리스트(TABLES)로 정의하고 공통 핸들러로 처리.
const express = require('express');
const { query, pool } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');

const router = express.Router();

// 테이블별 메타: 실제 테이블명 + 편집 가능 컬럼 + 정렬기준 + PK유형
// pk: 'id' = AUTO_INCREMENT 정수, 'code' = 문자열 PK(solutions/deployments)
const TABLES = {
  solutions: {
    table: 'sq_solutions', pk: 'code', order: 'code',
    cols: ['code', 'name', 'source'],
  },
  deployments: {
    table: 'sq_deployments', pk: 'code', order: 'code',
    cols: ['code', 'name'],
  },
  company_classes: {
    table: 'sq_company_classes', pk: 'id', order: 'solution, deployment, sort',
    cols: ['solution', 'deployment', 'key', 'label', 'revenue_cond', 'onsite', 'active', 'sort'],
  },
  onsite_types: {
    table: 'sq_onsite_types', pk: 'code', order: 'sort',
    cols: ['code', 'name', 'sort'],
  },
  service_types: {
    table: 'sq_service_types', pk: 'id', order: 'solution, sort',
    cols: ['solution', 'code', 'name', 'user_unit', 'min_price', 'note', 'active', 'sort'],
  },
  modules: {
    table: 'sq_modules', pk: 'id', order: 'solution, sort',
    cols: ['solution', 'code', 'name', 'base_price', 'required', 'note', 'active', 'sort'],
  },
  labor_roles: {
    table: 'sq_labor_roles', pk: 'id', order: 'solution, sort',
    cols: ['solution', 'code', 'name', 'base_price', 'std_mm', 'required', 'note', 'active', 'sort', 'standard_role_code'],
  },
  labor_rates: {
    table: 'sq_labor_rates', pk: 'id', order: 'solution, sort',
    cols: ['solution', 'company_key', 'rate', 'sort'],
  },
  thirdparty: {
    table: 'sq_thirdparty', pk: 'id', order: 'solution, sort',
    cols: ['solution', 'code', 'name', 'base_price', 'list_price', 'note', 'active', 'sort'],
  },
  // 가격정책용 네고율 (기업구분 × 상주여부 조합별, target 으로 모듈/인력 구분)
  nego_rates: {
    table: 'sq_nego_rates', pk: 'id', order: 'target, company_key, onsite_key',
    cols: ['target', 'company_key', 'onsite_key', 'rate'], // solution 없음 (전 솔루션 공통)
  },
  maintenance: {
    table: 'sq_maintenance_config', pk: 'id', order: 'sort',
    cols: ['code', 'name', 'calc_type', 'rate', 'md_price', 'md_per_mm', 'tco_years', 'free_months', 'note', 'active', 'sort'],
  },
  labor_standards: {
    table: 'sq_labor_standards', pk: 'id', order: 'year DESC, sort',
    cols: ['year', 'role_code', 'role_name', 'daily_rate', 'work_days', 'overhead_rate', 'tech_rate', 'sort'],
  },
};

// 백틱 컬럼 (예약어 key 등)
const bt = (c) => '`' + c + '`';

function meta(type, res) {
  const m = TABLES[type];
  if (!m) { res.status(404).json({ error: 'UNKNOWN_MASTER', message: `알 수 없는 마스터: ${type}` }); return null; }
  return m;
}

// GET /api/master  — 전체 마스터 한 번에 (화면 초기 로드용)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const out = {};
    for (const [type, m] of Object.entries(TABLES)) {
      out[type] = await query(`SELECT * FROM ${m.table} ORDER BY ${m.order}`);
    }
    res.json(out);
  } catch (err) { next(err); }
});

// GET /api/master/:type  — 특정 마스터 목록 (solution 필터 옵션)
router.get('/:type', requireAuth, async (req, res, next) => {
  const m = meta(req.params.type, res); if (!m) return;
  try {
    const conds = [], params = [];
    if (req.query.solution && m.cols.includes('solution')) {
      conds.push('solution = ?'); params.push(req.query.solution);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(`SELECT * FROM ${m.table} ${where} ORDER BY ${m.order}`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

// POST /api/master/:type  — 생성
router.post('/:type', requireAdmin, async (req, res, next) => {
  const m = meta(req.params.type, res); if (!m) return;
  const b = req.body || {};
  const cols = m.cols.filter((c) => b[c] !== undefined);
  if (cols.length === 0) return res.status(400).json({ error: 'MISSING_FIELDS' });
  try {
    const placeholders = cols.map(() => '?').join(',');
    const vals = cols.map((c) => b[c]);
    const [r] = await pool.execute(
      `INSERT INTO ${m.table} (${cols.map(bt).join(',')}) VALUES (${placeholders})`, vals
    );
    const idCol = m.pk;
    const idVal = m.pk === 'id' ? r.insertId : b[m.pk];
    const [rows] = await pool.execute(`SELECT * FROM ${m.table} WHERE ${bt(idCol)} = ?`, [idVal]);
    res.status(201).json({ row: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'DUPLICATE', message: '중복된 키입니다.' });
    next(err);
  }
});

// PUT /api/master/:type/:id  — 수정
router.put('/:type/:id', requireAdmin, async (req, res, next) => {
  const m = meta(req.params.type, res); if (!m) return;
  const b = req.body || {};
  // pk 컬럼은 수정 대상에서 제외
  const editable = m.cols.filter((c) => c !== m.pk && b[c] !== undefined);
  if (editable.length === 0) return res.status(400).json({ error: 'NOTHING_TO_UPDATE' });
  try {
    const setClause = editable.map((c) => `${bt(c)} = ?`).join(', ');
    const params = editable.map((c) => b[c]);
    params.push(req.params.id);
    const [r] = await pool.execute(
      `UPDATE ${m.table} SET ${setClause} WHERE ${bt(m.pk)} = ?`, params
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    const [rows] = await pool.execute(`SELECT * FROM ${m.table} WHERE ${bt(m.pk)} = ?`, [req.params.id]);
    res.json({ row: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'DUPLICATE' });
    next(err);
  }
});

// DELETE /api/master/:type/:id  — 삭제 (active 컬럼 있으면 soft, 없으면 hard)
router.delete('/:type/:id', requireAdmin, async (req, res, next) => {
  const m = meta(req.params.type, res); if (!m) return;
  try {
    let r;
    if (m.cols.includes('active')) {
      [r] = await pool.execute(`UPDATE ${m.table} SET active = 0 WHERE ${bt(m.pk)} = ?`, [req.params.id]);
    } else {
      [r] = await pool.execute(`DELETE FROM ${m.table} WHERE ${bt(m.pk)} = ?`, [req.params.id]);
    }
    if (r.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;


