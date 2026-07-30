'use strict';
// 5-C 블록형 계산 엔진 — 실측 견적서 재현 검증.
// 근거 문서:
//   assets/인장/전자인장_온프레미스.pdf      QT20260728_001 솔브레인 전자계약   → 최종 60,000,000
//   assets/인장/전자인장_온프레미스.pdf      QT20260728_002 솔브레인 전자인장계약 → 최종 80,000,000
//   assets/인장/전자인장_프라이빗클라우드.pdf QT20260506_001 SK이터닉스 PCloud
//                                             → 일시납 100,000,000 / 월 1,275,000
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcQuoteBlocks, calcBlock, computeDiscount, floorTo, validateMonthAlloc } = require('../lib/quote-engine');

// ── 실측 1: 솔브레인 전자계약 (온프레미스 일시불) ──────────────
// 솔루션 소계 50,000,000 + 인건비 소계 36,600,000 = Total 86,600,000 → 특별DC → 60,000,000
function solbrainContract(extraSolutionRows = []) {
  return {
    round_unit: 100000,
    discount: { type: 'TARGET', value: 60000000 },
    blocks: [
      {
        block_code: 'SOLUTION', recurring: 0,
        items: [
          // 전자인장관리솔루션 번들 — 5개 모듈이 한 줄로 묶여 기준 100,000,000 → 제안 40,000,000
          { item_code: 'POA_ECONTRACT', category: '전자인장관리솔루션', name: 'Poa Contract™', qty: 1, base_price: 100000000, proposed_price: 40000000 },
          { item_code: 'POA_DOCSCV_ES', category: '전자인장관리솔루션', name: 'Poa DocsCV™', qty: 0, base_price: 0, proposed_price: 0 },
          { item_code: 'POA_COMMON_ES', category: '전자인장관리솔루션', name: 'Poa Common™', qty: 0, base_price: 0, proposed_price: 0 },
          { item_code: 'POA_APPROVAL_ES', category: '전자인장관리솔루션', name: 'Poa Approval™', qty: 0, base_price: 0, proposed_price: 0 },
          { item_code: 'WEB_GRID_ES', category: '전자인장관리솔루션', name: 'Web Grid & Chart', qty: 0, base_price: 0, proposed_price: 0 },
          ...extraSolutionRows,
          { item_code: 'ESEAL_PKI', category: '응용소프트웨어', name: '전자계약 공인인증', qty: 1, base_price: 15000000, proposed_price: 10000000 },
        ],
      },
      {
        block_code: 'LABOR', recurring: 0,
        labor: [
          { role_code: 'PM', role_label: 'PM', task: '프로젝트 총괄(PM), 분석, 설계', mm: 1.0, base_price: 25418735, proposed_price: 13500000 },
          { role_code: 'DEV', role_label: '개발', task: '커스터마이징, 인터페이스, 안정화', mm: 2.0, base_price: 25418735, proposed_price: 10500000 },
          { role_code: 'SUPPORT', role_label: '기술지원', task: '서버확인, 보안점검', mm: 0.2, base_price: 25418735, proposed_price: 10500000 },
        ],
      },
    ],
  };
}

test('실측 솔브레인 전자계약 — 솔루션 50,000,000 / 인건비 36,600,000 / Total 86,600,000 → 60,000,000', () => {
  const r = calcQuoteBlocks(solbrainContract());
  const [sol, labor] = r.blocks;
  assert.equal(sol.subtotal, 50000000, '솔루션 소계');
  assert.equal(labor.subtotal, 36600000, '인건비 소계');
  assert.equal(r.onetime_subtotal, 86600000, 'Total(솔루션+인건비)');
  assert.equal(r.onetime_total, 60000000, '최종견적금액(특별DC 적용)');
  assert.equal(r.discount_amount, 26600000);
  assert.equal(r.monthly_total, 0, '온프레미스 일시불은 월 금액 없음');
  assert.equal(r.vat_amount, 6000000, 'VAT 10% 별도');
});

test('실측 솔브레인 전자인장계약 — Poa Seal 20,000,000 가산 → 솔루션 70,000,000 / Total 106,600,000 → 80,000,000', () => {
  const seal = { item_code: 'POA_SEAL', category: '전자인장관리솔루션', name: 'Poa Seal™', qty: 1, base_price: 20000000, proposed_price: 20000000 };
  const body = solbrainContract([seal]);
  body.discount = { type: 'TARGET', value: 80000000 };
  const r = calcQuoteBlocks(body);
  assert.equal(r.blocks[0].subtotal, 70000000, '솔루션 소계');
  assert.equal(r.blocks[1].subtotal, 36600000, '인건비 소계');
  assert.equal(r.onetime_subtotal, 106600000, 'Total');
  assert.equal(r.onetime_total, 80000000, '최종견적금액');
});

