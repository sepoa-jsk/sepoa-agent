'use strict';
// 견적 계산 엔진 - 타시스템 연계(API) 시 서버 측에서 동일 로직으로 단가 산출
// pricing_type:
//   DISCOUNT : 기업구분(variant.key)별 확정 단가
//   BAND     : 수량(qty)이 속하는 구간(min_qty~max_qty)의 단가
//   FIXED    : 고정 단가(base_price)
//   MM       : 월단가(base_price) × 기업구분별 적용율(rate), 수량은 M/M

function resolveUnitPrice(item, variants, { companyClass, qty }) {
  switch (item.pricing_type) {
    case 'FIXED':
      return { unitPrice: item.base_price, needNegotiation: false };
    case 'DISCOUNT': {
      const v = variants.find(v => v.key === companyClass);
      if (!v) return { unitPrice: null, needNegotiation: true };
      if (v.price === null || v.price === undefined) return { unitPrice: null, needNegotiation: true };
      return { unitPrice: v.price, needNegotiation: false };
    }
    case 'MM': {
      const v = variants.find(v => v.key === companyClass);
      const rate = v && v.rate != null ? v.rate : 1;
      return { unitPrice: Math.round(item.base_price * rate), needNegotiation: false };
    }
    case 'BAND': {
      const q = Number(qty) || 0;
      const v = variants.find(v => q >= (v.min_qty ?? 0) && q <= (v.max_qty ?? Infinity));
      if (!v) return { unitPrice: null, needNegotiation: true };
      return { unitPrice: v.price, needNegotiation: false, bandLabel: v.label };
    }
    default:
      return { unitPrice: null, needNegotiation: true };
  }
}

// line: { item, variants, qty, months }
function calcLine(item, variants, { companyClass, qty, months }) {
  const { unitPrice, needNegotiation, bandLabel } = resolveUnitPrice(item, variants, { companyClass, qty });
  if (needNegotiation) {
    return { unitPrice: 0, amount: 0, needNegotiation: true, bandLabel: null };
  }
  const m = item.recurring ? Math.max(1, Number(months) || 1) : 1;
  // BAND: 구간 단가 자체가 총액(월액) → 수량 곱하지 않음. 그 외: 단가 × 수량.
  const base = item.pricing_type === 'BAND' ? unitPrice : Math.round(unitPrice * (Number(qty) || 1));
  return { unitPrice, amount: base * m, months: m, needNegotiation: false, bandLabel: bandLabel || null };
}

function calcTotals(lines, discountAmount = 0) {
  const supply = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const afterDiscount = supply - (Number(discountAmount) || 0);
  const vat = Math.round(afterDiscount * 0.1);
  return { supply, discount: Number(discountAmount) || 0, vat, total: afterDiscount + vat };
}

// ═══════════════════════════════════════════════════════════════
// Phase 5-C 블록형 견적 계산 (PLAN_PHASE5_REV §2)
//   블록소계 합 → 특별DC → 절사(십만단위) → VAT. 일시불/월(recurring) 분리.
//   실측 근거: 솔브레인 86,600,000→60,000,000 / SK이터닉스 104,400,000→100,000,000, 월 1,275,000
// ═══════════════════════════════════════════════════════════════

const VAT_RATE = 0.1;
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

// 블록 1개의 라인별 금액과 소계. LABOR 는 공수(mm), 그 외는 수량(qty) 기준.
//   amount = 제안단가 × (mm | qty).  라인에 amount 가 이미 있으면 그 값을 신뢰(스냅샷 재조회).
function calcBlock(block) {
  const isLabor = block.block_code === 'LABOR' || Array.isArray(block.labor);
  const rows = isLabor ? (block.labor || []) : (block.items || []);
  const lines = rows.map((r) => {
    const proposed = num(r.proposed_price);
    const qty = isLabor ? num(r.mm) : (r.qty == null ? 1 : num(r.qty));
    const amount = r.amount != null ? Math.round(num(r.amount)) : Math.round(proposed * qty);
    return { ...r, proposed_price: proposed, [isLabor ? 'mm' : 'qty']: qty, amount };
  });
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  return { ...block, [isLabor ? 'labor' : 'items']: lines, subtotal, recurring: !!block.recurring };
}

