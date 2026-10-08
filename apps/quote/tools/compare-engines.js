'use strict';
// 병행 대조 — Node 엔진과 Java 엔진이 같은 입력에 같은 값을 내는지 필드 단위로 비교한다.
//
// J3 에서 만들었고 **J4~J7 에서 재사용한다.** 일회성 스크립트가 아니다.
// quote/ 가 삭제된 뒤에도 살아남도록 tools/ 에 둔다.
//
// ── 무엇을 대조하나 ──────────────────────────────────────────────
// 픽스처 20종을 양쪽 엔진에 넣고 산출값을 **문자열로 정규화해** 비교한다.
// 숫자로 비교하면 JS 의 double 과 Java 의 BigDecimal 이 서로 다른 표기를 내도
// == 로 같아 보일 수 있고, 반대로 1000 과 1000.00 이 다르게 보일 수도 있다.
// 양쪽 다 "뒤따르는 0 을 뗀 평문 십진수" 로 맞춘 뒤 문자열 비교한다.
//
// ── 사용 ────────────────────────────────────────────────────────
//   node tools/compare-engines.js              전체 대조 (Java 덤프 자동 생성)
//   node tools/compare-engines.js --node-only  Node 산출값만 덤프해 출력
//   node tools/compare-engines.js --verbose    일치 항목도 전부 출력
//
// 불일치가 하나라도 있으면 종료코드 1.
//
// ── quote/ 삭제 후 ──────────────────────────────────────────────
// Node 엔진이 사라지면 이 스크립트의 Node 쪽은 돌지 않는다. 그때는 --java-only 로
// Java 산출값이 픽스처 기대값과 맞는지만 본다(그 검사는 JUnit 이 이미 한다).
// 즉 이 도구의 수명은 Node 가 살아 있는 동안이며, 그것이 삭제 시점 판단의 근거 중 하나다.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE_ENGINE = path.join(ROOT, '..', 'quote-legacy', 'src', 'domain', 'pricing', 'engine.js');
const FIXTURES = path.join(ROOT, '..', 'quote-legacy', 'test', 'fixtures', 'engine');
const JAVA_DIR = ROOT;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

// ── 정규화 ───────────────────────────────────────────────────────
// 양쪽 산출값을 같은 문자열 표기로 만든다.
function norm(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`유한하지 않은 수: ${v}`);
    // 뒤따르는 0 제거 + 지수표기 금지
    return stripZeros(v.toFixed(10));
  }
  if (typeof v === 'string') {
    // Java 쪽은 이미 평문 십진수 문자열이다
    return /^-?\d+(\.\d+)?$/.test(v) ? stripZeros(v) : v;
  }
  return String(v);
}

function stripZeros(s) {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

// ── Node 산출값 덤프 ─────────────────────────────────────────────
function dumpNode() {
  if (!fs.existsSync(NODE_ENGINE)) {
    throw new Error(
      `Node 엔진이 없다: ${NODE_ENGINE}\n` +
      `quote/ 가 삭제된 뒤라면 병행 대조는 성립하지 않는다. JUnit 이 픽스처 검증을 대신한다.`);
  }
  const engine = require(NODE_ENGINE);
  const load = (f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));

  const out = {};

  out.quote = load('quote-cases.json').map((c) => {
    const r = engine.calcQuoteBlocks(c.input);
    return {
      caseId: c.caseId,
      block_subtotals: r.blocks.map((b) => ({
        block_code: b.block_code, recurring: b.recurring ? 1 : 0, subtotal: norm(b.subtotal),
      })),
      onetime_subtotal: norm(r.onetime_subtotal),
      monthly_subtotal: norm(r.monthly_subtotal),
      discount_amount: norm(r.discount_amount),
      monthly_discount_amount: norm(r.monthly_discount_amount),
      round_unit: norm(r.round_unit),
      rounding_adjustment: norm(r.rounding_adjustment),
      onetime_total: norm(r.onetime_total),
      monthly_total: norm(r.monthly_total),
      vat_amount: norm(r.vat_amount),
      monthly_vat: norm(r.monthly_vat),
      total_amount: norm(r.total_amount),
      supply_amount: norm(r.supply_amount),
      labor_errors: r.labor_errors.map((e) => ({
        role_code: e.role_code, mm: norm(e.mm), alloc_sum: norm(e.alloc_sum), message: e.message,
      })),
    };
  });

  out.block = load('block-cases.json').map((c) => {
    const b = engine.calcBlock(c.input);
    const isLabor = c.input.block_code === 'LABOR';
    const rows = isLabor ? b.labor : b.items;
    return {
      caseId: c.caseId,
      block_code: b.block_code,
      recurring: b.recurring ? 1 : 0,
      subtotal: norm(b.subtotal),
      line_amounts: rows.map((r) => norm(r.amount)),
      mm_total: isLabor ? norm(rows.reduce((a, r) => a + Number(r.mm || 0), 0)) : null,
    };
  });

  out.discount = load('discount-cases.json').map((c) => ({
    caseId: c.caseId,
    rows: c.input.map((i) => ({ label: i.label, amount: norm(engine.computeDiscount(i.discount, i.base)) })),
  }));

  out.floor = load('floor-cases.json').map((c) => ({
    caseId: c.caseId,
    rows: c.input.map((i) => ({ label: i.label, result: norm(engine.floorTo(i.amount, i.unit)) })),
  }));

  out.monthAlloc = load('month-alloc-cases.json').map((c) => {
    const errors = engine.validateMonthAlloc(c.input);
    const by = {};
    for (const l of c.input) {
      const raw = l.month_alloc;
      if (!raw) continue;
      const alloc = typeof raw === 'string' ? JSON.parse(raw) : raw;
      for (const [m, v] of Object.entries(alloc)) by[m] = (by[m] || 0) + Number(v);
    }
    const totals = {};
    for (const k of Object.keys(by)) totals[k] = norm(by[k]);
    return {
      caseId: c.caseId,
      errors: errors.map((e) => ({
        role_code: e.role_code, mm: norm(e.mm), alloc_sum: norm(e.alloc_sum), message: e.message,
      })),
      error_count: errors.length,
      mm_total: norm(c.input.reduce((a, l) => a + Number(l.mm || 0), 0)),
      month_totals: totals,
    };
  });

  return out;
}

