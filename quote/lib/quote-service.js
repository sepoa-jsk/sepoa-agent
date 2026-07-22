'use strict';
// 견적 계산 서비스 — /calculate 와 견적 저장(create/update)이 공유하는 계산 경로.
// 저장 시 이 결과를 단가 스냅샷으로 그대로 영속화한다.
const { query } = require('./db');
const { calcLine } = require('./quote-engine');

function computeDiscountAmount(discount, supply) {
  if (!discount || !discount.type) return 0;
  const value = Number(discount.value) || 0;
  if (discount.type === 'RATE') return Math.round((supply * value) / 100);
  return Math.round(value); // AMOUNT
}

async function fetchItemMap(codes) {
  const uniq = [...new Set(codes.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const ph = uniq.map(() => '?').join(',');
  const items = await query(`SELECT * FROM sq_price_items WHERE code IN (${ph})`, uniq);
  const ids = items.map((i) => i.id);
  let variants = [];
  if (ids.length > 0) {
    const vph = ids.map(() => '?').join(',');
    variants = await query(`SELECT * FROM sq_price_variants WHERE item_id IN (${vph}) ORDER BY sort, id`, ids);
  }
  const vByItem = new Map(ids.map((id) => [id, []]));
  for (const v of variants) vByItem.get(v.item_id)?.push(v);
  return new Map(items.map((it) => [it.code, { item: it, variants: vByItem.get(it.id) || [] }]));
}

// 가격정책 품목이 있으면 엔진 계산(+override), 없으면 수기(manual) 라인.
function buildLine(entry, reqItem, sectionMonths, sectionCompanyClass) {
  const companyClass = reqItem.companyClass ?? sectionCompanyClass;
  const qty = reqItem.qty != null ? Number(reqItem.qty) : null;
  const months = reqItem.months != null ? Number(reqItem.months) : Number(sectionMonths) || 1;

  if (!entry) {
    // 수기 라인: name 필수, 단가/금액 직접 입력
    const q = qty != null ? qty : 1;
    const unitPrice = Math.round(Number(reqItem.unit_price) || 0);
    const m = reqItem.recurring ? Math.max(1, months) : 1;
    const amount = reqItem.amount != null ? Math.round(Number(reqItem.amount)) : Math.round(unitPrice * q) * m;
    return {
      item_code: reqItem.code || null,
      category: reqItem.category || null,
      name: reqItem.name || '(수기항목)',
      spec: reqItem.spec || null,
      qty: q,
      unit: reqItem.unit || null,
      months: m,
      unit_price: unitPrice,
      base_price: reqItem.base_price != null ? Math.round(Number(reqItem.base_price)) : null,
      amount,
      note: reqItem.note || null,
      need_negotiation: false,
      band_label: null,
      manual: true,
    };
  }

  const { item, variants } = entry;
  const useQty = qty != null ? qty : Number(item.qty_default) || 1;

  let unitPrice;
  let amount;
  let needNegotiation = false;
  let bandLabel = null;
  const m = item.recurring ? Math.max(1, months) : 1;

  if (reqItem.unit_price != null) {
    // 별도협의 등 단가 override
    unitPrice = Math.round(Number(reqItem.unit_price));
    const base = item.pricing_type === 'BAND' ? unitPrice : Math.round(unitPrice * useQty);
    amount = base * m;
  } else {
    const r = calcLine(item, variants, { companyClass, qty: useQty, months });
    unitPrice = r.unitPrice;
    amount = r.amount;
    needNegotiation = r.needNegotiation;
    bandLabel = r.bandLabel;
  }

  return {
    item_code: item.code,
    category: item.category,
    name: item.name,
    spec: item.spec,
    qty: useQty,
    unit: item.unit,
    months: m,
    unit_price: unitPrice,
    base_price: reqItem.base_price != null ? Math.round(Number(reqItem.base_price)) : (item.base_price != null ? Number(item.base_price) : null),
    amount,
    note: reqItem.note != null ? reqItem.note : item.note || null,
    need_negotiation: needNegotiation,
    band_label: bandLabel,
    manual: false,
  };
}

// inSections: [{ solution, deployment, companyClass, months, params?, items:[{code?,qty?,months?,unit_price?,...}] }]
async function calcQuote({ sections, discount }) {
  const inSections = Array.isArray(sections) ? sections : [];
  const allCodes = inSections.flatMap((s) => (s.items || []).map((i) => i.code));
  const itemMap = await fetchItemMap(allCodes);

  const outSections = inSections.map((sec) => {
    const lines = (sec.items || []).map((reqItem) =>
      buildLine(itemMap.get(reqItem.code), reqItem, sec.months, sec.companyClass)
    );
    const subtotal = lines.reduce((s, l) => s + (l.amount || 0), 0);
    return {
      solution: sec.solution,
      deployment: sec.deployment,
      companyClass: sec.companyClass ?? null,
      contract_months: Number(sec.months) || 1,
      params: sec.params ?? null,
      items: lines,
      subtotal,
    };
  });

  const supply = outSections.reduce((s, sec) => s + sec.subtotal, 0);
  const discountAmount = computeDiscountAmount(discount, supply);
  const afterDiscount = supply - discountAmount;
  const vat = Math.round(afterDiscount * 0.1);
  const total = afterDiscount + vat;

  return {
    sections: outSections,
    supply_amount: supply,
    discount_type: discount?.type || null,
    discount_value: discount?.value ?? 0,
    discount_amount: discountAmount,
    vat_amount: vat,
    total_amount: total,
  };
}

module.exports = { calcQuote, computeDiscountAmount, fetchItemMap, buildLine };
