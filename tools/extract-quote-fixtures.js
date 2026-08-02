'use strict';
// 실측 재현 20종을 언어 중립 JSON 픽스처로 추출한다 (J2).
//
// ── 왜 이렇게 뽑는가 ──────────────────────────────────────────────
// 기대값을 손으로 옮겨 적지 않는다. 전사 과정에서 오타가 들어가면 이식 기준선이
// 조용히 오염되고, 그 오염을 검증할 방법이 없다.
//
// 대신 **입력만 정의하고 기대값은 엔진을 실제로 돌려 덤프한다.**
// "엔진 출력 = 실측값" 은 아래 고리로 보증된다:
//
//   ① 추출 직전 test/engine/quote-block.test.js 20/20 통과 확인
//      → 엔진 출력 == 실측 견적서 값 (하드코딩 assertion 이 증인)
//   ② 이 스크립트가 같은 엔진을 돌려 기대값을 덤프
//      → 픽스처 == 엔진 출력
//   ③ 아래 TRIPWIRE 로 CLAUDE.md §7 의 회귀 방어선 4건을 독립 검증
//      → 테스트 파일이 아니라 프로젝트 규칙 문서에서 가져온 값이다
//
//   ①②③ 을 합치면 픽스처 == 실측값. 전사 없음.
//
// 실행: node tools/extract-quote-fixtures.js
'use strict';
const fs = require('fs');
const path = require('path');
const {
  calcQuoteBlocks, calcBlock, computeDiscount, floorTo, validateMonthAlloc,
} = require('../quote/src/domain/pricing/engine');

const OUT = path.join(__dirname, '..', 'quote', 'test', 'fixtures');

// ─────────────────────────────────────────────────────────────────
// 입력 정의 — test/engine/quote-block.test.js 와 같은 구조다.
// 입력은 '구조'이므로 그대로 옮긴다. 검증 대상은 기대값이며 그것은 덤프한다.
// ─────────────────────────────────────────────────────────────────

