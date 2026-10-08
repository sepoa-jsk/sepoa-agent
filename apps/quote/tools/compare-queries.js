'use strict';
// 조회 대조 — Node 의 loadQuote 와 Java Repository 가 같은 견적을 같은 값으로 읽는지 확인한다.
//
// J4 에서 만들었고 J5~J7 에서 재사용한다. tools/compare-engines.js 와 짝이다
// (그쪽은 계산, 이쪽은 조회).
//
// ── 정본은 Node 다 ──────────────────────────────────────────────
// 불일치가 나오면 Java 를 고친다. Node 는 실제로 운영되어 온 구현이다.
//
// ── 차이가 나기 쉬운 지점 ────────────────────────────────────────
//   NULL vs 빈 문자열   — 양쪽 다 null 로 둔다. 0 이나 '' 으로 바꾸지 말 것
//   DATETIME 포맷       — 양쪽 다 'YYYY-MM-DD HH:mm:ss'. 타임존 변환 금지
//   DECIMAL 스케일      — 뒤따르는 0 을 떼고 평문 십진수 문자열로 비교 (1000 vs 1000.00)
//   BIGINT 정밀도       — mysql2 에 bigNumberStrings 를 켜 정밀도 손실을 막는다
//   boolean vs tinyint  — block.recurring 은 Node 가 !!v 로 낸다. Java 도 boolean 으로 맞춤
//
// ── 사용 ────────────────────────────────────────────────────────
//   node tools/compare-queries.js              전체 대조
//   node tools/compare-queries.js --node-only  Node 조회 결과만 출력
//
// 불일치가 하나라도 있으면 종료코드 1.
//
// 위험도: 안전 (양쪽 다 SELECT 만 한다. 쓰기 경로 없음)

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QUOTE_DIR = path.join(ROOT, 'quote');
const JAVA_DIR = path.join(ROOT, 'quote_automation');

require(path.join(QUOTE_DIR, 'node_modules', 'dotenv')).config({ path: path.join(QUOTE_DIR, '.env') });
const mysql = require(path.join(QUOTE_DIR, 'node_modules', 'mysql2', 'promise'));

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

const pad2 = (n) => String(n).padStart(2, '0');

/** 뒤따르는 0 을 뗀 평문 십진수. null 은 null 로 둔다. */
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** DATE → 'YYYY-MM-DD'. dateStrings 를 켜므로 이미 문자열이다. */
function dateOnly(v) {
  if (v == null) return null;
  return String(v).slice(0, 10);
}

/** DATETIME → 'YYYY-MM-DD HH:mm:ss'. */
function ts(v) {
  if (v == null) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 19);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// ── Node 조회 ────────────────────────────────────────────────────
