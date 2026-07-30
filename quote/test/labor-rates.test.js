'use strict';
// 5-A 임금단가 마스터 검증 — DB 없이 시드 JSON 자체를 검사한다.
// 근거: 한국SW산업협회 평균임금표 산정식. 견적서 5p 근거표(실측)와 일치해야 한다.
//   평균임금(M/M) = 노임단가(M/D) × 20.5
//   제경비        = 평균임금 × 110%
//   기술료        = (평균임금 + 제경비) × 20%
//   적용단가      = 평균임금 + 제경비 + 기술료
// 중간값을 반올림하지 않고 누적한 뒤 마지막에 반올림하므로 표기값과 ±1 오차를 허용한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const seed = require('../seed/labor-rates-seed.json');

const y2026 = seed.labor_rate_years.find((y) => y.year === 2026);
const byRole = (code) => y2026.rates.find((r) => r.role_code === code);

test('2026 연도가 존재하고 active 는 정확히 1개', () => {
  assert.ok(y2026, '2026 임금단가 연도가 시드에 있어야 한다');
  const actives = seed.labor_rate_years.filter((y) => y.active);
  assert.equal(actives.length, 1);
  assert.equal(actives[0].year, 2026);
});

test('role_code 는 연도별로 중복되지 않는다 (UNIQUE(year_id, role_code))', () => {
  for (const y of seed.labor_rate_years) {
    const codes = y.rates.map((r) => r.role_code);
    assert.equal(new Set(codes).size, codes.length, `${y.year}년 role_code 중복`);
  }
});

test('2026 산정식 재현 — 7개 역할 전부 ±1 이내', () => {
  assert.equal(y2026.rates.length, 7);
  for (const r of y2026.rates) {
    const wageMm = r.wage_md * 20.5;
    const overhead = wageMm * 1.1;
    const techFee = (wageMm + overhead) * 0.2;
    const apply = wageMm + overhead + techFee;
    const near = (calc, seeded, label) =>
      assert.ok(Math.abs(Math.round(calc) - seeded) <= 1,
        `${r.role_code} ${label}: 산정 ${Math.round(calc)} vs 시드 ${seeded}`);
    near(wageMm, r.wage_mm, 'wage_mm');
    near(overhead, r.overhead, 'overhead');
    near(techFee, r.tech_fee, 'tech_fee');
    near(apply, r.apply_price, 'apply_price');
  }
});

test('실측 기준값 — IT PM 적용단가 25,418,735', () => {
  assert.equal(byRole('PM').apply_price, 25418735);
  assert.equal(byRole('PM').wage_md, 492039);
});

test('견적 인건비가 참조하는 역할 7종이 모두 시드에 있다', () => {
  for (const code of ['PM', 'DEV', 'UIUX', 'QA', 'CONSULTANT', 'ARCHITECT', 'SUPPORT']) {
    const r = byRole(code);
    assert.ok(r, `${code} 누락`);
    assert.ok(r.apply_price > 0, `${code} apply_price 미확정`);
  }
});

test('이력 연도(2025)는 노임단가만 있고 active 가 아니다', () => {
  const y2025 = seed.labor_rate_years.find((y) => y.year === 2025);
  assert.ok(y2025);
  assert.equal(y2025.active, 0);
  for (const r of y2025.rates) assert.ok(r.wage_md > 0, `${r.role_code} wage_md 누락`);
});
