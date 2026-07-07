'use strict';
// 견적 라우트 — 계산 / CRUD(3계층) / 채번 / Excel
const express = require('express');
const { query, pool } = require('../lib/db');
const { requireAuth, apiKeyOrAuth } = require('../lib/auth');
const { calcQuote } = require('../lib/quote-service');
const { nextQuoteNo } = require('../lib/numbering');
const { buildQuoteWorkbook } = require('../lib/excel');

const router = express.Router();
const STATUSES = ['DRAFT', 'SENT', 'WON', 'LOST'];

// ── 계산 전용 (저장 안 함, 타시스템 연계) ───────────────────
router.post('/calculate', apiKeyOrAuth, async (req, res, next) => {
  try {
    if (!Array.isArray(req.body.sections) || req.body.sections.length === 0) {
      return res.status(400).json({ error: 'NO_SECTIONS', message: '최소 1개 섹션이 필요합니다.' });
    }
    const result = await calcQuote({ sections: req.body.sections, discount: req.body.discount });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── 견적 저장(공통) — 트랜잭션 커넥션에 헤더+섹션+품목 기록 ──
async function persistQuote(conn, { header, calc, quoteNo, createdBy }) {
  const [r] = await conn.execute(
    `INSERT INTO sq_quotes
      (quote_no, quote_date, valid_until, customer_name, customer_contact,
       discount_type, discount_value, supply_amount, discount_amount, vat_amount, total_amount,
       status, memo, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      quoteNo, header.quote_date, header.valid_until ?? null,
      header.customer_name ?? null, header.customer_contact ?? null,
      calc.discount_type, calc.discount_value ?? 0,
      calc.supply_amount, calc.discount_amount, calc.vat_amount, calc.total_amount,
      header.status && STATUSES.includes(header.status) ? header.status : 'DRAFT',
      header.memo ?? null, createdBy ?? null,
    ]
  );
  const quoteId = r.insertId;
  await insertSections(conn, quoteId, calc.sections);
  return quoteId;
}

async function insertSections(conn, quoteId, sections) {
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const [sr] = await conn.execute(
      `INSERT INTO sq_quote_sections
        (quote_id, solution, deployment, company_class, contract_months, params, subtotal, sort)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        quoteId, sec.solution, sec.deployment, sec.companyClass ?? null,
        sec.contract_months ?? 1, sec.params ? JSON.stringify(sec.params) : null,
        sec.subtotal, si,
      ]
    );
    const sectionId = sr.insertId;
    for (let ii = 0; ii < sec.items.length; ii++) {
      const it = sec.items[ii];
      await conn.execute(
        `INSERT INTO sq_quote_items
          (section_id, item_code, category, name, spec, qty, unit, months, unit_price, amount, note, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sectionId, it.item_code ?? null, it.category ?? null, it.name, it.spec ?? null,
          it.qty ?? 1, it.unit ?? null, it.months ?? 1, it.unit_price ?? 0, it.amount ?? 0,
          it.note ?? null, ii,
        ]
      );
    }
  }
}

// 견적 전체(헤더+섹션+품목+공급자설정) 로드
async function loadQuote(id) {
  const quotes = await query('SELECT * FROM sq_quotes WHERE id = ?', [id]);
  if (quotes.length === 0) return null;
  const quote = quotes[0];
  const sections = await query('SELECT * FROM sq_quote_sections WHERE quote_id = ? ORDER BY sort, id', [id]);
  let items = [];
  if (sections.length > 0) {
    const ids = sections.map((s) => s.id);
    const ph = ids.map(() => '?').join(',');
    items = await query(`SELECT * FROM sq_quote_items WHERE section_id IN (${ph}) ORDER BY sort, id`, ids);
  }
  const bySection = new Map(sections.map((s) => [s.id, []]));
  for (const it of items) bySection.get(it.section_id)?.push(it);
  quote.sections = sections.map((s) => ({
    ...s,
    params: s.params ? safeJson(s.params) : null,
    items: bySection.get(s.id) || [],
  }));
  return quote;
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function loadSettings() {
  const rows = await query('SELECT `key`, value FROM sq_settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ── 생성 ────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    return res.status(400).json({ error: 'NO_SECTIONS', message: '최소 1개 섹션이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    const calc = await calcQuote({ sections: body.sections, discount: body.discount });
    const quoteDate = body.quote_date ? String(body.quote_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    await conn.beginTransaction();
    const quoteNo = await nextQuoteNo(conn, quoteDate);
    const quoteId = await persistQuote(conn, {
      header: { ...body, quote_date: quoteDate },
      calc, quoteNo, createdBy: req.session.user.id,
    });
    await conn.commit();
    const quote = await loadQuote(quoteId);
    res.status(201).json({ quote });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ── 목록 ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, customer } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, Number(req.query.size) || 20));
    const conds = [];
    const params = [];
    if (status && STATUSES.includes(status)) { conds.push('status = ?'); params.push(status); }
    if (customer) { conds.push('customer_name LIKE ?'); params.push(`%${customer}%`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [{ cnt }] = await query(`SELECT COUNT(*) AS cnt FROM sq_quotes ${where}`, params);
    const rows = await query(
      `SELECT q.*, u.name AS created_by_name
         FROM sq_quotes q LEFT JOIN sq_users u ON u.id = q.created_by
         ${where} ORDER BY q.id DESC LIMIT ? OFFSET ?`,
      [...params, size, (page - 1) * size]
    );
    res.json({ total: cnt, page, size, quotes: rows });
  } catch (err) {
    next(err);
  }
});

// ── 상세 ────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const quote = await loadQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

// ── 수정 (섹션/품목 전체 교체 + 재계산, quote_no 유지) ───────
router.put('/:id', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    return res.status(400).json({ error: 'NO_SECTIONS', message: '최소 1개 섹션이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.execute('SELECT id, quote_date FROM sq_quotes WHERE id = ?', [id]);
    if (existing.length === 0) { conn.release(); return res.status(404).json({ error: 'NOT_FOUND' }); }

    const calc = await calcQuote({ sections: body.sections, discount: body.discount });
    await conn.beginTransaction();
    // 섹션 삭제(CASCADE로 품목 삭제) 후 재삽입
    await conn.execute('DELETE FROM sq_quote_sections WHERE quote_id = ?', [id]);
    await conn.execute(
      `UPDATE sq_quotes SET
         quote_date = ?, valid_until = ?, customer_name = ?, customer_contact = ?,
         discount_type = ?, discount_value = ?, supply_amount = ?, discount_amount = ?,
         vat_amount = ?, total_amount = ?, status = COALESCE(?, status), memo = ?
       WHERE id = ?`,
      [
        body.quote_date ? String(body.quote_date).slice(0, 10) : existing[0].quote_date,
        body.valid_until ?? null, body.customer_name ?? null, body.customer_contact ?? null,
        calc.discount_type, calc.discount_value ?? 0, calc.supply_amount, calc.discount_amount,
        calc.vat_amount, calc.total_amount,
        body.status && STATUSES.includes(body.status) ? body.status : null,
        body.memo ?? null, id,
      ]
    );
    await insertSections(conn, id, calc.sections);
    await conn.commit();
    const quote = await loadQuote(id);
    res.json({ quote });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ── 상태 변경 ───────────────────────────────────────────────
router.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: `status는 ${STATUSES.join('/')} 중 하나여야 합니다.` });
    }
    const r = await query('UPDATE sq_quotes SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// ── 삭제 ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await query('DELETE FROM sq_quotes WHERE id = ?', [Number(req.params.id)]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Excel 다운로드 ──────────────────────────────────────────
router.get('/:id/excel', requireAuth, async (req, res, next) => {
  try {
    const quote = await loadQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: 'NOT_FOUND' });
    const settings = await loadSettings();
    const [sols, deps] = await Promise.all([
      query('SELECT code, name FROM sq_solutions'),
      query('SELECT code, name FROM sq_deployments'),
    ]);
    const masters = {
      solutionNames: Object.fromEntries(sols.map((s) => [s.code, s.name])),
      deploymentNames: Object.fromEntries(deps.map((d) => [d.code, d.name])),
    };
    const workbook = await buildQuoteWorkbook(quote, settings, masters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${quote.quote_no}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
