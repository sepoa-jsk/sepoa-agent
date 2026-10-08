'use strict';
// 견적 라우트 — 계산 / CRUD(3계층) / 채번 / Excel
const express = require('express');
const { query, pool } = require('../../infra/db');
const { requireAuth, apiKeyOrAuth } = require('../../infra/auth');
const { calcQuote, computeDiscountAmount } = require('../../domain/quote/service');
const { calcQuoteBlocks } = require('../../domain/pricing/engine');
const { nextQuoteNo, quoteNoSearchClause } = require('../../domain/quote/numbering');
const { buildQuoteWorkbook } = require('../../domain/render/excel');

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
    const tlabor = await query('SELECT block_code, role_code, role_label, grade, task, mm_default FROM sq_template_labor WHERE template_id = ? ORDER BY sort', [tpl.id]);

    // 모듈 정가 조회
    const codes = [...new Set(titems.map((t) => t.item_code))];
    const priceMap = new Map();
    if (codes.length) {
      const ph = codes.map(() => '?').join(',');
      const pis = await query(`SELECT code, name, spec, category, base_price, unit, recurring FROM sq_price_items WHERE code IN (${ph})`, codes);
      for (const p of pis) priceMap.set(p.code, p);
    }
    // 활성 연도 인건비 기준단가(apply_price)
    const [ly] = await query('SELECT id, `year` FROM sq_labor_rate_years WHERE active = 1 LIMIT 1');
    const laborMap = new Map();
    if (ly) {
      const rl = await query('SELECT role_code, role_name, apply_price FROM sq_labor_rate_lines WHERE year_id = ?', [ly.id]);
      for (const r of rl) laborMap.set(r.role_code, r);
    }

    // 블록별 모듈/인건비를 함께 채운다. SETUP 은 모듈과 인건비(MM 산정)가 동시에 붙을 수 있다.
    const draftBlocks = blocks.map((b) => {
      const out = {
        block_code: b.block_code, name: b.name, columns: parseCols(b.columns),
        recurring: !!b.recurring, optional: !!b.optional, has_subtotal: !!b.has_subtotal,
        items: [], labor: [], subtotal: 0,
      };
      out.items = titems.filter((t) => t.block_code === b.block_code).map((t) => {
        const p = priceMap.get(t.item_code) || {};
        return {
          item_code: t.item_code, category: p.category || null,
          name: p.name || t.item_code, spec: p.spec || null,
          qty: t.qty_default == null ? 1 : Number(t.qty_default),
          base_price: p.base_price != null ? Number(p.base_price) : null,
          proposed_price: null, amount: 0,
          unit: p.unit || null, recurring: !!p.recurring,
          registered: priceMap.has(t.item_code),
        };
      });
      out.labor = tlabor.filter((l) => (l.block_code || 'LABOR') === b.block_code).map((l) => {
        const r = laborMap.get(l.role_code) || {};
        return {
          role_code: l.role_code, role_name: r.role_name || l.role_code,
          role_label: l.role_label || r.role_name || l.role_code, grade: l.grade || null,
          task: l.task || '', mm: Number(l.mm_default) || 0,
          base_price: r.apply_price != null ? Number(r.apply_price) : null,
          proposed_price: null, amount: 0,
          month_alloc: tpl.has_labor_plan ? {} : null,
        };
      });
      return out;
    });

    const conditions = tpl.condition_set
      ? (await query('SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no', [tpl.condition_set])).map((r) => r.text)
      : [];

    const unregistered = [...new Set(titems.map((t) => t.item_code).filter((c) => !priceMap.has(c)))];

    res.json({
      template: {
        code: tpl.code, name: tpl.name, quote_type: tpl.quote_type || 'BUILD', solution: tpl.solution,
        deployment: tpl.deployment, brand: tpl.brand, condition_set: tpl.condition_set,
        has_labor_plan: !!tpl.has_labor_plan,
        include_maintenance: !!tpl.include_maintenance, include_component: !!tpl.include_component,
      },
      blocks: draftBlocks,
      labor_year: ly ? ly.year : null,
      round_unit: 100000,
      conditions,
      unregistered,   // 가격마스터에 없는 모듈 — 기준단가가 비어 있음을 화면에서 알린다
    });
  } catch (err) { next(err); }
});

