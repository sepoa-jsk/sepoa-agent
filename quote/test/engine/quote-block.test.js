'use strict';
// 5-C 블록형 계산 엔진 — 실측 견적서 재현 검증 (20종).
//
// ── J2 전환 (2026-08-02) ──────────────────────────────────────────
// 입력·기대값을 test/fixtures/engine/*.json 으로 분리했다.
// **Java 이식본(quote_automation)이 같은 픽스처를 읽는다.** 두 구현이 같은 입력을
// 공유해야 대조가 성립하므로, 기대값을 이 파일에 다시 적지 않는다.
//
// 픽스처를 고치려면 test/extract-fixtures.js 를 다시 돌린다. 손으로 편집하지 말 것.
//
// 근거 문서:
//   assets/인장/전자인장_온프레미스.pdf      QT20260728_001 솔브레인 전자계약   → 60,000,000
//   assets/인장/전자인장_온프레미스.pdf      QT20260728_002 솔브레인 전자인장계약 → 80,000,000
//   assets/인장/전자인장_프라이빗클라우드.pdf QT20260506_001 SK이터닉스 PCloud
//                                             → 일시납 100,000,000 / 월 1,275,000
//   assets/인장/전자인장_SaaS.pdf            QT20260415_002 하겐다즈 SaaS
//                                             → 셋업 무상제공(0) / 월 100,000
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { calcQuoteBlocks, calcBlock, computeDiscount, floorTo, validateMonthAlloc } = require('../../src/domain/pricing/engine');

const FIX = path.join(__dirname, '..', 'fixtures', 'engine');
const load = (name) => require(path.join(FIX, name));

const round2 = (n) => Number(n.toFixed(2));

// 월별 배분 합계 — 인력투입계획 부록의 합계행.
// 엔진 함수가 아니라 표시용 집계라 테스트 쪽에 둔다.
// (Java 이식본은 PricingEngine.monthlyAllocationTotals 로 노출한다)
function monthTotals(labor) {
  const by = {};
  for (const l of labor) {
    const raw = l.month_alloc;
    if (!raw) continue;
    const alloc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const [m, v] of Object.entries(alloc)) by[m] = (by[m] || 0) + Number(v);
  }
  for (const k of Object.keys(by)) by[k] = round2(by[k]);
  return by;
}

// ── QUOTE 11종 — calcQuoteBlocks 전체 ─────────────────────────────
for (const c of load('quote-cases.json')) {
  test(`[QUOTE] ${c.caseId} — ${c.description}`, () => {
    const r = calcQuoteBlocks(c.input);
    const e = c.expected;

    assert.deepEqual(
      r.blocks.map((b) => ({ block_code: b.block_code, recurring: b.recurring ? 1 : 0, subtotal: b.subtotal })),
      e.block_subtotals, '블록별 소계');

    assert.equal(r.onetime_subtotal, e.onetime_subtotal, '일시불 소계합');
    assert.equal(r.monthly_subtotal, e.monthly_subtotal, '월 소계합');
    assert.equal(r.discount_amount, e.discount_amount, '특별DC 금액');
    assert.equal(r.monthly_discount_amount, e.monthly_discount_amount, '월 특별DC 금액');
    assert.equal(r.round_unit, e.round_unit, '절사 단위');
    assert.equal(r.rounding_adjustment, e.rounding_adjustment, '절사로 깎인 금액');
    assert.equal(r.onetime_total, e.onetime_total, '최종 일시불 금액');
    assert.equal(r.monthly_total, e.monthly_total, '최종 월 금액');
    assert.equal(r.vat_amount, e.vat_amount, 'VAT (일시불)');
    assert.equal(r.monthly_vat, e.monthly_vat, 'VAT (월)');
    assert.equal(r.total_amount, e.total_amount, 'VAT 포함 총액');
    assert.equal(r.supply_amount, e.supply_amount, '공급가액');
    assert.deepEqual(r.labor_errors, e.labor_errors, '인력투입계획 검증 오류');
  });
}

// ── BLOCK 2종 — calcBlock 단일 블록 ──────────────────────────────
for (const c of load('block-cases.json')) {
  test(`[BLOCK] ${c.caseId} — ${c.description}`, () => {
    const b = calcBlock(c.input);
    const e = c.expected;
    const isLabor = c.input.block_code === 'LABOR';
    const rows = isLabor ? b.labor : b.items;

    assert.equal(b.block_code, e.block_code);
    assert.equal(b.recurring ? 1 : 0, e.recurring);
    assert.equal(b.subtotal, e.subtotal, '블록 소계');
    assert.deepEqual(rows.map((r) => r.amount), e.line_amounts, '라인별 금액');
    if (e.mm_total !== null) {
      assert.equal(round2(rows.reduce((a, r) => a + Number(r.mm || 0), 0)), e.mm_total, '공수 합계');
    }
  });
}

// ── DISCOUNT 1종 — computeDiscount ───────────────────────────────
for (const c of load('discount-cases.json')) {
  test(`[DISCOUNT] ${c.caseId} — ${c.description}`, () => {
    assert.deepEqual(
      c.input.map((i) => ({ label: i.label, amount: computeDiscount(i.discount, i.base) })),
      c.expected);
  });
}

// ── FLOOR 1종 — floorTo ──────────────────────────────────────────
for (const c of load('floor-cases.json')) {
  test(`[FLOOR] ${c.caseId} — ${c.description}`, () => {
    assert.deepEqual(
      c.input.map((i) => ({ label: i.label, result: floorTo(i.amount, i.unit) })),
      c.expected);
  });
}

// ── MONTH_ALLOC 5종 — validateMonthAlloc + 월별 합계 ─────────────
for (const c of load('month-alloc-cases.json')) {
  test(`[MONTH_ALLOC] ${c.caseId} — ${c.description}`, () => {
    const errors = validateMonthAlloc(c.input);
    assert.deepEqual(errors, c.expected.errors, '검증 오류 내역');
    assert.equal(errors.length, c.expected.error_count, '오류 건수');
    assert.equal(round2(c.input.reduce((a, l) => a + Number(l.mm || 0), 0)), c.expected.mm_total, '공수 합계');
    assert.deepEqual(monthTotals(c.input), c.expected.month_totals, '월별 배분 합계');
  });
}
