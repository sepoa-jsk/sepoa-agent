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

function parseCols(v) { if (v == null) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } }

// ── 템플릿 적용: 블록/기본모듈/인건비 기본이 채워진 견적 초안 반환(미저장) ─
// 각 라인에 기준단가(base_price) 프리필: 모듈=price_items 정가, 인건비=active 연도 apply_price.
// 제안단가(proposed_price)는 null(사용자 네고 입력). 계산은 클라이언트가 수행.
router.post('/apply-template', requireAuth, async (req, res, next) => {
  try {
    const code = req.body.template_code;
    const [tpl] = await query('SELECT * FROM sq_quote_templates WHERE code = ?', [code]);
    if (!tpl) return res.status(404).json({ error: 'NOT_FOUND', message: '템플릿을 찾을 수 없습니다.' });

    const blocks = await query(
      `SELECT tb.block_code, tb.sort, b.name, b.\`columns\`, b.recurring, b.optional, b.has_subtotal
         FROM sq_template_blocks tb JOIN sq_blocks b ON b.code = tb.block_code
        WHERE tb.template_id = ? ORDER BY tb.sort`, [tpl.id]);
    const titems = await query('SELECT block_code, item_code, qty_default FROM sq_template_items WHERE template_id = ? ORDER BY block_code, sort', [tpl.id]);
    const tlabor = await query('SELECT role_code, label, task, mm_default FROM sq_template_labor WHERE template_id = ? ORDER BY sort', [tpl.id]);

    // 모듈 정가 조회
    const codes = [...new Set(titems.map((t) => t.item_code))];
    const priceMap = new Map();
    if (codes.length) {
      const ph = codes.map(() => '?').join(',');
      const pis = await query(`SELECT code, name, spec, base_price, unit, recurring FROM sq_price_items WHERE code IN (${ph})`, codes);
      for (const p of pis) priceMap.set(p.code, p);
    }
    // 활성 연도 인건비 기준단가(apply_price)
    const [ly] = await query('SELECT id, `year` FROM sq_labor_rate_years WHERE active = 1 LIMIT 1');
    const laborMap = new Map();
    if (ly) {
      const rl = await query('SELECT role_code, role_name, apply_price FROM sq_labor_rate_lines WHERE year_id = ?', [ly.id]);
      for (const r of rl) laborMap.set(r.role_code, r);
    }

    const draftBlocks = blocks.map((b) => {
      const out = { block_code: b.block_code, name: b.name, columns: parseCols(b.columns), recurring: !!b.recurring, optional: !!b.optional, has_subtotal: !!b.has_subtotal };
      if (b.block_code === 'LABOR') {
        out.labor = tlabor.map((l) => {
          const r = laborMap.get(l.role_code) || {};
          return { role_code: l.role_code, role_name: r.role_name || l.label || l.role_code, label: l.label || '', task: l.task || '', mm: Number(l.mm_default) || 0, base_price: r.apply_price != null ? Number(r.apply_price) : null, proposed_price: null, amount: 0 };
        });
      } else {
        out.items = titems.filter((t) => t.block_code === b.block_code).map((t) => {
          const p = priceMap.get(t.item_code) || {};
          return { item_code: t.item_code, name: p.name || t.item_code, spec: p.spec || null, qty: Number(t.qty_default) || 1, base_price: p.base_price != null ? Number(p.base_price) : null, proposed_price: null, amount: 0, unit: p.unit || null, recurring: !!p.recurring };
        });
      }
      return out;
    });

    const conditions = tpl.condition_set
      ? (await query('SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no', [tpl.condition_set])).map((r) => r.text)
      : [];

    res.json({
      template: { code: tpl.code, name: tpl.name, solution: tpl.solution, deployment: tpl.deployment, brand: tpl.brand, condition_set: tpl.condition_set, include_maintenance: !!tpl.include_maintenance, include_component: !!tpl.include_component },
      blocks: draftBlocks,
      labor_year: ly ? ly.year : null,
      conditions,
    });
  } catch (err) { next(err); }
});

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
       status, memo, conditions, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      quoteNo, header.quote_date, header.valid_until ?? null,
      header.customer_name ?? null, header.customer_contact ?? null,
      calc.discount_type, calc.discount_value ?? 0,
      calc.supply_amount, calc.discount_amount, calc.vat_amount, calc.total_amount,
      header.status && STATUSES.includes(header.status) ? header.status : 'DRAFT',
      header.memo ?? null, Array.isArray(header.conditions) ? JSON.stringify(header.conditions) : null,
      createdBy ?? null,
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
          (section_id, item_code, category, name, spec, qty, unit, months, unit_price, base_price, amount, note, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sectionId, it.item_code ?? null, it.category ?? null, it.name, it.spec ?? null,
          it.qty ?? 1, it.unit ?? null, it.months ?? 1, it.unit_price ?? 0, it.base_price ?? null, it.amount ?? 0,
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
  quote.conditions = safeJson(quote.conditions); // JSON 문자열 → 배열
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
         vat_amount = ?, total_amount = ?, status = COALESCE(?, status), memo = ?, conditions = ?
       WHERE id = ?`,
      [
        body.quote_date ? String(body.quote_date).slice(0, 10) : existing[0].quote_date,
        body.valid_until ?? null, body.customer_name ?? null, body.customer_contact ?? null,
        calc.discount_type, calc.discount_value ?? 0, calc.supply_amount, calc.discount_amount,
        calc.vat_amount, calc.total_amount,
        body.status && STATUSES.includes(body.status) ? body.status : null,
        body.memo ?? null, Array.isArray(body.conditions) ? JSON.stringify(body.conditions) : null, id,
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

// 솔루션/구축형태 이름 + 인건비 기준단가·등급(SW협회 마스터 연동) + 임금단가 데이터.
// Excel·PDF 두 출력이 공유한다.
async function buildMasters(quote) {
  const [sols, deps] = await Promise.all([
    query('SELECT code, name FROM sq_solutions'),
    query('SELECT code, name FROM sq_deployments'),
  ]);
  const masters = {
    solutionNames: Object.fromEntries(sols.map((s) => [s.code, s.name])),
    deploymentNames: Object.fromEntries(deps.map((d) => [d.code, d.name])),
  };
  try {
    const { calcStandardRate } = require('../lib/labor-standard');
    const wantYear = Number(String(quote.quote_date || '').slice(0, 4)) || null;
    const yrs = await query('SELECT DISTINCT year FROM sq_labor_standards ORDER BY year DESC');
    const useYear = (wantYear && yrs.some((y) => Number(y.year) === wantYear)) ? wantYear : (yrs[0] && Number(yrs[0].year));
    const stds = useYear ? await query('SELECT * FROM sq_labor_standards WHERE year=? ORDER BY sort, id', [useYear]) : [];
    const stdByCode = Object.fromEntries(stds.map((s) => [s.role_code, s]));
    const roles = await query('SELECT code, name, standard_role_code FROM sq_labor_roles');
    const laborInfo = {};
    for (const r of roles) {
      const std = r.standard_role_code ? stdByCode[r.standard_role_code] : null;
      laborInfo[r.code] = { base: std ? calcStandardRate(std) : null, grade: std ? std.role_name : '' };
    }
    masters.laborInfo = laborInfo;
    masters.laborYear = useYear || null;
    masters.laborStandards = stds.map((s) => ({
      role_name: s.role_name,
      daily_rate: Number(s.daily_rate),
      avgMM: Math.round(Number(s.daily_rate) * Number(s.work_days || 20.5)),
      baseRate: calcStandardRate(s),
      work_days: Number(s.work_days || 20.5),
    }));
  } catch (e) {
    console.error('[quote] 임금단가 마스터 로드 실패:', e.message);
  }
  return masters;
}

// ── Excel 다운로드 ──────────────────────────────────────────
router.get('/:id/excel', requireAuth, async (req, res, next) => {
  try {
    const quote = await loadQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: 'NOT_FOUND' });
    const settings = await loadSettings();
    const masters = await buildMasters(quote);
    const workbook = await buildQuoteWorkbook(quote, settings, masters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${quote.quote_no}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// ── PDF 다운로드 (HTML → 헤드리스 Chrome) ────────────────────
router.get('/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const { renderQuoteHtml } = require('../lib/quote-html');
    const { htmlToPdf } = require('../lib/quote-pdf');
    const quote = await loadQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: 'NOT_FOUND' });
    const settings = await loadSettings();
    const masters = await buildMasters(quote);
    const html = renderQuoteHtml(quote, settings, masters);
    const pdf = await htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(quote.quote_no)}.pdf"`);
    res.end(pdf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