// ── 계산 전용 (저장 안 함, 타시스템 연계) ───────────────────
// 블록형: { blocks:[...], discount, round_unit } → 소계합→특별DC→절사→VAT, 일시불/월 분리
// 레거시: { sections:[...] } → 기존 3계층 계산 경로 유지
router.post('/calculate', apiKeyOrAuth, async (req, res, next) => {
  try {
    if (Array.isArray(req.body.blocks)) {
      if (!req.body.blocks.length) return res.status(400).json({ error: 'NO_BLOCKS', message: '최소 1개 블록이 필요합니다.' });
      return res.json(calcQuoteBlocks({
        blocks: req.body.blocks,
        discount: req.body.discount,
        monthly_discount: req.body.monthly_discount,
        round_unit: req.body.round_unit ?? 100000,
      }));
    }
    if (!Array.isArray(req.body.sections) || req.body.sections.length === 0) {
      return res.status(400).json({ error: 'NO_SECTIONS', message: '최소 1개 섹션 또는 블록이 필요합니다.' });
    }
    const result = await calcFor(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── 미리보기 (저장 안 함) ────────────────────────────────────
// 위저드 STEP③ 우측 실시간 미리보기용. PDF 와 같은 renderQuoteHtml·같은 masters 를
// 쓴다. 별도 렌더러를 두면 화면과 PDF 가 반드시 어긋나므로 경로를 하나로 유지한다.
router.post('/preview', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.blocks)) return res.status(400).json({ error: 'NO_BLOCKS', message: 'blocks 가 필요합니다.' });
    const calc = calcQuoteBlocks({
      blocks: body.blocks,
      discount: body.discount,
      monthly_discount: body.monthly_discount,
      round_unit: body.round_unit ?? 100000,
    });
    // 저장 전이라 견적번호가 없다. 실제 채번은 저장 시점에 일어난다.
    const quote = {
      ...body.header,
      quote_no: body.header?.quote_no || '(저장 시 채번)',
      quote_date: body.header?.quote_date || new Date().toISOString().slice(0, 10),
      blocks: calc.blocks.map((b) => ({ ...b, title: b.name ?? b.title })),
      sections: [],
      onetime_total: calc.onetime_total, monthly_total: calc.monthly_total,
      supply_amount: calc.supply_amount, discount_amount: calc.discount_amount,
      vat_amount: calc.vat_amount, total_amount: calc.total_amount,
      round_unit: calc.round_unit,
      conditions: Array.isArray(body.header?.conditions) ? body.header.conditions : null,
    };
    const { renderQuoteHtml } = require('../../domain/render/html');
    const settings = await loadSettings();
    const masters = await buildMasters(quote);
    res.json({ html: renderQuoteHtml(quote, settings, masters, { withCover: false }), calc });
  } catch (err) { next(err); }
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
        (quote_id, solution, template_code, brand, deployment, company_class, contract_months, params, subtotal, sort)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        quoteId, sec.solution, sec.template_code ?? null, sec.brand ?? null, sec.deployment,
        sec.companyClass ?? sec.company_class ?? null,
        sec.contract_months ?? 1, sec.params ? JSON.stringify(sec.params) : null,
        sec.subtotal, si,
      ]
    );
    const sectionId = sr.insertId;
    for (let ii = 0; ii < (sec.items || []).length; ii++) {
      const it = sec.items[ii];
      // 2단가: proposed_price(제안단가)를 unit_price 와 함께 저장(unit_price=제안단가로 의미 이관)
      const proposed = it.proposed_price != null ? Math.round(Number(it.proposed_price)) : (it.unit_price != null ? Math.round(Number(it.unit_price)) : null);
      await conn.execute(
        `INSERT INTO sq_quote_items
          (section_id, item_code, block_code, category, name, spec, qty, unit, months, unit_price, base_price, proposed_price, amount, note, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          sectionId, it.item_code ?? null, it.block_code ?? null, it.category ?? null, it.name, it.spec ?? null,
          it.qty ?? 1, it.unit ?? null, it.months ?? 1, proposed ?? 0,
          it.base_price != null ? Math.round(Number(it.base_price)) : null, proposed, it.amount ?? 0,
          it.note ?? null, ii,
        ]
      );
    }
    // 인건비(LABOR) 블록 라인 스냅샷
    const labor = Array.isArray(sec.labor) ? sec.labor : [];
    for (let li = 0; li < labor.length; li++) {
      const l = labor[li];
      await conn.execute(
        `INSERT INTO sq_quote_labor
          (section_id, role_code, role_name, task, mm, base_price, proposed_price, amount, sort)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          sectionId, l.role_code, l.role_name ?? null, l.task ?? null, l.mm ?? 0,
          l.base_price != null ? Math.round(Number(l.base_price)) : null,
          l.proposed_price != null ? Math.round(Number(l.proposed_price)) : null,
          l.amount ?? 0, li,
        ]
      );
    }
  }
}