async function dumpNode() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: +process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    charset: 'utf8mb4',
    dateStrings: true,        // 타임존 이동 방지 — Java 쪽과 같은 문자열을 얻는다
    supportBigNumbers: true,
    bigNumberStrings: true,   // BIGINT 정밀도 손실 방지
  });
  const q = async (sql, p = []) => (await conn.query(sql, p))[0];

  const item = (i) => ({
    id: Number(i.id), section_id: Number(i.section_id),
    block_id: i.block_id == null ? null : Number(i.block_id),
    item_code: i.item_code, category: i.category, block_code: i.block_code,
    name: i.name, spec: i.spec, qty: num(i.qty), unit: i.unit,
    months: i.months == null ? null : Number(i.months),
    unit_price: num(i.unit_price), base_price: num(i.base_price),
    proposed_price: num(i.proposed_price), amount: num(i.amount),
    note: i.note, sort: i.sort == null ? null : Number(i.sort),
  });
  const labor = (l) => ({
    id: Number(l.id), section_id: Number(l.section_id),
    block_id: l.block_id == null ? null : Number(l.block_id),
    role_code: l.role_code, role_name: l.role_name, role_label: l.role_label,
    grade: l.grade, task: l.task, mm: num(l.mm),
    base_price: num(l.base_price), proposed_price: num(l.proposed_price), amount: num(l.amount),
    month_alloc: l.month_alloc, sort: l.sort == null ? null : Number(l.sort),
  });

  try {
    const ids = (await q('SELECT id FROM sq_quotes ORDER BY id')).map((r) => Number(r.id));
    const quotes = [];

    for (const id of ids) {
      // ── Node loadQuote 와 같은 순서·같은 정렬 ──
      const [h] = await q('SELECT * FROM sq_quotes WHERE id = ?', [id]);
      const sections = await q('SELECT * FROM sq_quote_sections WHERE quote_id = ? ORDER BY sort, id', [id]);
      let items = [], laborRows = [];
      if (sections.length) {
        const sids = sections.map((s) => s.id);
        const ph = sids.map(() => '?').join(',');
        items = await q(`SELECT * FROM sq_quote_items WHERE section_id IN (${ph}) ORDER BY sort, id`, sids);
        laborRows = await q(`SELECT * FROM sq_quote_labor WHERE section_id IN (${ph}) ORDER BY sort, id`, sids);
      }
      const blocks = await q('SELECT * FROM sq_quote_blocks WHERE quote_id = ? ORDER BY sort, id', [id]);

      const bySec = new Map(sections.map((s) => [Number(s.id), []]));
      const labBySec = new Map(sections.map((s) => [Number(s.id), []]));
      for (const i of items) bySec.get(Number(i.section_id))?.push(i);
      for (const l of laborRows) labBySec.get(Number(l.section_id))?.push(l);

      const byBlk = new Map(blocks.map((b) => [Number(b.id), []]));
      const labByBlk = new Map(blocks.map((b) => [Number(b.id), []]));
      for (const i of items) if (i.block_id != null) byBlk.get(Number(i.block_id))?.push(i);
      for (const l of laborRows) if (l.block_id != null) labByBlk.get(Number(l.block_id))?.push(l);

      quotes.push({
        id: Number(h.id), quote_no: h.quote_no, quote_type: h.quote_type,
        deployment: h.deployment, template_code: h.template_code,
        quote_date: dateOnly(h.quote_date), valid_until: dateOnly(h.valid_until),
        customer_name: h.customer_name, customer_contact: h.customer_contact,
        discount_type: h.discount_type, discount_value: num(h.discount_value),
        round_unit: h.round_unit == null ? null : Number(h.round_unit),
        monthly_discount_type: h.monthly_discount_type,
        monthly_discount_value: num(h.monthly_discount_value),
        supply_amount: num(h.supply_amount), discount_amount: num(h.discount_amount),
        vat_amount: num(h.vat_amount), total_amount: num(h.total_amount),
        onetime_total: num(h.onetime_total), monthly_total: num(h.monthly_total),
        status: h.status, memo: h.memo,
        created_by: h.created_by == null ? null : Number(h.created_by),
        created_at: ts(h.created_at), updated_at: ts(h.updated_at),
        conditions: h.conditions,
        sections: sections.map((s) => ({
          id: Number(s.id), quote_id: Number(s.quote_id), solution: s.solution,
          template_code: s.template_code, brand: s.brand, deployment: s.deployment,
          company_class: s.company_class,
          contract_months: s.contract_months == null ? null : Number(s.contract_months),
          params: s.params, subtotal: num(s.subtotal),
          sort: s.sort == null ? null : Number(s.sort),
          items: (bySec.get(Number(s.id)) || []).map(item),
          labor: (labBySec.get(Number(s.id)) || []).map(labor),
        })),
        blocks: blocks.map((b) => ({
          id: Number(b.id), quote_id: Number(b.quote_id),
          section_id: b.section_id == null ? null : Number(b.section_id),
          block_code: b.block_code, title: b.title, subtotal: num(b.subtotal),
          recurring: !!Number(b.recurring),
          sort: b.sort == null ? null : Number(b.sort),
          items: (byBlk.get(Number(b.id)) || []).map(item),
          labor: (labByBlk.get(Number(b.id)) || []).map(labor),
        })),
      });
    }

    const settingsRows = await q('SELECT `key`, value FROM sq_settings');
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
    return { quotes, settings };
  } finally {
    await conn.end();
  }
}