function solbrainContract(extraSolutionRows = []) {
  return {
    round_unit: 100000,
    discount: { type: 'TARGET', value: 60000000 },
    blocks: [
      {
        block_code: 'SOLUTION', recurring: 0,
        items: [
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

function solbrainSeal() {
  const seal = { item_code: 'POA_SEAL', category: '전자인장관리솔루션', name: 'Poa Seal™', qty: 1, base_price: 20000000, proposed_price: 20000000 };
  const body = solbrainContract([seal]);
  body.discount = { type: 'TARGET', value: 80000000 };
  return body;
}

function skEternix() {
  return {
    round_unit: 100000,
    discount: { type: 'TARGET', value: 100000000 },
    blocks: [
      {
        block_code: 'SETUP', recurring: 0,
        items: [
          { item_code: 'ESEAL_PC_SETUP', category: '전자인장시스템', name: '클라우드 셋업', qty: 3.7, unit: 'MM', base_price: 19540395, proposed_price: 12000000 },
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

function hagenDazs() {
  return {
    round_unit: 100000,
    discount: { type: 'TARGET', value: 0 },
    monthly_discount: { type: 'TARGET', value: 100000 },
    blocks: [
      {
        block_code: 'SETUP', recurring: 0,
        items: [{ item_code: 'ESEAL_SAAS_SETUP', category: '전자인장관리솔루션(Easy Seal™)', name: 'SaaS 셋업',
          qty: 0.4, unit: 'MM', base_price: 10000000, proposed_price: 5000000 }],
      },
      {
        block_code: 'SERVICE', recurring: 1,
        items: [{ item_code: 'ESEAL_SAAS_BASE', category: '전자인장관리솔루션(Easy Seal™)', name: '전자인장 서비스 이용료',
          qty: 1, base_price: 500000, proposed_price: 300000 }],
      },
    ],
  };
}

function solbrainWithAllocError() {
  const body = solbrainContract();
  body.blocks[1].labor[0].month_alloc = { M: 0.9 }; // mm 1.0 과 불일치
  return body;
}

const ONP = 'assets/인장/전자인장_온프레미스.pdf';
const PCLOUD = 'assets/인장/전자인장_프라이빗클라우드.pdf';
const SAAS = 'assets/인장/전자인장_SaaS.pdf';

// ── kind=QUOTE : calcQuoteBlocks 전체 ─────────────────────────────
const QUOTE_CASES = [
  { caseId: 'solbrain-contract', description: '실측 솔브레인 전자계약 — 솔루션 50,000,000 + 인건비 36,600,000 = 86,600,000 → 특별DC → 60,000,000',
    source: `${ONP} QT20260728_001`, input: solbrainContract() },
  { caseId: 'solbrain-seal', description: '실측 솔브레인 전자인장계약 — Poa Seal 20,000,000 가산 → 솔루션 70,000,000 / Total 106,600,000 → 80,000,000',
    source: `${ONP} QT20260728_002`, input: solbrainSeal() },
  { caseId: 'sk-pcloud', description: '실측 SK이터닉스 PCloud — 일시납 104,400,000 → 100,000,000 / 월 1,275,000',
    source: `${PCLOUD} QT20260506_001`, input: skEternix() },
  { caseId: 'sk-pcloud-recurring-separated', description: 'recurring 블록은 일시불 합계에 섞이지 않는다',
    source: `${PCLOUD} QT20260506_001`, input: skEternix() },
  { caseId: 'hagendazs-saas', description: '실측 하겐다즈 SaaS — 셋업 2,000,000 → 무상제공(0) / 월 300,000 → 100,000',
    source: `${SAAS} QT20260415_002`, input: hagenDazs() },
  { caseId: 'sk-pcloud-no-monthly-discount', description: '월 특별DC 가 없으면 월 소계가 그대로 유지된다',
    source: `${PCLOUD} QT20260506_001`, input: skEternix() },
  { caseId: 'monthly-not-floored', description: '월 금액은 절사하지 않는다 — 밴드 금액 150,000 이 십만절사되면 100,000 이 되어 밴드가 깨진다',
    source: '규약 (CLAUDE.md §6)',
    input: { round_unit: 100000, blocks: [{ block_code: 'SERVICE', recurring: 1, items: [{ qty: 1, proposed_price: 150000 }] }] } },
  { caseId: 'calc-order-fixed', description: '계산 순서 고정 — 소계합 → 특별DC → 절사. 절사를 먼저 하면 값이 달라진다',
    source: '규약 (CLAUDE.md §6)',
    input: { round_unit: 100000, discount: { type: 'AMOUNT', value: 1234567 },
      blocks: [{ block_code: 'SOLUTION', recurring: 0, items: [{ qty: 1, proposed_price: 98765432 }] }] } },
  { caseId: 'solbrain-no-discount', description: 'DC 없으면 소계합이 그대로(절사만) 최종금액',
    source: `${ONP} QT20260728_001 변형`,
    input: (() => { const b = solbrainContract(); b.discount = null; return b; })() },
  { caseId: 'labor-errors-surfaced', description: 'calcQuoteBlocks 가 labor_errors 를 함께 반환한다 — 검증 오류가 있어도 금액 계산은 수행',
    source: `${ONP} QT20260728_001 변형`, input: solbrainWithAllocError() },
  { caseId: 'empty-quote', description: '빈 견적 — 0원, 오류 없음', source: '경계 사례', input: {} },
];

// ── kind=BLOCK : calcBlock 단일 블록 ──────────────────────────────
const BLOCK_CASES = [
  { caseId: 'solbrain-labor-block', description: '인건비 라인 — 제안단가 × 공수 (실측 3.2MM = 36,600,000)',
    source: `${ONP} QT20260728_001`, input: solbrainContract().blocks[1] },
  { caseId: 'pcloud-setup-block', description: 'PCloud 셋업 — MM 기반 수량 (3.7 × 12,000,000), 수량 0 라인은 0원',
    source: `${PCLOUD} QT20260506_001`, input: skEternix().blocks[0] },
];

// ── kind=DISCOUNT : computeDiscount ───────────────────────────────
const DISCOUNT_CASES = [
  { caseId: 'discount-modes', description: '특별DC 3종 — AMOUNT / RATE / TARGET, 미입력, 목표가가 소계보다 큰 경우',
    source: '규약 (CLAUDE.md §6)',
    input: [
      { label: 'AMOUNT 5,000,000', discount: { type: 'AMOUNT', value: 5000000 }, base: 86600000 },
      { label: 'RATE 10%', discount: { type: 'RATE', value: 10 }, base: 86600000 },
      { label: 'TARGET 60,000,000', discount: { type: 'TARGET', value: 60000000 }, base: 86600000 },
      { label: 'DC 없음(null)', discount: null, base: 86600000 },
      { label: 'TARGET 이 소계보다 큼', discount: { type: 'TARGET', value: 90000000 }, base: 86600000 },
    ] },
];

// ── kind=FLOOR : floorTo ─────────────────────────────────────────
const FLOOR_CASES = [
  { caseId: 'floor-100k', description: '십만단위 절사 — floor 이며 반올림이 아니다. unit 0 이면 절사하지 않는다',
    source: '규약 (CLAUDE.md §6)',
    input: [
      { label: '60,099,999 → 절사', amount: 60099999, unit: 100000 },
      { label: '60,100,000 → 그대로', amount: 60100000, unit: 100000 },
      { label: '86,600,000 → 그대로', amount: 86600000, unit: 100000 },
      { label: 'unit 0 이면 절사 안 함', amount: 60099999, unit: 0 },
    ] },
];

// ── kind=MONTH_ALLOC : validateMonthAlloc (+ 월별 합계) ───────────
const MONTH_ALLOC_CASES = [
  { caseId: 'sk-manpower-plan', description: '실측 SK이터닉스 인력투입계획 — 합계 3.70 MM, 월별 합계 0.25 / 1.20 / 1.50 / 0.75',
    source: `${PCLOUD} 3페이지 인력투입계획표`,
    input: [
      { role_code: 'CONSULTANT', role_label: '컨설턴트', mm: 1.00, month_alloc: { M: 0.25, M1: 0.25, M2: 0.25, M3: 0.25 } },
      { role_code: 'DEV', role_label: '개발#1', mm: 1.50, month_alloc: { M1: 0.50, M2: 0.75, M3: 0.25 } },
      { role_code: 'DEV', role_label: '개발#2', mm: 1.00, month_alloc: { M1: 0.25, M2: 0.50, M3: 0.25 } },
      { role_code: 'SUPPORT', role_label: '기술지원', mm: 0.20, month_alloc: { M1: 0.20 } },
    ] },
  { caseId: 'solbrain-manpower-plan', description: '실측 솔브레인 인력투입계획 — 합계 3.20 MM (M 0.25 / M1 1.45 / M2 0.75 / M3 0.75)',
    source: `${ONP} 인력투입계획표`,
    input: [
      { role_code: 'PM', mm: 1.00, month_alloc: { M: 0.25, M1: 0.25, M2: 0.25, M3: 0.25 } },
      { role_code: 'DEV', mm: 2.00, month_alloc: { M1: 1.00, M2: 0.50, M3: 0.50 } },
      { role_code: 'SUPPORT', mm: 0.20, month_alloc: { M1: 0.20 } },
    ] },
  { caseId: 'alloc-sum-mismatch', description: '월별 배분 합계가 공수와 다르면 오류로 잡는다',
    source: '규약', input: [{ role_code: 'PM', role_label: 'PM', mm: 1.0, month_alloc: { M: 0.25, M1: 0.25 } }] },
  { caseId: 'alloc-json-string', description: 'month_alloc 은 JSON 문자열도 허용 (DB 저장값 그대로 검증)',
    source: '규약', input: [{ role_code: 'PM', mm: 1.0, month_alloc: '{"M":0.5,"M1":0.5}' }] },
  { caseId: 'alloc-absent', description: 'month_alloc 없으면 검증 통과 (옵션 기능)',
    source: '규약', input: [{ role_code: 'PM', mm: 1.0 }] },
];

// ─────────────────────────────────────────────────────────────────
// 기대값 덤프
// ─────────────────────────────────────────────────────────────────

const round2 = (n) => Number(n.toFixed(2));

function dumpQuote(input) {
  const r = calcQuoteBlocks(input);
  return {
    block_subtotals: r.blocks.map((b) => ({ block_code: b.block_code, recurring: b.recurring ? 1 : 0, subtotal: b.subtotal })),
    onetime_subtotal: r.onetime_subtotal,
    monthly_subtotal: r.monthly_subtotal,
    discount_amount: r.discount_amount,
    monthly_discount_amount: r.monthly_discount_amount,
    round_unit: r.round_unit,
    rounding_adjustment: r.rounding_adjustment,
    onetime_total: r.onetime_total,
    monthly_total: r.monthly_total,
    vat_amount: r.vat_amount,
    monthly_vat: r.monthly_vat,
    total_amount: r.total_amount,
    supply_amount: r.supply_amount,
    labor_errors: r.labor_errors,
  };
}

function dumpBlock(input) {
  const b = calcBlock(input);
  const isLabor = input.block_code === 'LABOR';
  const rows = isLabor ? b.labor : b.items;
  return {
    block_code: b.block_code,
    recurring: b.recurring ? 1 : 0,
    subtotal: b.subtotal,
    line_amounts: rows.map((r) => r.amount),
    // LABOR 는 공수 합계도 함께 본다 (실측 3.2 / 3.7 MM)
    mm_total: isLabor ? round2(rows.reduce((a, r) => a + Number(r.mm || 0), 0)) : null,
  };
}

function dumpDiscount(cases) {
  return cases.map((c) => ({ label: c.label, amount: computeDiscount(c.discount, c.base) }));
}

function dumpFloor(cases) {
  return cases.map((c) => ({ label: c.label, result: floorTo(c.amount, c.unit) }));
}

function dumpMonthAlloc(labor) {
  const errors = validateMonthAlloc(labor);
  const byMonth = {};
  for (const l of labor) {
    const raw = l.month_alloc;
    if (!raw) continue;
    const alloc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const [m, v] of Object.entries(alloc)) byMonth[m] = (byMonth[m] || 0) + Number(v);
  }
  for (const k of Object.keys(byMonth)) byMonth[k] = round2(byMonth[k]);
  return {
    errors,
    error_count: errors.length,
    mm_total: round2(labor.reduce((a, l) => a + Number(l.mm || 0), 0)),
    month_totals: byMonth,
  };
}

// ─────────────────────────────────────────────────────────────────
// TRIPWIRE — CLAUDE.md §7 '회귀 방어선' 4건.
// 테스트 파일이 아니라 프로젝트 규칙 문서에서 가져온 값이며, 덤프가 실측과
// 어긋나면 여기서 즉시 멈춘다. 이 4건이 픽스처 신뢰의 독립 근거다.
// ─────────────────────────────────────────────────────────────────
const TRIPWIRE = [
  ['solbrain-contract', 'onetime_total', 60000000],
  ['solbrain-seal', 'onetime_total', 80000000],
  ['sk-pcloud', 'onetime_total', 100000000],
  ['sk-pcloud', 'monthly_total', 1275000],
  ['hagendazs-saas', 'onetime_total', 0],
  ['hagendazs-saas', 'monthly_total', 100000],
];

function build() {
  const quote = QUOTE_CASES.map((c) => ({ ...c, kind: 'QUOTE', expected: dumpQuote(c.input) }));
  const block = BLOCK_CASES.map((c) => ({ ...c, kind: 'BLOCK', expected: dumpBlock(c.input) }));
  const discount = DISCOUNT_CASES.map((c) => ({ ...c, kind: 'DISCOUNT', expected: dumpDiscount(c.input) }));
  const floor = FLOOR_CASES.map((c) => ({ ...c, kind: 'FLOOR', expected: dumpFloor(c.input) }));
  const alloc = MONTH_ALLOC_CASES.map((c) => ({ ...c, kind: 'MONTH_ALLOC', expected: dumpMonthAlloc(c.input) }));

  // TRIPWIRE 검사
  const byId = Object.fromEntries(quote.map((c) => [c.caseId, c]));
  const failed = [];
  for (const [id, field, want] of TRIPWIRE) {
    const got = byId[id]?.expected?.[field];
    if (got !== want) failed.push(`${id}.${field}: 기대 ${want} vs 덤프 ${got}`);
  }
  if (failed.length) {
    console.error('TRIPWIRE 실패 — 덤프가 CLAUDE.md §7 회귀 방어선과 어긋난다:');
    failed.forEach((f) => console.error('  ' + f));
    process.exit(1);
  }
  console.log(`TRIPWIRE ${TRIPWIRE.length}건 통과 (CLAUDE.md §7 회귀 방어선)`);

  return { quote, block, discount, floor, alloc };
}

function write(name, data) {
  const dir = path.join(OUT, 'engine');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  ${path.relative(path.join(__dirname, '..'), file)}  ${data.length}건`);
}

if (require.main === module) {
  const { quote, block, discount, floor, alloc } = build();
  console.log('\n픽스처 생성:');
  write('quote-cases.json', quote);
  write('block-cases.json', block);
  write('discount-cases.json', discount);
  write('floor-cases.json', floor);
  write('month-alloc-cases.json', alloc);
  const total = quote.length + block.length + discount.length + floor.length + alloc.length;
  console.log(`\n총 ${total}종 (QUOTE ${quote.length} · BLOCK ${block.length} · DISCOUNT ${discount.length} · FLOOR ${floor.length} · MONTH_ALLOC ${alloc.length})`);
  if (total !== 20) {
    console.error(`실측 재현은 20종이어야 한다 — 현재 ${total}종`);
    process.exit(1);
  }
}

module.exports = { build };