// ── Java 산출값 덤프 ─────────────────────────────────────────────
function dumpJava() {
  const outFile = path.join(os.tmpdir(), `quote-java-dump-${process.pid}.json`);
  // 절대 경로로 부른다. cwd 를 바꿔도 PATH 해석에 기대지 않기 위함이다
  // (Windows 에서 'mvnw.cmd' 만 주면 현재 디렉터리를 뒤지지 않아 실패한다).
  const mvnw = path.join(JAVA_DIR, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');

  process.stdout.write('Java 엔진 덤프 생성 중 (mvnw test-compile + exec) ... ');
  // 테스트 클래스패스를 파일로 뽑고, 그 클래스패스로 덤프 도구를 직접 실행한다.
  // exec-maven-plugin 을 pom 에 추가하지 않으려는 것이다 — J1 최소 의존성 방침 유지.
  const cpFile = path.join(os.tmpdir(), `quote-java-cp-${process.pid}.txt`);
  execFileSync(mvnw, ['-q', 'test-compile',
    'dependency:build-classpath', `-Dmdep.outputFile=${cpFile}`, '-Dmdep.includeScope=test'],
    { cwd: JAVA_DIR, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });

  const deps = fs.readFileSync(cpFile, 'utf8').trim();
  const sep = process.platform === 'win32' ? ';' : ':';
  const cp = [
    path.join(JAVA_DIR, 'target', 'test-classes'),
    path.join(JAVA_DIR, 'target', 'classes'),
    deps,
  ].join(sep);

  execFileSync('java', ['-cp', cp, 'kr.co.sepoasoft.quote.domain.pricing.FixtureDumpMain', outFile],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('완료');

  const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  fs.unlinkSync(outFile);
  fs.unlinkSync(cpFile);

  // Java 쪽 숫자도 같은 규칙으로 정규화한다.
  return normalizeDeep(data);
}

function normalizeDeep(v) {
  if (Array.isArray(v)) return v.map(normalizeDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = normalizeDeep(val);
    return o;
  }
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return stripZeros(v);
  if (typeof v === 'number') return norm(v);
  return v;
}

// ── 비교 ─────────────────────────────────────────────────────────
function diff(a, b, prefix, out) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (String(a) !== String(b)) out.push({ path: prefix, node: a, java: b });
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path: prefix, node: `array=${Array.isArray(a)}`, java: `array=${Array.isArray(b)}` });
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      out.push({ path: `${prefix}.length`, node: a.length, java: b.length });
      return;
    }
    a.forEach((x, i) => diff(x, b[i], `${prefix}[${i}]`, out));
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diff(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
}

// ── 실행 ─────────────────────────────────────────────────────────
function main() {
  const node = dumpNode();

  if (has('--node-only')) {
    console.log(JSON.stringify(node, null, 2));
    return 0;
  }

  const java = dumpJava();

  const groups = ['quote', 'block', 'discount', 'floor', 'monthAlloc'];
  let total = 0, matched = 0;
  const rows = [];

  for (const g of groups) {
    const n = node[g] || [];
    const j = java[g] || [];
    const byId = new Map(j.map((x) => [x.caseId, x]));
    for (const nc of n) {
      total++;
      const jc = byId.get(nc.caseId);
      const mismatches = [];
      if (!jc) {
        mismatches.push({ path: '(케이스 없음)', node: nc.caseId, java: undefined });
      } else {
        diff(nc, jc, '', mismatches);
      }
      if (mismatches.length === 0) matched++;
      rows.push({ group: g, caseId: nc.caseId, mismatches });
    }
  }

  console.log('\n병행 대조 — Node 엔진 vs Java 엔진\n');
  const w = Math.max(...rows.map((r) => r.caseId.length), 8);
  for (const r of rows) {
    const ok = r.mismatches.length === 0;
    if (ok && !has('--verbose')) {
      console.log(`  일치   [${r.group}] ${r.caseId}`);
    } else if (ok) {
      console.log(`  일치   [${r.group}] ${r.caseId.padEnd(w)}`);
    } else {
      console.log(`  불일치 [${r.group}] ${r.caseId.padEnd(w)}  ${r.mismatches.length}건`);
      for (const m of r.mismatches.slice(0, 10)) {
        console.log(`           ${m.path}: Node=${JSON.stringify(m.node)} Java=${JSON.stringify(m.java)}`);
      }
    }
  }

  console.log(`\n${matched} / ${total} 일치`);
  if (matched !== total) {
    console.error('\n불일치가 있다. 픽스처가 아니라 엔진을 고칠 것.');
    return 1;
  }
  if (total !== 20) {
    console.error(`\n대조 케이스가 20종이어야 한다 — 현재 ${total}종`);
    return 1;
  }
  console.log('전 케이스 일치. 두 엔진이 같은 입력에 같은 값을 낸다.');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error('대조 실패:', e.message);
    process.exit(1);
  }
}

module.exports = { dumpNode, norm };
