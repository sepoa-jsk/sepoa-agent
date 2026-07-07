'use strict';
// 견적 계산 엔진 단위 테스트 (Phase 1 완료 기준)
// 실제 시드 데이터(seed/pricing-seed.json)로 엔진을 검증한다. DB 불필요.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { calcLine, calcTotals, resolveUnitPrice } = require('../lib/quote-engine');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'pricing-seed.json'), 'utf8'));
const byCode = new Map(seed.items.map((it) => [it.code, it]));

function line(code, opts) {
  const it = byCode.get(code);
  assert.ok(it, `시드에 코드 ${code} 없음`);
  return calcLine(it, it.variants || [], opts);
}

test('전자인장 SaaS 월 200건 → 월 500,000원 (BAND)', () => {
  const r = line('ESEAL_SAAS', { qty: 200, months: 1 });
  assert.equal(r.needNegotiation, false);
  assert.equal(r.unitPrice, 500000);
  assert.equal(r.amount, 500000); // BAND: 구간단가=월액, 수량 곱하지 않음
});

test('전자구매 ONPREM PM 1 M/M, LARGE_R(적용율 0.7) → 17,500,000원 (MM)', () => {
  const r = line('MM_PM', { companyClass: 'LARGE_R', qty: 1 });
  assert.equal(r.needNegotiation, false);
  assert.equal(r.unitPrice, 17500000); // 25,000,000 × 0.7
  assert.equal(r.amount, 17500000);
});

test('MM: 적용율 × M/M 수량 반영 (0.5 M/M)', () => {
  const r = line('MM_PM', { companyClass: 'LARGE_R', qty: 0.5 });
  assert.equal(r.unitPrice, 17500000);
  assert.equal(r.amount, 8750000); // 17,500,000 × 0.5
});

test('BAND 경계값 — 구간 하한/상한이 정확히 매핑된다', () => {
  const cases = [
    [50, 250000],   // 0~50
    [51, 300000],   // 51~100
    [100, 300000],
    [101, 500000],  // 101~200
    [200, 500000],
    [201, 700000],  // 201~400
    [400, 700000],
    [401, 1000000], // 401~800
    [800, 1000000],
  ];
  for (const [qty, expected] of cases) {
    const r = line('ESEAL_SAAS', { qty, months: 1 });
    assert.equal(r.amount, expected, `qty=${qty}`);
  }
});

test('BAND 구간 초과 → 별도협의(needNegotiation)', () => {
  const r = line('ESEAL_SAAS', { qty: 900, months: 1 }); // max 800 초과
  assert.equal(r.needNegotiation, true);
  assert.equal(r.amount, 0);
});

test('별도협의 NULL 처리 — DISCOUNT variant.price=null (전자계약 공공기관)', () => {
  const r = line('POA_ECONTRACT', { companyClass: 'PUBLIC', qty: 1 });
  assert.equal(r.needNegotiation, true);
  assert.equal(r.amount, 0);
});

test('DISCOUNT — 기업구분별 확정 단가 (POA Seal ENT 8천만)', () => {
  const r = line('POA_SEAL', { companyClass: 'ENT', qty: 1 });
  assert.equal(r.unitPrice, 80000000);
  assert.equal(r.amount, 80000000);
});

test('DISCOUNT — 존재하지 않는 기업구분 → 별도협의', () => {
  const r = line('POA_SEAL', { companyClass: 'NOPE', qty: 1 });
  assert.equal(r.needNegotiation, true);
});

test('FIXED — base_price × 수량 (용량추가 5만 × 3 = 15만)', () => {
  const r = line('ESEAL_STORAGE', { qty: 3, months: 1 });
  assert.equal(r.unitPrice, 50000);
  assert.equal(r.amount, 150000);
});

test('recurring=1 → 계약개월(months) 곱한다 (BAND 월 500,000 × 12 = 600만)', () => {
  const r = line('ESEAL_SAAS', { qty: 200, months: 12 });
  assert.equal(r.amount, 6000000);
});

test('recurring=0 → months 무시 (셋업비 등)', () => {
  const r = line('ESEAL_SETUP', { qty: 1, months: 12 }); // FIXED 200만, recurring 0
  assert.equal(r.amount, 2000000);
});

test('resolveUnitPrice — BAND label 반환', () => {
  const it = byCode.get('ESEAL_SAAS');
  const r = resolveUnitPrice(it, it.variants, { qty: 200 });
  assert.equal(r.bandLabel, '월 200건');
});

test('calcTotals — VAT 10%, (공급가 − 할인) × 1.1', () => {
  const lines = [{ amount: 10000000 }, { amount: 5000000 }];
  const t = calcTotals(lines, 1000000);
  assert.equal(t.supply, 15000000);
  assert.equal(t.discount, 1000000);
  assert.equal(t.vat, 1400000);   // (15,000,000 − 1,000,000) × 0.1
  assert.equal(t.total, 15400000);
});
