'use strict';
// 5-B 템플릿 시드 정합성 — DB 없이 시드 JSON 자체를 검사한다.
// 목적: 블록에 없는 기본항목 키가 조용히 버려지거나, 마스터에 없는 블록/조건/역할을
//       가리키는 템플릿이 투입되는 것을 막는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const seed = require('../db/seeds/templates-seed.json');
const laborSeed = require('../db/seeds/labor-rates-seed.json');

const BLOCK_ITEM_KEY = {
  SOLUTION: 'default_items', SETUP: 'setup_default', LICENSE: 'license_default',
  SERVICE: 'service_default', DATASVC: 'datasvc_default', MAINT: 'maint_default',
};
const BLOCK_LABOR_KEY = { LABOR: 'labor_default', SETUP: 'setup_labor_default' };

const blockCodes = new Set(seed.blocks_master.map((b) => b.code));
const condCodes = new Set(seed.condition_sets.map((c) => c.code));
const roleCodes = new Set(laborSeed.labor_rate_years.find((y) => y.year === 2026).rates.map((r) => r.role_code));

test('블록 마스터는 REV 7종', () => {
  assert.deepEqual([...blockCodes].sort(),
    ['DATASVC', 'LABOR', 'LICENSE', 'SERVICE', 'SETUP', 'SOLUTION', 'SUMMARY']);
  assert.equal(seed.blocks_master.find((b) => b.code === 'SERVICE').recurring, 1);
  assert.equal(seed.blocks_master.find((b) => b.code === 'DATASVC').recurring, 1);
});

test('BUILD 템플릿 8종, code 중복 없음', () => {
  const build = seed.templates.filter((t) => t.quote_type === 'BUILD');
  assert.equal(build.length, 8);
  const codes = seed.templates.map((t) => t.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('deployment 은 REV 4종만 사용한다', () => {
  const ok = new Set(['ONPREM_LUMP', 'ONPREM_INSTALL', 'SAAS', 'PCLOUD']);
  for (const t of seed.templates) assert.ok(ok.has(t.deployment), `${t.code}: ${t.deployment}`);
});

test('모든 템플릿이 SUMMARY 블록을 포함하고, 블록은 마스터에 존재한다', () => {
  for (const t of seed.templates) {
    assert.ok(t.blocks.includes('SUMMARY'), `${t.code}: SUMMARY 누락`);
    for (const b of t.blocks) assert.ok(blockCodes.has(b), `${t.code}: 미정의 블록 ${b}`);
  }
});

test('기본항목/인건비 키가 blocks 에 없는 블록을 가리키지 않는다 (미투입 방지)', () => {
  for (const t of seed.templates) {
    for (const [bcode, key] of Object.entries(BLOCK_ITEM_KEY)) {
      if (t[key]) assert.ok(t.blocks.includes(bcode), `${t.code}: ${key} 있으나 blocks 에 ${bcode} 없음`);
    }
    for (const [bcode, key] of Object.entries(BLOCK_LABOR_KEY)) {
      if (t[key]) assert.ok(t.blocks.includes(bcode), `${t.code}: ${key} 있으나 blocks 에 ${bcode} 없음`);
    }
  }
});

test('condition_set 은 조건 마스터에 존재한다', () => {
  for (const t of seed.templates) {
    if (t.condition_set) assert.ok(condCodes.has(t.condition_set), `${t.code}: 미정의 조건세트 ${t.condition_set}`);
  }
});

test('인건비 기본의 role_code 는 임금단가 마스터에 존재한다', () => {
  for (const t of seed.templates) {
    for (const key of Object.values(BLOCK_LABOR_KEY)) {
      for (const l of t[key] || []) {
        assert.ok(roleCodes.has(l.role_code), `${t.code}: 미정의 역할 ${l.role_code}`);
        assert.ok(Number(l.mm) > 0, `${t.code}/${l.role_code}: mm 이 0`);
      }
    }
  }
});

test('solution 코드는 마스터(EXPENSE/PROCURE/SEAL)와 일치한다', () => {
  const ok = new Set(['EXPENSE', 'PROCURE', 'SEAL']);
  for (const t of seed.templates) assert.ok(ok.has(t.solution), `${t.code}: ${t.solution}`);
});

test('LABOR 블록이 있으면 인건비 기본이 있다', () => {
  for (const t of seed.templates) {
    if (t.blocks.includes('LABOR')) {
      assert.ok((t.labor_default || []).length > 0, `${t.code}: LABOR 블록인데 labor_default 없음`);
    }
  }
});

test('실측 매핑 — 전자인장 4종 블록 구성 (REV §7)', () => {
  const by = (c) => seed.templates.find((t) => t.code === c).blocks.filter((b) => b !== 'SUMMARY');
  assert.deepEqual(by('ESEAL_ONPREM_LUMP'), ['SOLUTION', 'LABOR']);
  assert.deepEqual(by('ESEAL_ONPREM_INSTALL'), ['SOLUTION', 'LABOR', 'SERVICE']);
  assert.deepEqual(by('ESEAL_SAAS'), ['SETUP', 'SERVICE']);
  assert.deepEqual(by('ESEAL_PCLOUD'), ['SETUP', 'LICENSE', 'SERVICE']);
});