// 블록형 견적: 클라이언트 스냅샷(기준/제안단가·금액)을 엔진 재계산 없이 그대로 집계.
function snapshotCalc(body) {
  const sections = (body.sections || []).map((sec) => {
    const items = (sec.items || []).map((it) => {
      const proposed = Number(it.proposed_price ?? it.unit_price ?? 0);
      const amount = it.amount != null ? Math.round(Number(it.amount)) : Math.round(proposed * (Number(it.qty) || 1));
      return { ...it, proposed_price: proposed, amount };
    });
    const labor = (sec.labor || []).map((l) => {
      const proposed = Number(l.proposed_price ?? 0);
      const amount = l.amount != null ? Math.round(Number(l.amount)) : Math.round(proposed * (Number(l.mm) || 0));
      return { ...l, proposed_price: proposed, amount };
    });
    const subtotal = items.reduce((a, i) => a + (Number(i.amount) || 0), 0) + labor.reduce((a, l) => a + (Number(l.amount) || 0), 0);
    return { ...sec, items, labor, subtotal };
  });
  const supply = sections.reduce((a, s) => a + s.subtotal, 0);
  const discount = body.discount || { type: null, value: 0 };
  const discountAmount = computeDiscountAmount(discount, supply);
  const afterDiscount = supply - discountAmount;
  const vat = Math.round(afterDiscount * 0.1);
  return {
    sections, supply_amount: supply,
    discount_type: discount.type || null, discount_value: discount.value ?? 0,
    discount_amount: discountAmount, vat_amount: vat, total_amount: afterDiscount + vat,
  };
}

// 블록형 저장 여부: 섹션에 labor 배열 또는 item.block_code 가 있으면 스냅샷 경로.
function isBlockMode(body) {
  return (body.sections || []).some((s) => Array.isArray(s.labor) || (s.items || []).some((i) => i.block_code));
}
function calcFor(body) {
  return isBlockMode(body) ? snapshotCalc(body) : calcQuote({ sections: body.sections, discount: body.discount });
}

// ── 5-C 블록형 저장 ─────────────────────────────────────────
// body 에 blocks 배열이 있으면 블록 경로. sections 는 레거시(Excel/PDF) 호환용으로
// 우산 섹션 1개만 생성하고, 실제 구조는 sq_quote_blocks 에 기록한다.
const isBlocksBody = (body) => Array.isArray(body.blocks) && body.blocks.length > 0;