// ── Java 조회 ────────────────────────────────────────────────────
function dumpJava() {
  const outFile = path.join(os.tmpdir(), `quote-jq-${process.pid}.json`);
  const cpFile = path.join(os.tmpdir(), `quote-jcp-${process.pid}.txt`);
  // 절대 경로로 부른다. Windows 에서 'mvnw.cmd' 만 주면 현재 디렉터리를 뒤지지 않아 실패한다.
  const mvnw = path.join(JAVA_DIR, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');

  process.stdout.write('Java 조회 덤프 생성 중 ... ');
  execFileSync(mvnw, ['-q', 'test-compile',
    'dependency:build-classpath', `-Dmdep.outputFile=${cpFile}`, '-Dmdep.includeScope=test'],
    { cwd: JAVA_DIR, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });

  const sep = process.platform === 'win32' ? ';' : ':';
  const cp = [
    path.join(JAVA_DIR, 'target', 'test-classes'),
    path.join(JAVA_DIR, 'target', 'classes'),
    fs.readFileSync(cpFile, 'utf8').trim(),
  ].join(sep);

  const url = `jdbc:mariadb://${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}`;
  execFileSync('java', ['-cp', cp, 'kr.co.sepoasoft.quote.domain.quote.QuoteDumpMain',
    outFile, url, process.env.DB_USER, process.env.DB_PASSWORD],
    { stdio: ['ignore', 'inherit', 'inherit'] });

  const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  fs.unlinkSync(outFile);
  fs.unlinkSync(cpFile);
  return data;
}

// ── 비교 ─────────────────────────────────────────────────────────
function diff(a, b, prefix, out) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    // null 과 '' 을 구분한다. String(null)==='null', String('')==='' 이므로 구분된다.
    if (!(a === null && b === null) && String(a) !== String(b)) {
      out.push({ path: prefix, node: a, java: b });
    }
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
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    diff(a[k], b[k], prefix ? `${prefix}.${k}` : k, out);
  }
}

async function main() {
  const node = await dumpNode();

  if (has('--node-only')) {
    console.log(JSON.stringify(node, null, 2));
    return 0;
  }

  const java = dumpJava();

  console.log('\n조회 대조 — Node loadQuote vs Java QuoteRepository\n');
  const byId = new Map((java.quotes || []).map((q) => [q.id, q]));
  let matched = 0;
  const total = node.quotes.length;

  for (const nq of node.quotes) {
    const jq = byId.get(nq.id);
    const ms = [];
    if (!jq) ms.push({ path: '(견적 없음)', node: nq.id, java: undefined });
    else diff(nq, jq, '', ms);
    if (ms.length === 0) {
      matched++;
      console.log(`  일치   견적 ${String(nq.id).padStart(3)}  ${nq.quote_no}  블록 ${nq.blocks.length} · 섹션 ${nq.sections.length}`);
    } else {
      console.log(`  불일치 견적 ${String(nq.id).padStart(3)}  ${nq.quote_no}  ${ms.length}건`);
      for (const m of ms.slice(0, 12)) {
        console.log(`           ${m.path}: Node=${JSON.stringify(m.node)} Java=${JSON.stringify(m.java)}`);
      }
    }
  }

  const sms = [];
  diff(node.settings, java.settings, 'settings', sms);
  console.log(sms.length === 0
    ? `  일치   설정 ${Object.keys(node.settings).length}건`
    : `  불일치 설정 ${sms.length}건`);
  sms.slice(0, 5).forEach((m) => console.log(`           ${m.path}`));

  console.log(`\n견적 ${matched} / ${total} 일치`);
  const ok = matched === total && sms.length === 0;
  if (!ok) {
    console.error('\n불일치가 있다. Node 가 정본이므로 Java 를 고칠 것.');
    return 1;
  }
  console.log('전 견적·설정 일치. 두 구현이 같은 값을 읽는다.');
  return 0;
}

if (require.main === module) {
  main().then((c) => process.exit(c)).catch((e) => {
    console.error('대조 실패:', e.message);
    process.exit(1);
  });
}

module.exports = { dumpNode };
