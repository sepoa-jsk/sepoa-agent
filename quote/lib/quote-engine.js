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

module.exports = { resolveUnitPrice, calcLine, calcTotals };