async function persistQuoteBlocks(conn, { header, calc, quoteNo, createdBy, quoteId = null }) {
  const cols = {
    quote_type: header.quote_type || 'BUILD',
    deployment: header.deployment ?? null,
    template_code: header.template_code ?? null,
    quote_date: header.quote_date,
    valid_until: header.valid_until ?? null,
    customer_name: header.customer_name ?? null,
    customer_contact: header.customer_contact ?? null,
    discount_type: calc.discount_type, discount_value: calc.discount_value ?? 0,
    round_unit: calc.round_unit ?? 100000,
    monthly_discount_type: calc.monthly_discount_type, monthly_discount_value: calc.monthly_discount_value ?? 0,
    supply_amount: calc.supply_amount, discount_amount: calc.discount_amount,
    vat_amount: calc.vat_amount, total_amount: calc.total_amount,
    onetime_total: calc.onetime_total, monthly_total: calc.monthly_total,
    memo: header.memo ?? null,
    conditions: Array.isArray(header.conditions) ? JSON.stringify(header.conditions) : null,
  };
  let id = quoteId;
  if (id) {
    const status = header.status && STATUSES.includes(header.status) ? header.status : null;
    await conn.execute(
      `UPDATE sq_quotes SET ${Object.keys(cols).map((k) => `\`${k}\` = ?`).join(', ')}, status = COALESCE(?, status) WHERE id = ?`,
      [...Object.values(cols), status, id]
    );
    await conn.execute('DELETE FROM sq_quote_blocks WHERE quote_id = ?', [id]);
    await conn.execute('DELETE FROM sq_quote_sections WHERE quote_id = ?', [id]);
  } else {
    const keys = ['quote_no', ...Object.keys(cols), 'status', 'created_by'];
    const vals = [quoteNo, ...Object.values(cols),
      header.status && STATUSES.includes(header.status) ? header.status : 'DRAFT', createdBy ?? null];
    const [r] = await conn.execute(
      `INSERT INTO sq_quotes (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, vals);
    id = r.insertId;
  }

  // 레거시 호환 우산 섹션(Excel/PDF 경로가 sections 를 읽는다)
  const [sr] = await conn.execute(
    `INSERT INTO sq_quote_sections (quote_id, solution, template_code, brand, deployment, contract_months, subtotal, sort)
     VALUES (?,?,?,?,?,?,?,0)`,
    [id, header.solution ?? null, header.template_code ?? null, header.brand ?? null,
     header.deployment ?? null, header.contract_months ?? 1,
     calc.onetime_subtotal + calc.monthly_subtotal]
  );
  const sectionId = sr.insertId;

  for (let bi = 0; bi < calc.blocks.length; bi++) {
    const b = calc.blocks[bi];
    const [br] = await conn.execute(
      `INSERT INTO sq_quote_blocks (quote_id, section_id, block_code, title, subtotal, recurring, sort)
       VALUES (?,?,?,?,?,?,?)`,
      [id, sectionId, b.block_code, b.name ?? b.title ?? null, b.subtotal, b.recurring ? 1 : 0, bi]
    );
    const blockId = br.insertId;

    const items = b.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await conn.execute(
        `INSERT INTO sq_quote_items
          (section_id, block_id, item_code, block_code, category, name, spec, qty, unit, months,
           unit_price, base_price, proposed_price, amount, note, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [sectionId, blockId, it.item_code ?? null, b.block_code, it.category ?? null, it.name,
         it.spec ?? null, it.qty ?? 1, it.unit ?? null, it.months ?? 1,
         Math.round(Number(it.proposed_price) || 0),
         it.base_price != null ? Math.round(Number(it.base_price)) : null,
         Math.round(Number(it.proposed_price) || 0), it.amount ?? 0, it.note ?? null, i]
      );
    }
    const labor = b.labor || [];
    for (let li = 0; li < labor.length; li++) {
      const l = labor[li];
      await conn.execute(
        `INSERT INTO sq_quote_labor
          (section_id, block_id, role_code, role_name, role_label, grade, task, mm,
           base_price, proposed_price, amount, month_alloc, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [sectionId, blockId, l.role_code, l.role_name ?? null, l.role_label ?? null, l.grade ?? null,
         l.task ?? null, l.mm ?? 0,
         l.base_price != null ? Math.round(Number(l.base_price)) : null,
         l.proposed_price != null ? Math.round(Number(l.proposed_price)) : null,
         l.amount ?? 0,
         l.month_alloc && Object.keys(l.month_alloc).length ? JSON.stringify(l.month_alloc) : null, li]
      );
    }
  }
  return id;
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
  let laborRows = [];
  if (sections.length > 0) {
    const ids = sections.map((s) => s.id);
    const ph = ids.map(() => '?').join(',');
    laborRows = await query(`SELECT * FROM sq_quote_labor WHERE section_id IN (${ph}) ORDER BY sort, id`, ids);
  }
  const bySection = new Map(sections.map((s) => [s.id, []]));
  const laborBySection = new Map(sections.map((s) => [s.id, []]));
  for (const it of items) bySection.get(it.section_id)?.push(it);
  for (const l of laborRows) laborBySection.get(l.section_id)?.push(l);
  quote.sections = sections.map((s) => ({
    ...s,
    params: s.params ? safeJson(s.params) : null,
    items: bySection.get(s.id) || [],
    labor: laborBySection.get(s.id) || [],
  }));

  // 블록 구조(5-C) — 있으면 함께 반환. 블록별 품목/인건비는 block_id 로 묶는다.
  const blockRows = await query('SELECT * FROM sq_quote_blocks WHERE quote_id = ? ORDER BY sort, id', [id]);
  const itemsByBlock = new Map(blockRows.map((b) => [b.id, []]));
  const laborByBlock = new Map(blockRows.map((b) => [b.id, []]));
  for (const it of items) if (it.block_id != null) itemsByBlock.get(it.block_id)?.push(it);
  for (const l of laborRows) {
    if (l.block_id == null) continue;
    laborByBlock.get(l.block_id)?.push({ ...l, month_alloc: safeJson(l.month_alloc) });
  }
  quote.blocks = blockRows.map((b) => ({
    ...b,
    recurring: !!b.recurring,
    items: itemsByBlock.get(b.id) || [],
    labor: laborByBlock.get(b.id) || [],
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
  const blockMode = isBlocksBody(body);
  if (!blockMode && (!Array.isArray(body.sections) || body.sections.length === 0)) {
    return res.status(400).json({ error: 'NO_SECTIONS', message: '최소 1개 섹션 또는 블록이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    const calc = blockMode
      ? calcQuoteBlocks({ blocks: body.blocks, discount: body.discount, monthly_discount: body.monthly_discount, round_unit: body.round_unit ?? 100000 })
      : await calcFor(body);
    const quoteDate = body.quote_date ? String(body.quote_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    await conn.beginTransaction();
    const quoteNo = await nextQuoteNo(conn, quoteDate);
    const persist = blockMode ? persistQuoteBlocks : persistQuote;
    const quoteId = await persist(conn, {
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
    const { status, customer, quote_no: quoteNo } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, Number(req.query.size) || 20));
    const conds = [];
    const params = [];
    if (status && STATUSES.includes(status)) { conds.push('status = ?'); params.push(status); }
    if (customer) { conds.push('customer_name LIKE ?'); params.push(`%${customer}%`); }
    // 견적번호는 신형식(QT20260802_001)과 구형식(S20260802001)을 모두 찾는다.
    if (quoteNo) {
      const c = quoteNoSearchClause(quoteNo);
      if (c) { conds.push(c.sql); params.push(...c.params); }
    }
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
  const blockMode = isBlocksBody(body);
  if (!blockMode && (!Array.isArray(body.sections) || body.sections.length === 0)) {
    return res.status(400).json({ error: 'NO_SECTIONS', message: '최소 1개 섹션 또는 블록이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.execute('SELECT id, quote_date FROM sq_quotes WHERE id = ?', [id]);
    if (existing.length === 0) { conn.release(); return res.status(404).json({ error: 'NOT_FOUND' }); }

    if (blockMode) {
      const calc = calcQuoteBlocks({ blocks: body.blocks, discount: body.discount, monthly_discount: body.monthly_discount, round_unit: body.round_unit ?? 100000 });
      await conn.beginTransaction();
      await persistQuoteBlocks(conn, {
        header: { ...body, quote_date: body.quote_date ? String(body.quote_date).slice(0, 10) : existing[0].quote_date },
        calc, quoteId: id,
      });
      await conn.commit();
      return res.json({ quote: await loadQuote(id) });   // 커넥션 반납은 finally 에서
    }

    const calc = await calcFor(body);
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
    const { calcStandardRate } = require('../../domain/labor/standard');
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
  // Phase 5 임금단가표(첨부 페이지) — 견적의 인건비 기준단가가 나온 그 표.
  // 견적일 연도를 우선하고, 없으면 active 연도.
  try {
    const wantYear = Number(String(quote.quote_date || '').slice(0, 4)) || null;
    let yr = wantYear ? (await query('SELECT * FROM sq_labor_rate_years WHERE `year` = ?', [wantYear]))[0] : null;
    if (!yr) [yr] = await query('SELECT * FROM sq_labor_rate_years WHERE active = 1 LIMIT 1');
    if (yr) {
      masters.laborRateYear = yr.year;
      masters.laborRateSource = yr.source;
      masters.laborRates = await query(
        'SELECT role_code, role_name, grade, wage_md, wage_mm, overhead, tech_fee, apply_price, note FROM sq_labor_rate_lines WHERE year_id = ? ORDER BY sort, id',
        [yr.id]);
    }
  } catch (e) {
    console.error('[quote] Phase5 임금단가표 로드 실패:', e.message);
  }

  // 견적조건 — 저장된 conditions 가 없을 때 템플릿의 condition_set 을 쓴다
  try {
    if (quote.template_code) {
      const [tpl] = await query('SELECT condition_set FROM sq_quote_templates WHERE code = ?', [quote.template_code]);
      if (tpl && tpl.condition_set) {
        masters.conditionLines = (await query(
          'SELECT `text` FROM sq_condition_lines WHERE set_code = ? ORDER BY line_no', [tpl.condition_set])).map((r) => r.text);
      }
    }
  } catch (e) {
    console.error('[quote] 견적조건 로드 실패:', e.message);
  }

  // 건수 밴드표(SaaS) — 견적에 담긴 모듈 중 밴드가 있는 것만
  try {
    const codes = [...new Set((quote.blocks || []).flatMap((b) => (b.items || []).map((i) => i.item_code)).filter(Boolean))];
    if (codes.length) {
      const ph = codes.map(() => '?').join(',');
      const rows = await query(
        `SELECT p.code, v.label, v.min_qty, v.max_qty, v.price
           FROM sq_price_variants v JOIN sq_price_items p ON p.id = v.item_id
          WHERE p.code IN (${ph}) ORDER BY v.sort`, codes);
      masters.bands = {};
      for (const r of rows) (masters.bands[r.code] = masters.bands[r.code] || []).push(r);
    }
  } catch (e) {
    console.error('[quote] 밴드표 로드 실패:', e.message);
  }

  // 블록 정의(블록형 견적서 렌더용)
  try {
    const bl = await query('SELECT code, name, `columns`, recurring, has_subtotal, sort FROM sq_blocks ORDER BY sort');
    masters.blockDefs = {};
    for (const b of bl) {
      let cols = b.columns;
      if (typeof cols === 'string') { try { cols = JSON.parse(cols); } catch { cols = []; } }
      masters.blockDefs[b.code] = { name: b.name, columns: Array.isArray(cols) ? cols : [], recurring: !!b.recurring, has_subtotal: !!b.has_subtotal, sort: b.sort };
    }
  } catch (e) {
    console.error('[quote] 블록 정의 로드 실패:', e.message);
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
    const { renderQuoteHtml } = require('../../domain/render/html');
    const { htmlToPdf } = require('../../domain/render/pdf');
    const quote = await loadQuote(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: 'NOT_FOUND' });
    const settings = await loadSettings();
    const masters = await buildMasters(quote);
    // ?cover=0 → 표지 없이 본문만(외부 커버 PDF 병합용 훅)
    const html = renderQuoteHtml(quote, settings, masters, { withCover: req.query.cover !== '0' });
    const pdf = await htmlToPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(quote.quote_no)}.pdf"`);
    res.end(pdf);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
