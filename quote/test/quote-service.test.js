'use strict';
// quote-service 순수 함수 테스트 (DB 불필요)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDiscountAmount, buildLine } = require('../lib/quote-service');

test('할인 — AMOUNT는 값 그대로', () => {
  assert.equal(computeDiscountAmount({ type: 'AMOUNT', value: 500000 }, 10000000), 500000);
});

test('할인 — RATE는 공급가액 대비 % (반올림)', () => {
  assert.equal(computeDiscountAmount({ type: 'RATE', value: 10 }, 10000000), 1000000);
  assert.equal(computeDiscountAmount({ type: 'RATE', value: 7.5 }, 3333333), 250000); // round(249999.975)
});

test('할인 — 없으면 0', () => {
  assert.equal(computeDiscountAmount(null, 10000000), 0);
  assert.equal(computeDiscountAmount({}, 10000000), 0);
});

test('buildLine — 엔진 경로 (DISCOUNT)', () => {
  const entry = {
    item: { code: 'X', name: 'Seal', category: '솔루션', spec: null, unit: '식', pricing_type: 'DISCOUNT', qty_default: 1, recurring: 0, note: null },
    variants: [{ key: 'ENT', price: 80000000 }],
  };
  const line = buildLine(entry, { code: 'X', companyClass: 'ENT' }, 1, null);
  assert.equal(line.unit_price, 80000000);
  assert.equal(line.amount, 80000000);
  assert.equal(line.manual, false);
});

test('buildLine — 단가 override (별도협의 수기입력)', () => {
  const entry = {
    item: { code: 'Y', name: '전자계약', category: '솔루션', spec: null, unit: '식', pricing_type: 'DISCOUNT', qty_default: 1, recurring: 0, note: null },
    variants: [{ key: 'PUBLIC', price: null }],
  };
  const line = buildLine(entry, { code: 'Y', companyClass: 'PUBLIC', unit_price: 22000000 }, 1, null);
  assert.equal(line.unit_price, 22000000);
  assert.equal(line.amount, 22000000);
});

test('buildLine — 수기 라인 (코드 없음)', () => {
  const line = buildLine(undefined, { name: '커스텀 개발', qty: 2, unit_price: 5000000, unit: '식' }, 1, null);
  assert.equal(line.manual, true);
  assert.equal(line.name, '커스텀 개발');
  assert.equal(line.amount, 10000000); // 5,000,000 × 2
});

test('buildLine — 수기 라인 amount 명시 시 우선', () => {
  const line = buildLine(undefined, { name: '패키지', qty: 1, unit_price: 1000000, amount: 3000000 }, 1, null);
  assert.equal(line.amount, 3000000);
});

test('buildLine — recurring 품목은 개월 곱함 (BAND override)', () => {
  const entry = {
    item: { code: 'Z', name: 'SaaS', category: '기본', spec: null, unit: '건/월', pricing_type: 'BAND', qty_default: 100, recurring: 1, note: null },
    variants: [],
  };
  const line = buildLine(entry, { code: 'Z', unit_price: 500000, months: 12 }, 12, null);
  assert.equal(line.amount, 6000000); // 500,000 × 12개월
});