// 인력투입계획 검증: Σ month_alloc = mm (부동소수 오차 0.001 허용)
function validateMonthAlloc(labor) {
  const errors = [];
  for (const l of labor || []) {
    if (!l.month_alloc) continue;
    const alloc = typeof l.month_alloc === 'string' ? JSON.parse(l.month_alloc) : l.month_alloc;
    const sum = Object.values(alloc).reduce((a, v) => a + num(v), 0);
    if (Math.abs(sum - num(l.mm)) > 0.001) {
      errors.push({ role_code: l.role_code, mm: num(l.mm), alloc_sum: Number(sum.toFixed(3)),
        message: `${l.role_label || l.role_code}: 월별 배분 합계 ${sum} 가 공수 ${l.mm} MM 과 다릅니다.` });
    }
  }
  return errors;
}

// 특별DC — AMOUNT(할인액) / RATE(%) / TARGET(최종 목표금액, 실측 견적서가 쓰는 방식)
function computeDiscount(discount, base) {
  const type = discount?.type || null;
  const value = num(discount?.value);
  if (!type || !value) return 0;
  if (type === 'RATE') return Math.round(base * (value / 100));
  if (type === 'TARGET') return Math.max(0, base - value);
  return Math.round(value); // AMOUNT
}

// 절사: unit 단위 내림(십만단위 절사 = 100000). unit 0/미지정이면 절사 안 함.
function floorTo(amount, unit) {
  const u = num(unit);
  if (u <= 0) return Math.round(amount);
  return Math.floor(amount / u) * u;
}

// 블록형 견적 전체 계산.
//   input: { blocks: [{block_code, recurring, items|labor}], discount: {type,value}, round_unit }
function calcQuoteBlocks({ blocks = [], discount = null, round_unit = 100000 } = {}) {
  const calcedBlocks = blocks.map(calcBlock);

  // 일시불 / 월(recurring) 분리 — SaaS·PCloud 는 총견적가에 두 금액을 따로 노출한다
  const onetimeSubtotal = calcedBlocks.filter((b) => !b.recurring).reduce((a, b) => a + b.subtotal, 0);
  const monthlySubtotal = calcedBlocks.filter((b) => b.recurring).reduce((a, b) => a + b.subtotal, 0);

  // 순서 고정: 소계합 → 특별DC → 절사. DC/절사는 일시불에만 적용(실측: 월사용료는 그대로).
  const discountAmount = computeDiscount(discount, onetimeSubtotal);
  const afterDiscount = onetimeSubtotal - discountAmount;
  const onetimeTotal = floorTo(afterDiscount, round_unit);

  const vatAmount = Math.round(onetimeTotal * VAT_RATE);
  const monthlyVat = Math.round(monthlySubtotal * VAT_RATE);

  const laborErrors = calcedBlocks.flatMap((b) => validateMonthAlloc(b.labor));

  return {
    blocks: calcedBlocks,
    onetime_subtotal: onetimeSubtotal,
    monthly_subtotal: monthlySubtotal,
    discount_type: discount?.type || null,
    discount_value: num(discount?.value),
    discount_amount: discountAmount,
    round_unit: num(round_unit),
    rounding_adjustment: afterDiscount - onetimeTotal, // 절사로 깎인 금액
    onetime_total: onetimeTotal,
    monthly_total: monthlySubtotal,
    vat_amount: vatAmount,
    monthly_vat: monthlyVat,
    total_amount: onetimeTotal + vatAmount,   // 일시불 기준 VAT 포함
    supply_amount: onetimeSubtotal,           // 하위호환(공급가액=일시불 소계합)
    labor_errors: laborErrors,
  };
}

module.exports = {
  resolveUnitPrice, calcLine, calcTotals,
  calcBlock, calcQuoteBlocks, computeDiscount, floorTo, validateMonthAlloc,
};