test('인건비 라인 — 제안단가 × 공수 (실측 3.2MM = 36,600,000)', () => {
  const b = calcBlock(solbrainContract().blocks[1]);
  assert.deepEqual(b.labor.map((l) => l.amount), [13500000, 21000000, 2100000]);
  assert.equal(b.labor.reduce((a, l) => a + l.mm, 0).toFixed(1), '3.2');
  assert.equal(b.subtotal, 36600000);
});

// ── 실측 2: SK이터닉스 Private Cloud ──────────────────────────
// 셋업 44,400,000 + 라이선스 60,000,000 = 일시납 104,400,000 → 최종셋업비 100,000,000
// 서비스 이용료(월) 200,000 + 700,000 + 375,000 = 1,275,000
function skEternix() {
  return {
    round_unit: 100000,
    discount: { type: 'TARGET', value: 100000000 },
    blocks: [
      {
        block_code: 'SETUP', recurring: 0,
        items: [
          // 3.7 MM × 제안 12,000,000 = 44,400,000 (기준단가 = 응용SW 개발자 apply_price)
          { item_code: 'ESEAL_PC_SETUP', category: '전자인장시스템', name: '클라우드 셋업', qty: 3.7, unit: 'MM', base_price: 19540395, proposed_price: 12000000 },
          // 수량 0 — 미포함 참고라인(실측에서 금액 '-')
          { item_code: 'ESEAL_PC_PKI', category: '응용소프트웨어', name: '전자계약 공인인증', qty: 0, base_price: 20000000, proposed_price: 15000000 },
        ],
      },
      {
        block_code: 'LICENSE', recurring: 0,
        items: [{ item_code: 'ESEAL_PC_LICENSE', category: '전자인장시스템', name: '솔루션 라이선스', qty: 1, base_price: 100000000, proposed_price: 60000000 }],
      },
      {
        block_code: 'SERVICE', recurring: 1,
        items: [
          { item_code: 'ESEAL_PC_API', name: '연동 API 사용료', qty: 1, base_price: 200000, proposed_price: 200000 },
          { item_code: 'ESEAL_PC_SERVER', name: 'Private Server 사용료', qty: 1, base_price: 700000, proposed_price: 700000 },
          { item_code: 'ESEAL_PC_MAINT', name: '유지보수', qty: 1, base_price: 750000, proposed_price: 375000 },
        ],
      },
    ],
  };
}

test('실측 SK이터닉스 PCloud — 일시납 100,000,000 / 월 1,275,000', () => {
  const r = calcQuoteBlocks(skEternix());
  const [setup, license, service] = r.blocks;
  assert.equal(setup.subtotal, 44400000, '셋업비용 소계');
  assert.equal(license.subtotal, 60000000, '라이선스비용 소계');
  assert.equal(r.onetime_subtotal, 104400000, '일시납 합계');
  assert.equal(r.onetime_total, 100000000, '최종셋업비(특별DC 적용)');
  assert.equal(service.subtotal, 1275000, '서비스 이용료 소계(월)');
  assert.equal(r.monthly_total, 1275000, '월사용료는 DC·절사 대상 아님');
});

test('PCloud 셋업 — MM 기반 수량 (3.7 × 12,000,000 = 44,400,000), 수량 0 라인은 0원', () => {
  const b = calcBlock(skEternix().blocks[0]);
  assert.equal(b.items[0].amount, 44400000);
  assert.equal(b.items[1].amount, 0, '수량 0 참고라인');
});

test('recurring 블록은 일시불 합계에 섞이지 않는다', () => {
  const r = calcQuoteBlocks(skEternix());
  assert.equal(r.onetime_subtotal + r.monthly_subtotal, 104400000 + 1275000);
  assert.notEqual(r.onetime_subtotal, 105675000, '월 금액이 일시불에 합산되면 안 된다');
});

// ── 계산 순서·절사·할인 ───────────────────────────────────────
test('계산 순서 고정 — 소계합 → 특별DC → 절사 (절사를 먼저 하면 값이 달라진다)', () => {
  const r = calcQuoteBlocks({
    round_unit: 100000,
    discount: { type: 'AMOUNT', value: 1234567 },
    blocks: [{ block_code: 'SOLUTION', recurring: 0, items: [{ qty: 1, proposed_price: 98765432 }] }],
  });
  // 98,765,432 − 1,234,567 = 97,530,865 → 십만절사 → 97,500,000
  assert.equal(r.onetime_subtotal, 98765432);
  assert.equal(r.discount_amount, 1234567);
  assert.equal(r.onetime_total, 97500000);
  assert.equal(r.rounding_adjustment, 30865);
});

test('특별DC 3종 — AMOUNT / RATE / TARGET', () => {
  assert.equal(computeDiscount({ type: 'AMOUNT', value: 5000000 }, 86600000), 5000000);
  assert.equal(computeDiscount({ type: 'RATE', value: 10 }, 86600000), 8660000);
  assert.equal(computeDiscount({ type: 'TARGET', value: 60000000 }, 86600000), 26600000);
  assert.equal(computeDiscount(null, 86600000), 0, 'DC 없으면 0');
  assert.equal(computeDiscount({ type: 'TARGET', value: 90000000 }, 86600000), 0, '목표가 소계보다 크면 할인 0');
});

test('십만단위 절사 — floor (반올림 아님)', () => {
  assert.equal(floorTo(60099999, 100000), 60000000);
  assert.equal(floorTo(60100000, 100000), 60100000);
  assert.equal(floorTo(86600000, 100000), 86600000);
  assert.equal(floorTo(60099999, 0), 60099999, 'unit 0 이면 절사 안 함');
});

test('DC 없으면 소계합이 그대로(절사만) 최종금액', () => {
  const body = solbrainContract();
  body.discount = null;
  const r = calcQuoteBlocks(body);
  assert.equal(r.discount_amount, 0);
  assert.equal(r.onetime_total, 86600000);
});

// ── 인력투입계획(월별 배분) ───────────────────────────────────
test('실측 SK이터닉스 인력투입계획 — 합계 3.70 MM, 월별 배분 Σ=mm', () => {
  const labor = [
    { role_code: 'CONSULTANT', role_label: '컨설턴트', mm: 1.00, month_alloc: { M: 0.25, M1: 0.25, M2: 0.25, M3: 0.25 } },
    { role_code: 'DEV', role_label: '개발#1', mm: 1.50, month_alloc: { M1: 0.50, M2: 0.75, M3: 0.25 } },
    { role_code: 'DEV', role_label: '개발#2', mm: 1.00, month_alloc: { M1: 0.25, M2: 0.50, M3: 0.25 } },
    { role_code: 'SUPPORT', role_label: '기술지원', mm: 0.20, month_alloc: { M1: 0.20 } },
  ];
  assert.deepEqual(validateMonthAlloc(labor), [], '배분 합계가 공수와 일치해야 한다');
  assert.equal(labor.reduce((a, l) => a + l.mm, 0).toFixed(2), '3.70');
  // 월별 합계 — 실측 하단 합계행 0.25 / 1.20 / 1.50 / 0.75
  const byMonth = {};
  for (const l of labor) for (const [m, v] of Object.entries(l.month_alloc)) byMonth[m] = (byMonth[m] || 0) + v;
  assert.equal(byMonth.M.toFixed(2), '0.25');
  assert.equal(byMonth.M1.toFixed(2), '1.20');
  assert.equal(byMonth.M2.toFixed(2), '1.50');
  assert.equal(byMonth.M3.toFixed(2), '0.75');
});

test('실측 솔브레인 인력투입계획 — 합계 3.20 MM (M 0.25 / M1 1.45 / M2 0.75 / M3 0.75)', () => {
  const labor = [
    { role_code: 'PM', mm: 1.00, month_alloc: { M: 0.25, M1: 0.25, M2: 0.25, M3: 0.25 } },
    { role_code: 'DEV', mm: 2.00, month_alloc: { M1: 1.00, M2: 0.50, M3: 0.50 } },
    { role_code: 'SUPPORT', mm: 0.20, month_alloc: { M1: 0.20 } },
  ];
  assert.deepEqual(validateMonthAlloc(labor), []);
  assert.equal(labor.reduce((a, l) => a + l.mm, 0).toFixed(2), '3.20');
});

test('월별 배분 합계가 공수와 다르면 오류로 잡는다', () => {
  const errs = validateMonthAlloc([{ role_code: 'PM', role_label: 'PM', mm: 1.0, month_alloc: { M: 0.25, M1: 0.25 } }]);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].alloc_sum, 0.5);
  assert.match(errs[0].message, /0\.5.*1/);
});

test('month_alloc 은 JSON 문자열도 허용(DB 저장값 그대로 검증)', () => {
  const errs = validateMonthAlloc([{ role_code: 'PM', mm: 1.0, month_alloc: '{"M":0.5,"M1":0.5}' }]);
  assert.deepEqual(errs, []);
});

test('month_alloc 없으면 검증 통과(옵션 기능)', () => {
  assert.deepEqual(validateMonthAlloc([{ role_code: 'PM', mm: 1.0 }]), []);
});

test('calcQuoteBlocks 가 labor_errors 를 함께 반환한다', () => {
  const body = solbrainContract();
  body.blocks[1].labor[0].month_alloc = { M: 0.9 }; // mm 1.0 과 불일치
  const r = calcQuoteBlocks(body);
  assert.equal(r.labor_errors.length, 1);
  assert.equal(r.onetime_total, 60000000, '검증 오류가 있어도 금액 계산은 수행');
});

test('빈 견적 — 0원, 오류 없음', () => {
  const r = calcQuoteBlocks({});
  assert.equal(r.onetime_total, 0);
  assert.equal(r.monthly_total, 0);
  assert.deepEqual(r.labor_errors, []);
});
