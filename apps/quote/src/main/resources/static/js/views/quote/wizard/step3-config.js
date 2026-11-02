// STEP③ 구성 — 좌 입력 / 우 실시간 미리보기.
// quote-block.js 의 블록·모듈 편집과 엑셀 붙여넣기를 그대로 이관했다.
// 계산 로직은 바꾸지 않는다: 서버 calcQuoteBlocks 와 같은 순서를 그대로 옮겨 왔다.
//   블록소계 합 → 특별DC → 절사(십만) → VAT. 일시불/월(recurring) 분리.
import { api as http } from '../../../api.js';
import { h, won, toast, openModal, confirmModal, numInput, previewControls } from '../../../ui.js';
import { pickItems, pickRole, itemRow } from '../pickers.js';
import { store } from '../../../app.js';

// 블록 정의(sq_blocks) — 블록 추가 목록. 한 번 받아 둔다
let blockDefsCache = null;
async function blockDefs() {
  if (!blockDefsCache) {
    try { blockDefsCache = ((await http.blocks()).blocks || []).sort((a, b) => a.sort - b.sort); } catch { blockDefsCache = []; }
  }
  return blockDefsCache;
}
// 견적 구축형태 → 가격정책 품목 구축형태(품목 선택 팝업의 첫 거르기). 구축형은 공통·일시불이 섞여 있어 전체로 연다
const ITEM_DEP = { SAAS: 'SAAS', PCLOUD: 'PCLOUD' };

const num = (v) => Number(v) || 0;

// ── 계산 (서버 엔진과 동일 순서) ────────────────────────────
export function recalcBlocks(state) {
  let onetime = 0, monthly = 0;
  const laborErrors = [];
  for (const b of state.blocks) {
    let sub = 0;
    // 서버 calcBlock 과 같은 판정: 금액이 되는 인건비는 LABOR 블록뿐이다.
    // 비-LABOR 블록의 인건비 행은 인력투입계획 부록용 공수 배분이고, 금액은 이미
    // 같은 블록의 셋업 품목에 들어 있다(3.7MM × 12,000,000 = 44,400,000).
    // 여기서 합산하면 화면 미리보기만 서버 PDF 보다 커진다.
    const isLabor = b.block_code === 'LABOR';
    // 구간 행(band — SaaS 인원 · 건수)도 같다: 단가(구간 월 금액) × 수량
    for (const it of b.items || []) { it.amount = Math.round(num(it.proposed_price) * num(it.qty)); sub += it.amount; }
    for (const l of b.labor || []) {
      if (isLabor) {
        l.amount = Math.round(num(l.proposed_price) * num(l.mm));
        sub += l.amount;
      }
      // 월별 배분 Σ 검증은 블록 종류와 무관하게 돈다(부록 데이터도 합이 맞아야 한다).
      const alloc = l.month_alloc || {};
      const keys = Object.keys(alloc);
      if (keys.length) {
        const s = keys.reduce((a, k) => a + num(alloc[k]), 0);
        if (Math.abs(s - num(l.mm)) > 0.001) {
          laborErrors.push(`${l.role_label || l.role_code}: 배분 ${s} ≠ 공수 ${num(l.mm)}MM`);
        }
      }
    }
    b._sub = sub;
    if (b.recurring) monthly += sub; else onetime += sub;
  }
  const dc = state.discount || { mode: 'TARGET', value: 0 };
  const dcAmt = computeDc(dc, onetime);
  const afterDc = onetime - dcAmt;
  const unit = num(state.round_unit ?? 100000);
  const final = unit > 0 ? Math.floor(afterDc / unit) * unit : Math.round(afterDc);
  // 월 사용료에도 특별DC 가 별도로 걸린다(실측 하겐다즈 SaaS: 월 300,000 → 100,000).
  // 월 금액은 절사하지 않는다 — 밴드 금액(150,000 등)이 깨진다.
  const mdcAmt = computeDc(state.monthly_discount, monthly);
  const monthlyFinal = monthly - mdcAmt;
  return { onetime, monthly, mdcAmt, monthlyFinal, dcAmt, trunc: afterDc - final, final,
    vat: Math.round(final * 0.1), laborErrors };
}

export function computeDc(dc, base) {
  if (!dc || !dc.mode) return 0;
  const raw = dc.value;
  if (raw === null || raw === undefined || raw === '') return 0;
  const v = num(raw);
  if (dc.mode === 'TARGET') return Math.max(0, base - Math.round(v));
  if (dc.mode === 'RATE') return Math.round(base * v / 100);
  if (dc.mode === 'AMOUNT') return Math.round(v);
  return 0;
}

// 서버로 보낼 blocks 페이로드 (저장·미리보기 공용)
//
// ⚠️ 빈 배열을 보내면 안 된다. 서버 calcBlock 이
//      isLabor = block_code === 'LABOR' || Array.isArray(block.labor)
//    로 판정하므로, items 만 있는 블록에 labor: [] 를 함께 보내면 인건비 블록으로
//    오인해 소계가 0 이 된다. 값이 있는 쪽만 실어 보낸다.
export function toBlocksPayload(state) {
  return state.blocks.map((b) => {
    const out = { block_code: b.block_code, name: b.name, recurring: b.recurring ? 1 : 0 };
    const items = mapItems(b);
    const labor = mapLabor(b);
    if (items.length) out.items = items;
    if (labor.length) out.labor = labor;
    if (!items.length && !labor.length) out.items = [];
    return out;
  });
}

function mapItems(b) {
  return (b.items || []).map((it) => ({
    item_code: it.item_code || null, category: it.category || null, name: it.name,
    spec: [it.spec, bandLine(it)].filter(Boolean).join('\n') || null, qty: num(it.qty), unit: it.unit || null,
    base_price: it.base_price, proposed_price: num(it.proposed_price), amount: it.amount,
    note: it.band && it.band_qty != null && it.band_qty !== '' ? `BAND:${it.band}:${num(it.band_qty)}` : null,
  }));
}

// ── SaaS 구간 금액 ─────────────────────────────────────────
// 가격정책 SaaS 의 구간형 서비스(S2C · S2P …)는 인원 구간(USER) · 건수 구간(COUNT)마다 '구간 월 금액' 이 있다.
// 견적 행에서 인원 / 건수를 고르고 수량을 넣으면 맞는 구간의 월 금액을 기준단가 · 제안단가로 채운다.
// 인원 · 건수는 수량과 따로 넣는다(2026-10-30 사용자 요청 — '인원·건수' 칸). 금액 = 구간 월 금액 × 수량.
// 견적서에는 세부기능 아래에 '(건수 40건 기준)' 한 줄로 나온다. 저장할 때 note 에 BAND:키:숫자 로 남기고, 다시 열 때 그 줄을 떼어 낸다.
export const BAND_KINDS = { USER: ['인원', '명'], COUNT: ['건수', '건'] };
// 인원 · 건수 숫자를 아직 안 넣었으면(band_qty 비어 있음) 줄도 없다
export const bandLine = (it) => (it.band && BAND_KINDS[it.band] && it.band_qty != null && it.band_qty !== ''
  ? `(${BAND_KINDS[it.band][0]} ${num(it.band_qty)}${BAND_KINDS[it.band][1]} 기준)` : null);
export const BAND_LINE_RE = /\n?\((인원|건수) [\d.]+(명|건) 기준\)$/;
// 서비스 이용료 행의 단위 — 인원이면 '명', 건수면 '건'(2026-10-30 사용자 요청 — 예전 가격정책 단위 'User/월'). 구간이 없으면 null
export const bandUnitOf = (band) => (band && BAND_KINDS[band] ? BAND_KINDS[band][1] : null);
// SaaS 품목 목록 — 솔루션마다 한 번 받는다. 서비스(S2C · S2P …) = 구간형(BAND) 품목
const catalogCache = {};
export async function loadSaasCatalog(solution) {
  if (!solution) return { items: [], services: [] };
  if (!catalogCache[solution]) {
    try {
      const items = (await http.pricing(solution, 'SAAS')).items || [];
      const services = items.filter((x) => x.pricing_type === 'BAND')
        .map((x) => ({ code: x.code, label: String(x.name || x.service_type || x.code).replace(/\s*서비스\s*이용료$/, ''), item: x }));
      catalogCache[solution] = { items, services };
    } catch { return { items: [], services: [] }; } // 못 받으면 구간 · 서비스 선택 없이 — 손으로 넣는다
  }
  return catalogCache[solution];
}
async function loadBands(solution) {
  const { items } = await loadSaasCatalog(solution);
  return Object.fromEntries(items.filter((x) => x.pricing_type === 'BAND' && (x.variants || []).length).map((x) => [x.code, x.variants]));
}

// 견적용도 자동 문구(2026-11-02 사용자 요청) — 고객명 + 솔루션 + '구축 견적' + (구축형태: SaaS · 온프레미스 · Private Cloud).
// 구축형태를 아직 안 골랐으면 괄호는 뺀다
const PURPOSE_DEP = { SAAS: 'SaaS', ONPREM: '온프레미스', ONPREM_LUMP: '온프레미스', ONPREM_INSTALL: '온프레미스', PCLOUD: 'Private Cloud' };
export async function autoPurpose(state) {
  const sol = state.type && state.type.solution;
  const dep = state.type && PURPOSE_DEP[state.type.deployment];
  // 간접(중간업체 경유)이면 견적용도에는 수신처(중간업체) 대신 최종 고객사 이름
  const b = state.basic;
  const who = b.channel === 'AGENCY' && String(b.end_customer || '').trim() ? b.end_customer : b.customer_name;
  return [String(who || '').trim(), sol ? store.solutionName(sol) : '', '구축 견적', dep ? `(${dep})` : '']
    .filter(Boolean).join(' ');
}
// 견적용도를 자동 문구로 맞춘다 — 비어 있거나 앞서 자동으로 넣은 그대로일 때만(손으로 고친 문구는 둔다). 바뀌면 true
export async function syncPurpose(wiz) {
  if (wiz.readOnly || wiz.editMode) return false; // 신규 작성에만 — 수정 · 상세에서는 바꾸지 않는다(2026-11-02 사용자 요청)
  const st = wiz.get();
  const cur = String(st.basic.purpose || '');
  // 자동 문구 모양('… 구축 견적' 또는 '… 구축 견적 (구축형태)')이면 자동으로 본다 — 임시저장 후 다시 열어 purpose_auto 가 없어도 고객명 · 구축형태를 따라간다
  const autoShape = /(^|\s)구축 견적( \([^)]*\))?$/.test(cur.trim());
  if (cur.trim() && cur !== st.basic.purpose_auto && !autoShape) return false;
  const next = await autoPurpose(st);
  if (next === cur) return false;
  wiz.patch({ basic: { purpose: next, purpose_auto: next } });
  return true;
}

// SaaS 견적의 서비스(S2C · S2P …) — 2단계(기본정보)에서 고른 것(type.service), 없으면 견적에 들어 있는 서비스 행
export function quoteService(state, services) {
  const codes = services.map((x) => x.code);
  if (state.type.service && codes.includes(state.type.service)) return state.type.service;
  for (const b of state.blocks || []) for (const it of b.items || []) if (codes.includes(it.item_code)) return it.item_code;
  return null;
}

// 고른 서비스에 맞춰 구성 행을 바꾼다 — 다른 서비스의 이용료 행은 고른 서비스로,
// '(S2C)' 처럼 서비스가 붙은 품목(독립인프라 등)은 같은 이름의 고른 서비스 품목으로. 맞는 품목이 없으면 그대로 둔다.
// 바꾼 행은 셋업비용 블록이면 가격정책 기준가로 다시 채우고, 그 밖은 금액을 비운다. 바꾼 행 수를 돌려준다
function syncService(state, code, catalog) {
  const svc = catalog.services.find((x) => x.code === code);
  if (!svc) return 0;
  const others = catalog.services.filter((x) => x.code !== code);
  let n = 0;
  for (const b of state.blocks || []) {
    for (const it of b.items || []) {
      let to = null;
      if (others.some((x) => x.code === it.item_code)) to = svc.item;
      else {
        const o = others.find((x) => String(it.name || '').endsWith(`(${x.label})`));
        if (o) {
          const want = String(it.name).slice(0, -(o.label.length + 2)) + `(${svc.label})`;
          to = catalog.items.find((x) => x.name === want) || null;
        }
      }
      if (!to) continue;
      it.item_code = to.code; it.name = to.name; it.spec = to.spec || it.spec; it.unit = to.unit || it.unit;
      let price = to.base_price != null ? Number(to.base_price) : null;
      if (to.pricing_type === 'BAND') {
        it.band = it.band || 'USER';
        it.unit = bandUnitOf(it.band);
        const v = it.band_qty == null || it.band_qty === '' ? null : bandOf(to.variants, it.band, num(it.band_qty)); // 숫자를 넣기 전이면 금액 없음
        price = v ? num(v.price) : null;
      }
      // 셋업비용 블록 밖은 금액 없이 둔다(템플릿으로 시작할 때와 같은 규칙) — 인원 · 건수를 고치면 그때 구간 금액이 들어간다
      if (b.block_code === 'SETUP') { it.base_price = price; it.proposed_price = price || 0; } else { it.base_price = null; it.proposed_price = 0; }
      n++;
    }
  }
  return n;
}
// n 이 들어가는 구간 — 끝(max_qty)이 비어 있으면 '이상'
export function bandOf(variants, key, n) {
  // 예전에 넣은 인원 구간은 key 가 비어 있다 — 가격정책 화면처럼 COUNT 가 아니면 인원으로 본다
  const kindOf = (v) => (v.key === 'COUNT' ? 'COUNT' : 'USER');
  return (variants || []).find((v) => kindOf(v) === key && n >= num(v.min_qty) && (v.max_qty == null || n <= num(v.max_qty))) || null;
}

// 비-LABOR 블록(SETUP 등)의 labor 행은 **인력투입계획 부록용 공수 배분**이다.
// 금액은 이미 같은 블록의 items 에 들어 있으므로(예: 3.7MM × 12,000,000 = 44,400,000),
// 단가·금액을 함께 실어 보내면 이중 계상의 씨앗이 된다. mm 과 month_alloc 만 보낸다.
function mapLabor(b) {
  const isLabor = b.block_code === 'LABOR';
  return (b.labor || []).map((l) => {
    const out = {
      role_code: l.role_code, role_name: l.role_name || null, role_label: l.role_label || null,
      grade: l.grade || null, task: l.task || null, mm: num(l.mm),
      month_alloc: l.month_alloc && Object.keys(l.month_alloc).length ? l.month_alloc : null,
    };
    if (isLabor) {
      out.base_price = l.base_price;
      out.proposed_price = num(l.proposed_price);
      out.amount = l.amount;
    }
    return out;
  });
}

// 견적조건 블록을 넣었는가 — conds_on(true/false)이 정해져 있으면 그것, 아니면 문장이 있으면 넣은 것
export function condsOn(state) {
  return state.conds_on == null ? (state.conds || []).length > 0 : !!state.conds_on;
}

export function previewHeader(state) {
  const b = state.basic;
  return {
    quote_type: state.type.quote_type, deployment: state.type.deployment,
    template_code: state.type.template_code, solution: state.applied?.solution,
    brand: state.applied?.brand,
    customer_name: b.customer_name, customer_contact: b.customer_contact,
    quote_date: b.quote_date, valid_until: b.valid_until,
    // 메모 구성은 구 화면(quote-block.js)과 동일하게 유지한다 — 저장된 견적의 조회 표시가 달라지면 안 된다.
    memo: [
      b.purpose ? '[견적용도] ' + b.purpose : '',
      '[결제조건] ' + (b.pay_terms || '-'),
      '[특별DC] ' + dcMemo(state.discount),
      b.phone ? '[연락처] ' + b.phone : '',
      b.email ? '[이메일] ' + b.email : '',
      b.company_class ? '[기업구분] ' + b.company_class : '', // 2026-10-31 — 없으면 줄도 없다(옛 견적 메모 그대로)
      b.channel ? '[채널] ' + b.channel : '', // 이하 2026-11-02 — 채널 · 최종 고객사 · 담당자 정보(우리 영업 담당)
      b.channel === 'AGENCY' && b.end_customer ? '[최종고객] ' + b.end_customer : '',
      b.rep_name ? '[영업담당] ' + b.rep_name : '',
      b.rep_phone ? '[영업연락처] ' + b.rep_phone : '',
      b.rep_email ? '[영업이메일] ' + b.rep_email : '',
    ].filter(Boolean).join('\n'),
    // 견적조건 — 넣으면 문장 목록, 뺐으면 빈 목록(견적서에 견적조건 칸이 없다).
    // 정해지지 않은 옛 견적(conds_on 없음 · 문장 없음)은 보내지 않는다 — 서버가 템플릿 문구를 쓴다
    conditions: condsOn(state) ? (state.conds || []).filter((c) => c.text && c.text.trim())
      .map((c) => ({ text: c.text, auto: false, edited: true }))
      : state.conds_on === false ? [] : undefined,
    // 견적별 결제 방안(V6) — 없으면 보내지 않는다(템플릿 설정 · 기본 문구)
    pay_plan: state.pay_plan || undefined,
  };
}

function dcMemo(dc) {
  if (!dc || dc.value === null || dc.value === undefined || dc.value === '') return '미적용';
  const v = num(dc.value);
  if (dc.mode === 'RATE') return `할인율 ${v}%`;
  if (dc.mode === 'AMOUNT') return `할인액 ${won(v)}원`;
  return `최종금액 지정 ${won(v)}원`;
}

export function discountPayload(state) {
  return dcPayload(state.discount);
}

// 월 특별DC. 미입력(null)이면 보내지 않는다. value 0 은 유효한 값이다(무상제공).
export function monthlyDiscountPayload(state) {
  return dcPayload(state.monthly_discount);
}

function dcPayload(dc) {
  if (!dc || !dc.mode) return null;
  if (dc.value === null || dc.value === undefined || dc.value === '') return null;
  return { type: dc.mode, value: num(dc.value) };
}

// ── 템플릿 적용 ─────────────────────────────────────────────
// apply-template 응답 → 위저드 상태 조각. 제안단가는 기준단가로 시작한다(템플릿 불러오기 창도 같이 쓴다).
// SaaS 견적의 구분 = 가격정책 SaaS 기본정보의 항목(기본 / 부가 / 옵션 — 2026-10-30 사용자 요청).
// 품목에서 정한다(가격정책 화면의 예전 항목 → 분류와 같은 규칙): 옵션(옵션모듈) → 옵션,
// 셋업 · Poa-BiA · 인프라 · 연계 · 유지보수 · 커스터마이징 → 부가, 나머지(서비스 이용료) → 기본
// 결제 방안 기본 문구(서버 QuoteHtml.payPlanRows 와 같은 문구) — 견적 작성 결제 방안 · 템플릿 화면 결제 방안 탭이 같이 쓴다
export function payPlanDefault(one, mon, ratio) {
  const r = ratio > 0 && ratio <= 100 ? Number(ratio) : 50;
  const first = Math.round(one * r / 100);
  const rows = [];
  if (one === 0) rows.push(['서비스\n셋업비용', '1. 무상제공', '1. 셋업비용 : 무상제공', '-']);
  else if (r >= 100) {
    rows.push(['서비스\n셋업비용', '1. 일시불\n  -. 계약체결 후 100%', `1. 일시불 비용 : ₩${won(one)}원`,
      '-. 서비스계약 체결 후 7일 이내 세금계산서 발행\n-. 결제조건 : 계약체결 후 100%']);
  } else {
    rows.push(['서비스\n셋업비용', `1. 일시불\n  -. 계약체결 후 ${r}%\n  -. 구축완료 후 ${100 - r}%`,
      `1. 일시불 비용 : ₩${won(one)}원\n   계약체결 후 ${r}% : ₩${won(first)}원\n   구축완료 후 ${100 - r}% : ₩${won(one - first)}원`,
      `-. 서비스계약 체결 후 7일 이내 세금계산서 발행\n-. 검수완료 후 7일 이내 세금계산서 발행\n-. 결제조건 : 계약체결 후 ${r}% / 구축완료 후 ${100 - r}%`]);
  }
  rows.push(['서비스\n월 사용료', '1. 매월 말', `1. 서비스 사용료 : ₩${won(mon)}원/매월`, '-. 서비스 착수 후 월별로 세금계산서 발행']);
  return rows;
}

export const POLICY_GROUPS = ['기본', '부가', '옵션'];
export function policyGroup(it) {
  const t = `${it.category || ''} ${it.name || ''}`;
  if (/옵션/.test(t)) return '옵션';
  return /셋업|Poa-BiA|인프라|연계|유지보수|커스터마이징/i.test(t) ? '부가' : '기본';
}
const withPolicyGroup = (it) => ({ ...it, category: policyGroup(it) });

// 가격정책 SaaS 기본정보(현재 버전)의 행 — { 항목(기본/부가/옵션): [{ sub: 세부, desc: 상세 설명 }] }.
// SaaS 견적 행에서 구분을 고르면 그 구분의 세부가 모듈 목록이 되고, 세부를 고르면 상세 설명이 세부기능에 들어간다
const policyCache = {};
async function loadPolicyItems(solution) {
  if (!solution) return {};
  if (!policyCache[solution]) {
    try {
      const p = await http.pricePolicy(solution, 'SAAS');
      const rows = (p.current && p.current.content && p.current.content.info && p.current.content.info.rows) || [];
      const out = {};
      for (const r of rows) {
        if (!POLICY_GROUPS.includes(r.label) || !String(r.sub || '').trim()) continue; // 예전 형식(분류 전) 행은 쓰지 않는다
        (out[r.label] = out[r.label] || []).push({ sub: String(r.sub).trim(), desc: String(r.desc || '').trim(), money: r.type === 'money' });
      }
      policyCache[solution] = out;
    } catch { return {}; } // 못 받으면 모듈은 손으로 넣는다
  }
  return policyCache[solution];
}

export function appliedPatch(d) {
  const saas = d.template && d.template.deployment === 'SAAS';
  const blocks = d.blocks.filter((b) => b.block_code !== 'SUMMARY').map((b) => ({
    ...b,
    // SaaS 는 셋업비용(SETUP) 블록만 가격정책 금액으로 시작하고, 나머지(서비스 이용료 등)는 금액 없이 시작한다(2026-10-31 사용자 요청)
    items: (b.items || []).map((it) => ({ ...(saas ? withPolicyGroup(it) : it),
      ...(saas && b.block_code !== 'SETUP' ? { base_price: null, proposed_price: 0, amount: 0 } : { proposed_price: it.base_price || 0 }),
      ...(bandUnitOf(it.band) ? { unit: bandUnitOf(it.band) } : {}) })),
    labor: (b.labor || []).map((l) => ({ ...l, proposed_price: l.base_price || 0, month_alloc: l.month_alloc || {} })),
  }));
  return {
    blocks, applied: d.template, laborYear: d.labor_year,
    round_unit: d.round_unit ?? 100000,
    hasLaborPlan: !!d.template.has_labor_plan,
    conds: (d.conditions || []).map((t) => ({ text: t })),
    // 템플릿에 견적조건 세트가 없으면 뺀 채로 시작
    conds_on: d.template.has_conditions ?? (d.conditions || []).length > 0,
  };
}

async function applyTemplate(state, wiz) {
  const d = await http.applyTemplate(state.type.template_code);
  wiz.patch(appliedPatch(d));
  if (d.unregistered && d.unregistered.length) {
    toast(`가격마스터 미등록 모듈 ${d.unregistered.length}건 — 기준단가가 비어 있습니다: ${d.unregistered.join(', ')}`, 'err');
  }
}

// 미리보기 창 — 견적 작성 위쪽 [미리보기] 버튼. 지금 화면의 값(저장 전 포함)으로 PDF 와 같은 견적서를 그린다.
export async function openPreview(wiz) {
  const s = wiz.get();
  if (!s.blocks || !s.blocks.length) return toast('템플릿을 불러오거나 3단계(구성)에서 견적 구성을 만든 뒤 미리볼 수 있습니다.', 'err');
  recalcBlocks(s); // 행 금액(amount)을 채운다 — 서버는 보낸 금액을 그대로 합산한다
  const frame = h('iframe', { style: 'width:100%;height:72vh;border:1px solid #E7EAF0;background:#fff' });
  const info = h('span', { style: 'font-size:12px;color:var(--text-3);margin-right:8px' }, '그리는 중...');
  const printBtn = h('button', { class: 'btn', disabled: true, onclick: () => frame.contentWindow.print() }, '인쇄 · PDF 저장');
  const m = openModal({
    title: `견적서 미리보기${s.quoteNo ? ' — ' + s.quoteNo : ''}`,
    body: frame,
    footer: [info, printBtn, h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '880px';
  box.querySelector('.modal-body').style.padding = '12px';
  previewControls(frame, box, () => m.close());
  try {
    const r = await http.previewQuote({
      blocks: toBlocksPayload(s), header: { ...previewHeader(s), quote_no: s.quoteNo || undefined },
      discount: discountPayload(s), monthly_discount: monthlyDiscountPayload(s),
      round_unit: num(s.round_unit ?? 100000),
    });
    frame.srcdoc = r.html;
    info.textContent = `일시 ${won(r.calc.onetime_total)}원${r.calc.monthly_total ? ' / 월 ' + won(r.calc.monthly_total) + '원' : ''}`;
    printBtn.disabled = false;
  } catch (err) {
    info.textContent = '';
    frame.replaceWith(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
  }
}

export async function renderStep3(root, state, wiz) {
  root.replaceChildren();

  // 두 가지로 쓴다 — ① 템플릿을 불러와 고치기 ② 직접 작성(블록 · 품목 · 인력을 모두 손으로). 어느 쪽이든 모든 칸을 고칠 수 있다
  if (!state.type.template_code && !state.type.manual) {
    root.appendChild(h('div', { class: 'banner wrn' },
      h('div', {}, h('b', {}, '1단계(유형 선택)에서 템플릿을 고르거나 [직접 작성] 을 선택하세요.'), ' 1단계의 [견적서 불러오기] 로 기존 견적을 불러와도 됩니다.')));
    return;
  }
  let fresh = false; // 이번에 템플릿을 새로 적용했는가 — 그때만 SaaS 금액을 가격정책 기준으로 비운다(저장된 견적은 그대로)
  if (!state.blocks.length && state.type.template_code) {
    root.appendChild(h('div', { class: 'empty' }, '템플릿을 적용하는 중…'));
    try { await applyTemplate(state, wiz); fresh = true; }
    catch (err) { root.replaceChildren(h('div', { class: 'empty' }, err.message)); return; }
    root.replaceChildren();
  }

  const st0 = wiz.get();
  const solution0 = st0.type.solution || (st0.applied && st0.applied.solution);
  const bands = await loadBands(solution0);
  // SaaS — 1단계에서 고른 서비스로 구성 행을 맞춘다(템플릿이 S2C 로 만들어 두었어도 S2P 를 고르면 S2P 행으로)
  if (st0.type.deployment === 'SAAS' && st0.type.service) {
    const n = syncService(st0, st0.type.service, await loadSaasCatalog(solution0));
    if (n) { wiz.patch({}); toast(`서비스에 맞춰 ${n}개 행을 바꿨습니다.`, 'ok'); }
  }
  const policyItems = st0.type.deployment === 'SAAS' ? await loadPolicyItems(solution0) : {};
  const catalog = st0.type.deployment === 'SAAS' ? await loadSaasCatalog(solution0) : null; // 구성 질문(SaaS)
  // SaaS — 서비스 이용료 행(구간형 품목)의 모듈 이름은 가격정책 용어(기본의 '서비스 이용료')로 쓴다.
  // 어느 서비스인지는 1단계에서 고르고 세부기능이 말해 준다(2026-10-30 사용자 요청 — 예전 'S2C 서비스 이용료')
  const svcTerm = ((policyItems['기본'] || []).find((x) => /서비스 이용료$/.test(x.sub)) || {}).sub;
  if (svcTerm) {
    let n = 0;
    for (const b of st0.blocks || []) for (const it of b.items || []) if (bands[it.item_code] && it.name !== svcTerm) { it.name = svcTerm; n++; }
    if (n) wiz.patch({});
  }
  // SaaS 템플릿으로 막 시작했으면 템플릿에 없는 금액은 비운다(2026-10-30 사용자 요청).
  //   서비스 이용료(인원 · 건수 구간) — 인원 · 건수 숫자를 넣어야 구간 금액이 들어간다(템플릿의 숫자는 쓰지 않는다)
  //   가격정책 기본정보에 금액(money)이 아닌 값(별도협의 등)인 세부 — 내부시스템 연계 · 커스터마이징 → 단가 빈칸
  //   그 밖에 가격정책에 금액이 있는 행(기본 셋업비 · Poa-BiA · 독립인프라 · 옵션)은 그 금액 그대로
  if (fresh && st0.type.deployment === 'SAAS') {
    const rows = Object.values(policyItems).flat();
    for (const b of st0.blocks || []) for (const it of b.items || []) {
      const pol = rows.find((x) => x.sub === it.name);
      if (bands[it.item_code]) it.band_qty = null;
      else if (!pol || pol.money) continue;
      it.base_price = null; it.proposed_price = null; it.amount = 0;
    }
    wiz.patch({});
  }
  // 서비스 이용료 행의 단위도 인원 · 건수에 맞춘다(명 / 건) — 예전 견적 · 템플릿의 'User/월' 도 열면 바뀐다(저장해야 견적서에 반영)
  {
    let n = 0;
    for (const b of st0.blocks || []) for (const it of b.items || []) {
      const u = bands[it.item_code] && bandUnitOf(it.band);
      if (u && it.unit !== u) { it.unit = u; n++; }
    }
    if (n) wiz.patch({});
  }

  // 본문(견적 품목 · 견적서 문구) + 오른쪽 견적 요약(읽기만) — 개선안 v2(2026-11-02). 견적서 미리보기는 위쪽 [미리보기] 버튼
  const left = h('div', { style: 'min-width:0' });
  const sumBox = h('div', { class: 'qz-sum' });
  const checkBox = h('div', { class: 'qz-check' }); // 발행 전 확인(개선안 v2 4번)
  const side = h('aside', { class: 'qz-side' }, sumBox, checkBox);
  root.appendChild(h('div', { class: 'qz-layout' }, left, side));
  const collapsed = new Set(); // 접은 블록(block_code)
  const openDocs = new Set();  // 펼친 견적서 문구(PAY · CONDS)
  const preview = { schedule() {} }; // 예전 오른쪽 미리보기 갱신 자리 — 지금은 창으로 연다

  const els = {};
  function syncTotals(c) {
    const set = (k, v) => { if (els[k]) els[k].textContent = v; };
    set('one', won(c.onetime)); set('dc', c.dcAmt ? '-' + won(c.dcAmt) : '0');
    set('tr', c.trunc ? '-' + won(c.trunc) : '0'); set('fin', won(c.final));
    set('vat', won(c.vat)); set('mon', c.monthly ? won(c.monthly) : '-');
    set('mdc', c.mdcAmt ? '-' + won(c.mdcAmt) : '0');
    set('monFin', c.monthly ? won(c.monthlyFinal) : '-');
    paintPayPlan(c); // 금액이 바뀌면 결제 방안 금액도 따라 바뀐다
    paintSide(c);
    if (els.warn) {
      els.warn.textContent = c.laborErrors.length ? '인력투입계획 확인: ' + c.laborErrors.join(' / ') : '';
      els.warn.style.display = c.laborErrors.length ? '' : 'none';
    }
  }
  function touched() { wiz.patch({}); syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz); }

  // 오른쪽 견적 요약 — 읽기만. 특별 DC · 절사 입력은 3단계에서 뺐다(저장된 값은 계산에 그대로 쓴다)
  function paintSide(c) {
    const s = wiz.get();
    const row = (label, v, main) => h('div', { class: 'qz-sum__row' + (main ? ' qz-sum__row--main' : '') }, label, h('b', {}, v));
    const ru = num(s.round_unit ?? 100000);
    const meta = [
      '부가세 별도 · ' + (ru === 100000 ? '십만원 미만 절사' : ru === 10000 ? '만원 미만 절사' : '절사 없음'),
      c.dcAmt ? `특별 DC -${won(c.dcAmt)}` : null,
      s.revision > 1 ? `${s.revision}차${s.revisionReason ? ' — ' + s.revisionReason : ''}` : null,
    ].filter(Boolean);
    const hasMonthly = c.monthly || (s.blocks || []).some((b) => b.recurring);
    sumBox.replaceChildren(...[ // replaceChildren 은 null 을 글자로 넣는다 — 걸러서 넘긴다
      h('div', { class: 'qz-sum__head' }, '견적 요약'),
      row('일시불', won(c.final), true),
      hasMonthly ? row('월 사용료', won(c.monthlyFinal)) : null,
      h('div', { class: 'qz-sum__line' }),
      h('div', { class: 'qz-sum__meta' }, ...meta.flatMap((t, i) => (i ? [h('br'), t] : [t]))),
    ].filter(Boolean));
    paintChecks(s, c);
  }

  // 발행 전 확인 — 보내기 전에 볼 것을 모아 보인다(읽기만, 막지는 않는다). 개선안 v2 4번(2026-11-02 사용자 승인)
  //   수신처 · 견적용도 빈칸 / 금액 없는 행 / 견적조건 문장 없음 / 인력투입계획 공수 / 가장 큰 할인율(참고)
  function paintChecks(s, c) {
    const short = (list) => list.slice(0, 4).join(' · ') + (list.length > 4 ? ` 외 ${list.length - 4}` : '');
    const rows = (s.blocks || []).filter((b) => b.block_code !== 'LABOR').flatMap((b) => b.items || []);
    const items = [];
    // 5단계 발행을 막는 것 — 여기서 먼저 알린다(2026-11-02 사용자 요청)
    if (!(s.blocks || []).length) items.push('견적 품목이 비어 있습니다 — 블록을 추가해야 발행할 수 있습니다');
    else if (!num(c.onetime) && !num(c.monthly)) items.push('금액이 0원입니다 — 금액을 넣어야 발행할 수 있습니다');
    if (!String(s.basic.customer_name || '').trim()) items.push('수신처가 비어 있습니다');
    if (!String(s.basic.purpose || '').trim()) items.push('견적용도가 비어 있습니다');
    const noAmt = rows.filter((r) => num(r.qty) === 0 || !num(r.proposed_price));
    if (noAmt.length) items.push(`금액 없는 행 ${noAmt.length}건 (${short(noAmt.map((r) => r.name || r.item_code || '이름 없음'))})`);
    if (condsOn(s) && !(s.conds || []).some((x) => x.text && x.text.trim())) items.push('견적조건 문장이 없습니다 — 견적서에 찍히지 않습니다');
    for (const e of c.laborErrors || []) items.push('인력투입계획: ' + e);
    let top = null;
    for (const r of rows) {
      const base = num(r.base_price), prop = num(r.proposed_price);
      if (!base || !prop || prop >= base) continue;
      const pct = Math.round(((base - prop) / base) * 1000) / 10;
      if (!top || pct > top.pct) top = { pct, name: r.name || r.item_code };
    }
    checkBox.replaceChildren(
      h('div', { class: 'qz-check__head' + (items.length ? '' : ' is-ok') }, items.length ? `발행 전 확인 ${items.length}건` : '발행 전 확인 — 이상 없음'),
      ...(items.length || top ? [h('ul', {}, ...items.map((t) => h('li', {}, t)),
        ...(top ? [h('li', { class: 'is-info' }, `가장 큰 할인율 ${top.pct}% — ${top.name}`)] : []))] : [])); // null 을 넘기면 'null' 글자가 찍힌다
  }

  // ── 블록 그리드 ─────────────────────────────────────────────
  // 견적서 표와 같은 칸 구성으로 칸마다 따로 입력한다(SingleSuite 편집 그리드 — 선택 칸 · 행추가 · 행삭제 · 소계 행).
  //   품목: 구분 · 모듈 · 세부기능 · 수량 · 단위 · 기준단가 · 제안단가 · 제안금액 · 품목코드
  //   인력: 역할(표시명) · 직무(노임단가 팝업) · 등급 · 업무 · 공수 · 기준단가 · 제안단가 · 제안금액
  // 고르는 값(품목 · 직무)은 팝업에서 고르고, 고른 뒤에도 모든 칸을 고칠 수 있다.
  // 품목코드 칸은 뺐다 — 모듈 칸 아래에 작게 붙인다(개선안 v2)
  const ITEM_COLS = [['선택', 44], ['구분', 100], ['모듈', 170], ['세부기능', 360], ['수량', 70], ['단위', 64],
    ['기준단가 (원)', 110], ['할인율', 64], ['제안단가 (원)', 112], ['제안금액 (원)', 120]]; // 할인율 — 계산만(개선안 v2 3번)
  const LABOR_COLS = [['선택', 44], ['역할', 140], ['직무 (노임단가)', 190], ['등급', 90], ['업무', 340], ['공수 (MM)', 76],
    ['기준단가 (원)', 122], ['제안단가 (원)', 122], ['제안금액 (원)', 130]];

  const BAND_COL = ['인원·건수', 150];
  const itemCols = (rows) => (rows.some((r) => bands[r.item_code])
    ? [...ITEM_COLS.slice(0, 4), BAND_COL, ...ITEM_COLS.slice(4)] : ITEM_COLS);

  function rowEl(b, r, isLabor, picked, hasBand) {
    // 수량 0 이거나 단가를 아직 안 넣은 행(템플릿에 없는 금액 — 서비스 이용료 인원·건수 입력 전 등)은 금액 칸을 비운다
    const amtText = () => (!isLabor && (num(r.qty) === 0 || r.proposed_price == null || r.proposed_price === '') ? '-' : won(r.amount || 0));
    const amtCell = h('td', { class: 'ss-cell--amount' }, amtText());
    // 할인율 — 기준단가 대비 제안단가(입력 없음). 네고 차수에서 얼마 깎았는지 보인다. 같거나 비교할 값이 없으면 '-'
    const dcText = () => {
      const base = num(r.base_price);
      if (!base || r.proposed_price == null || r.proposed_price === '') return '-';
      const pct = Math.round(((base - num(r.proposed_price)) / base) * 1000) / 10;
      return pct > 0 ? `${pct}%` : pct < 0 ? `+${-pct}%` : '-';
    };
    const dcCell = h('td', { class: 'qz-dc' }, dcText());
    const paintDc = () => { dcCell.textContent = dcText(); dcCell.classList.toggle('is-off', dcCell.textContent.startsWith('-')); };
    paintDc();
    // 수량 0 이거나 금액이 없는 행은 흐리게 — 값이 있는 행이 먼저 보인다
    const isZero = () => !isLabor && (num(r.qty) === 0 || !num(r.proposed_price));
    let trEl = null;
    const upd = () => {
      const c = recalcBlocks(wiz.get());
      amtCell.textContent = amtText();
      paintDc();
      if (trEl) trEl.classList.toggle('qz-zero', isZero());
      const sub = document.getElementById('sub-' + b.block_code);
      if (sub) sub.textContent = won(b._sub || 0);
      wiz.patch({}); syncTotals(c); preview.schedule(wiz);
    };
    const td = (el) => h('td', { class: 'ss-cell--input' }, el);
    // 글자는 왼쪽(단위 · 등급만 가운데), 숫자는 오른쪽. 금액은 3자리 콤마로 입력한다(다른 편집 그리드와 같은 numInput)
    const txt = (key, ph = '', align = 'left') => td(h('input', { class: 'ss-cellinput', value: r[key] ?? '', placeholder: ph,
      style: `text-align:${align}`, oninput: (e) => { r[key] = e.target.value; touched(); } }));
    const numIn = (key, style = '') => td(numInput(r[key], (v) => { r[key] = v === '' ? null : v; upd(); },
      { class: 'ss-cellinput', style: 'text-align:right;' + style }));
    const money = (key, style = '') => td(numInput(r[key], (v) => { r[key] = v === '' ? null : v; upd(); },
      { class: 'ss-cellinput', style: 'text-align:right;' + style }));
    // 세부기능 · 업무는 여러 줄 — 줄 수만큼 칸이 늘어난다
    const specKey = isLabor ? 'task' : 'spec';
    const spec = h('textarea', { class: 'ss-cellinput qz-spec',
      oninput: (e) => { r[specKey] = e.target.value; e.target.rows = lines(e.target.value); touched(); } }); // 입력 중에는 다 보인다
    spec.value = r[specKey] || '';
    spec.rows = Math.min(3, lines(spec.value)); // 표가 길어지지 않게 3줄까지 — 누르면 다 보인다
    spec.addEventListener('focus', () => { spec.rows = lines(spec.value); });
    spec.addEventListener('blur', () => { spec.rows = Math.min(3, lines(spec.value)); });
    const sel = h('td', {}, h('input', { type: 'checkbox', 'aria-label': '선택', checked: picked.has(r),
      onchange: (e) => { if (e.target.checked) picked.add(r); else picked.delete(r); } }));
    const proposed = money('proposed_price', 'background:var(--primary-weak);color:var(--primary);font-weight:600');
    // SaaS 견적의 구분은 가격정책 항목(기본 / 부가 / 옵션)에서 고른다. 예전 값(서비스이용료 등)은 그대로 한 줄 더 보인다
    const category = () => (wiz.get().type.deployment !== 'SAAS' ? txt('category')
      : td(h('select', { class: 'ss-cellinput', 'aria-label': '구분', style: 'text-align:center',
        onchange: (e) => { r.category = e.target.value; moduleTd.replaceWith(moduleTd = moduleWithCode()); touched(); } },
        ...(r.category ? [] : [h('option', { value: '', selected: true, disabled: true }, '선택')]),
        ...(r.category && !POLICY_GROUPS.includes(r.category) ? [h('option', { value: r.category, selected: true }, r.category)] : []),
        ...POLICY_GROUPS.map((g) => h('option', { value: g, selected: r.category === g }, g)))));
    // SaaS 견적의 모듈 = 고른 구분의 가격정책 세부. 고르면 세부기능에 그 세부의 상세 설명을 넣는다(설명이 비었으면 세부기능은 그대로).
    // 목록에 없는 지금 값(템플릿 품목 이름 등)도 한 줄로 남겨 둔다
    const moduleCell = () => {
      const list = (wiz.get().type.deployment === 'SAAS' && policyItems[r.category]) || null;
      if (!list) return txt('name');
      const subs = list.map((x) => x.sub);
      return td(h('select', { class: 'ss-cellinput', 'aria-label': '모듈', style: 'text-align:left',
        onchange: (e) => {
          const x = list.find((y) => y.sub === e.target.value);
          r.name = e.target.value;
          if (x && x.desc) { r.spec = x.desc; spec.value = x.desc; spec.rows = lines(x.desc); }
          touched();
        } },
        ...(r.name ? [] : [h('option', { value: '', selected: true, disabled: true }, '세부 선택')]),
        ...(r.name && !subs.includes(r.name) ? [h('option', { value: r.name, selected: true }, r.name)] : []),
        ...subs.map((v) => h('option', { value: v, selected: r.name === v }, v))));
    };
    // 모듈 칸 아래에 품목코드를 작게
    const moduleWithCode = () => { const t = moduleCell(); if (r.item_code) t.appendChild(h('div', { class: 'qz-code' }, r.item_code)); return t; };
    let moduleTd = isLabor ? null : moduleWithCode();
    if (isLabor) {
      const roleBtn = h('button', { class: 'ss-cellinput', style: 'text-align:left;cursor:pointer', title: '노임단가에서 직무 선택' },
        r.role_code ? `${r.role_name || r.role_code} ▾` : '직무 선택 ▾');
      roleBtn.addEventListener('click', async () => {
        const x = await pickRole();
        if (!x) return;
        r.role_code = x.role_code; r.role_name = x.role_name;
        if (!r.role_label) r.role_label = x.role_name;
        if (!r.grade) r.grade = x.grade || '';
        r.base_price = x.apply_price != null ? Number(x.apply_price) : null;
        if (!num(r.proposed_price)) r.proposed_price = r.base_price || 0;
        repaintLeft();
      });
      return h('tr', {}, sel, txt('role_label', '예) PM, 개발#1'), td(roleBtn), txt('grade', '', 'center'), td(spec),
        numIn('mm'), money('base_price'), proposed, amtCell);
    }
    const variants = bands[r.item_code];
    if (!variants) {
      trEl = h('tr', { class: isZero() ? 'qz-zero' : null }, sel, category(), moduleTd, td(spec), ...(hasBand ? [h('td', {})] : []), numIn('qty'), txt('unit', '', 'center'),
        money('base_price'), dcCell, proposed, amtCell);
      return trEl;
    }
    // 구간형 서비스 — 인원·건수 칸에서 [인원 / 건수] 를 고르고 숫자를 넣으면 구간 월 금액을 단가로 채운다. 수량 · 단위는 그대로
    const base = money('base_price');
    const PSTYLE = 'background:var(--primary-weak);color:var(--primary);font-weight:600';
    const onBandQty = (v) => { r.band_qty = v === '' ? null : v; applyBand(); upd(); };
    let bandIn = numInput(r.band_qty, onBandQty, { class: 'ss-cellinput', style: 'text-align:right;flex:1;min-width:0', 'aria-label': '인원·건수' });
    function applyBand(fill = true) {
      bandIn.disabled = !r.band;
      if (!r.band) { bandIn.title = ''; bandIn.style.color = ''; return; }
      const v = bandOf(variants, r.band, num(r.band_qty));
      bandIn.title = v ? `${v.label} 구간 — 월 ${won(v.price)}원` : '가격정책에 맞는 구간이 없습니다';
      bandIn.style.color = v ? '' : 'var(--ss-red, #FF5252)';
      if (!fill) return;
      r.base_price = v ? num(v.price) : null;
      r.proposed_price = v ? num(v.price) : null; // 맞는 구간이 없으면 빈칸
      // 단가 칸을 새 값으로 다시 만든다(numInput 은 값을 안에 쥐고 있다)
      base.replaceChildren(money('base_price').firstChild);
      proposed.replaceChildren(money('proposed_price', PSTYLE).firstChild);
    }
    const kinds = Object.keys(BAND_KINDS).filter((k) => variants.some((v) => (v.key === 'COUNT' ? 'COUNT' : 'USER') === k));
    // 직접 입력은 없다 — 인원 / 건수만(2026-10-30 사용자 요청). 예전에 저장한 견적(구간 없음)은 '선택' 으로 보이고, 고르면 구간 금액이 들어간다
    const bandSel = h('select', { class: 'ss-cellinput', style: 'text-align:center;width:72px;flex:none', title: '가격정책 구간으로 금액 채우기' },
      ...(r.band ? [] : [h('option', { value: '', selected: true, disabled: true }, '선택')]),
      ...kinds.map((k) => h('option', { value: k, selected: r.band === k }, BAND_KINDS[k][0])));
    bandSel.addEventListener('change', () => {
      r.band = bandSel.value || null;
      if (r.band && r.band_qty == null) r.band_qty = 1;
      bandUnit.textContent = r.band ? BAND_KINDS[r.band][1] : '';
      if (r.band) { r.unit = bandUnitOf(r.band); const u = txt('unit', '', 'center'); unitTd.replaceWith(u); unitTd = u; } // 단위도 명 / 건
      // 숫자 칸을 새 값으로 다시 만든다(numInput 은 값을 안에 쥐고 있다) — 처음 고르면 1
      const fresh = numInput(r.band_qty, onBandQty, { class: bandIn.className, style: bandIn.style.cssText, 'aria-label': '인원·건수' });
      bandIn.replaceWith(fresh); bandIn = fresh;
      applyBand(); upd();
    });
    const bandUnit = h('span', { style: 'font-size:12px;color:var(--ss-ink-3);width:14px' }, r.band ? BAND_KINDS[r.band][1] : '');
    applyBand(false); // 처음 그릴 때는 구간 안내만 — 이미 고친 제안단가를 덮지 않는다
    const bandCell = h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:4px;align-items:center' }, bandSel, bandIn, bandUnit));
    let unitTd = txt('unit', '', 'center');
    trEl = h('tr', { class: isZero() ? 'qz-zero' : null }, sel, category(), moduleTd, td(spec), bandCell, numIn('qty'), unitTd,
      base, dcCell, proposed, amtCell);
    return trEl;
  }

  function lines(v) { return Math.min(8, Math.max(1, String(v || '').split('\n').length)); }

  async function pasteInto(b, rows, repaint) {
    const raw = prompt('엑셀에서 복사한 내용을 붙여 넣으세요.\n형식: 모듈코드[탭]수량 (한 줄에 하나)');
    if (!raw) return;
    const parsed = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [code, qty] = l.split(/\t|,|\s{2,}/).map((v) => (v || '').trim());
      return { code, qty: qty === undefined || qty === '' ? 1 : Number(qty) };
    }).filter((p) => p.code && !Number.isNaN(p.qty));
    if (!parsed.length) return toast('인식된 행이 없습니다.', 'err');
    let master = {};
    try {
      const { items } = await http.pricing(wiz.get().applied && wiz.get().applied.solution, undefined, true);
      master = Object.fromEntries((items || []).map((i) => [i.code, i]));
    } catch { /* 마스터 조회 실패해도 코드/수량은 넣는다 */ }
    let added = 0, updated = 0; const unknown = [];
    for (const p of parsed) {
      const ex = rows.find((r) => r.item_code === p.code);
      if (ex) { ex.qty = p.qty; updated++; continue; }
      const m = master[p.code];
      if (!m) unknown.push(p.code);
      const saas = wiz.get().type.deployment === 'SAAS';
      rows.push({
        item_code: p.code, category: m ? (saas ? policyGroup(m) : m.category || null) : null, name: (m && m.name) || p.code,
        spec: (m && m.spec) || '', qty: p.qty, unit: (m && m.unit) || null,
        base_price: m && m.base_price != null ? Number(m.base_price) : null,
        proposed_price: m && m.base_price != null ? Number(m.base_price) : 0, amount: 0,
      });
      added++;
    }
    repaint();
    toast(`추가 ${added} / 수량갱신 ${updated}${unknown.length ? ` · 마스터 미등록 ${unknown.length}건(${unknown.join(', ')})` : ''}`,
      unknown.length ? 'err' : 'ok');
  }

  // shared — { cols } 를 주면 표 하나를 같이 쓰는 모드: 카드 대신 [묶음 행, 품목 행 …] 을 돌려준다(개선안 v2 — 품목 블록은 표 하나)
  function blockCard(b, repaint, shared) {
    const isLabor = b.block_code === 'LABOR';
    const noPick = b.block_code === 'SETUP' || b.block_code === 'SERVICE';
    const rows = isLabor ? b.labor : b.items;
    const picked = new Set();
    const cols = shared ? shared.cols : isLabor ? LABOR_COLS : itemCols(rows);
    const hasBand = cols.includes(BAND_COL);
    const gbtn = (label, onclick, cls = 'ss-btn--gridrow') => h('button', { class: 'ss-btn ' + cls, onclick }, label);

    const addRow = () => {
      rows.push(isLabor
        ? { role_code: '', role_name: '', role_label: '', grade: '', task: '', mm: 1, base_price: null, proposed_price: 0, amount: 0, month_alloc: {} }
        : { item_code: '', category: rows.length ? rows[rows.length - 1].category || '' : '', name: '', spec: '', unit: '', qty: 1, base_price: null, proposed_price: 0, amount: 0 });
      repaint();
    };
    // 고르는 값은 팝업에서 — 품목은 가격정책 품목, 인력은 노임단가 직무
    const pickRows = async () => {
      const s0 = wiz.get();
      if (isLabor) {
        const x = await pickRole();
        if (!x) return;
        const base = x.apply_price != null ? Number(x.apply_price) : null;
        rows.push({ role_code: x.role_code, role_name: x.role_name, role_label: x.role_name, grade: x.grade || '', task: '', mm: 1,
          base_price: base, proposed_price: base || 0, amount: 0, month_alloc: {} });
      } else {
        const list = await pickItems({ solution: s0.applied && s0.applied.solution, deployment: ITEM_DEP[s0.type.deployment] || '' });
        if (!list.length) return;
        list.forEach((i) => rows.push(s0.type.deployment === 'SAAS' ? withPolicyGroup(itemRow(i)) : itemRow(i)));
        toast(`${list.length}개 품목을 넣었습니다.`, 'ok');
      }
      repaint();
    };
    const delRows = () => {
      if (!picked.size) return toast('삭제할 행을 선택하세요.', 'err');
      for (const r of picked) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); }
      repaint();
    };
    const dropBlock = async () => {
      const n = (b.items || []).length + (b.labor || []).length;
      if (n && !(await confirmModal({ title: '블록 빼기', danger: true, okLabel: '빼기', message: `'${b.name}' 블록과 행 ${n}개를 견적에서 뺍니다.` }))) return;
      const blocks = wiz.get().blocks;
      const i = blocks.indexOf(b); if (i >= 0) blocks.splice(i, 1);
      repaint();
    };

    // 블록 순서 — 견적서에 찍히는 순서
    const all = wiz.get().blocks;
    const at = all.indexOf(b);
    const move = (d) => {
      const j = at + d;
      if (j < 0 || j >= all.length) return;
      [all[at], all[j]] = [all[j], all[at]];
      repaint();
      document.getElementById('blk-' + b.block_code)?.scrollIntoView({ block: 'nearest' });
    };
    // 묶음 머리 — 접기 · 번호 · 이름 · 위로/아래로(작은 화살표) · 소계 · 버튼(개선안 v2). 소계는 표 끝 대신 머리에
    const closed = collapsed.has(b.block_code);
    const arrow = (d) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="${d}"/></svg>`;
    const head = h('div', { class: 'qz-group' },
      h('button', { class: 'qz-caret' + (closed ? ' is-closed' : ''), title: closed ? '펴기' : '접기', html: arrow('m6 9 6 6 6-6'),
        onclick: () => { if (closed) collapsed.delete(b.block_code); else collapsed.add(b.block_code); repaint(); } }),
      h('span', { class: 'qz-group__no' }, String(at + 1)),
      h('span', { class: 'qz-group__name' }, b.name),
      b.recurring ? h('span', { class: 'qz-tag' }, '월정액') : null,
      h('span', { class: 'qz-move' },
        h('button', { disabled: at <= 0, title: '위로', html: arrow('m6 15 6-6 6 6'), onclick: () => move(-1) }),
        h('button', { disabled: at >= all.length - 1, title: '아래로', html: arrow('m6 9 6 6 6-6'), onclick: () => move(1) })),
      h('span', { class: 'qz-group__sum' }, b.recurring ? '월 소계' : '소계', h('b', { id: 'sub-' + b.block_code }, won(b._sub || 0))),
      h('span', { class: 'qz-group__tools' },
        // 셋업비용 · 서비스 이용료 블록은 품목 선택 · 엑셀 붙여넣기를 두지 않는다(2026-10-31 사용자 요청) — 행추가 후 모듈 칸에서 고른다
        gbtn('행추가', addRow), noPick ? null : gbtn(isLabor ? '직무 선택' : '품목 선택', pickRows),
        isLabor || noPick ? null : gbtn('엑셀 붙여넣기', () => pasteInto(b, rows, repaint)),
        gbtn('행삭제', delRows), gbtn('블록 빼기', dropBlock, 'ss-btn--delete')));

    const emptyText = isLabor ? '[직무 선택] 으로 노임단가 직무를 넣거나 [행추가] 로 직접 입력하세요.'
      : noPick ? '[행추가] 로 행을 넣고 모듈 칸에서 고르세요.' : '[품목 선택] 으로 가격정책 품목을 넣거나 [행추가] 로 직접 입력하세요.';
    if (shared) {
      const trs = [h('tr', { class: 'qz-grouprow', id: 'blk-' + b.block_code }, h('td', { colspan: cols.length, class: 'qz-grouptd' }, head))];
      if (!closed) {
        rows.forEach((r) => trs.push(rowEl(b, r, isLabor, picked, hasBand)));
        if (!rows.length) trs.push(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty' }, emptyText)));
        // 셋업비용 등 비-LABOR 블록의 인력 행은 금액이 아니라 인력투입계획 부록용 공수 배분 — 4단계(인건비)에서 고친다
        if (b.labor && b.labor.length) {
          trs.push(h('tr', {}, h('td', { colspan: cols.length, style: 'text-align:left;color:#64748B;font-weight:400' },
            `인력투입계획 부록용 공수 배분 ${b.labor.length}건이 있습니다. 공수는 다음 단계(인건비)에서 입력합니다.`)));
        }
      }
      return trs;
    }

    const tbody = h('tbody');
    rows.forEach((r) => tbody.appendChild(rowEl(b, r, isLabor, picked, hasBand)));
    if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty' }, emptyText)));

    const width = cols.reduce((a, [, w]) => a + w, 0);
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${width}px;min-width:100%` },
      h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
      tbody);

    const card = h('div', { class: 'qz-block', id: 'blk-' + b.block_code, style: 'scroll-margin-top:12px' }, head,
      closed ? null : h('div', { class: 'qz-block__grid' }, h('div', { class: 'ss-gridwrap', style: 'overflow:auto' }, table)));
    // 셋업비용 등 비-LABOR 블록의 인력 행은 금액이 아니라 인력투입계획 부록용 공수 배분 — 4단계(인건비)에서 고친다
    if (!closed && !isLabor && b.labor && b.labor.length) {
      card.appendChild(h('div', { class: 'banner inf', style: 'margin:0 12px 12px' },
        h('div', {}, `인력투입계획 부록용 공수 배분 ${b.labor.length}건이 있습니다. 공수는 다음 단계(인건비)에서 입력합니다.`)));
    }
    return card;
  }

  // 합계 — 두 줄 그리드(일시불 · 월 사용료). 계산 순서는 견적서와 같다: 소계 → 특별 DC → 절사(일시불만) → 부가세 별도.
  // 특별 DC 는 방식(최종금액 지정 · 할인액 · 할인율) + 값. 값을 비우면 DC 없음.
  function summaryCard(c) {
    const s0 = wiz.get();
    const dc = s0.discount || { mode: 'TARGET', value: null };
    const mdc = s0.monthly_discount || { mode: 'TARGET', value: null };
    const recalc = () => syncTotals(recalcBlocks(wiz.get()));
    const dcCell = (obj, key) => {
      const sel = h('select', { class: 'ss-cellinput', style: 'width:118px', onchange: (e) => { obj.mode = e.target.value; wiz.patch({ [key]: obj }); recalc(); } },
        ...[['TARGET', '최종금액 지정'], ['AMOUNT', '할인액'], ['RATE', '할인율 (%)']].map(([v, l]) => h('option', { value: v, selected: obj.mode === v }, l)));
      const val = numInput(obj.value ?? '', (v) => { obj.value = v === '' ? null : v; wiz.patch({ [key]: obj }); recalc(); },
        { class: 'ss-cellinput', style: 'flex:1;text-align:right', placeholder: '비우면 DC 없음' });
      return h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:4px' }, sel, val));
    };
    const ru = String(num(s0.round_unit ?? 100000));
    const roundSel = h('select', { class: 'ss-cellinput', style: 'width:96px', onchange: (e) => { wiz.patch({ round_unit: num(e.target.value) }); recalc(); } },
      ...[['100000', '십만단위'], ['10000', '만단위'], ['0', '절사 없음']].map(([v, l]) => h('option', { value: v, selected: ru === v }, l)));
    const amt = (key, strong) => (els[key] = h('span', { style: strong ? 'font-weight:700' : '' }));
    const td = (el, cls = 'ss-cell--amount') => h('td', { class: cls }, el);
    const cols = [['구분', 110], ['소계 (원)', 140], ['특별 DC', 290], ['DC 금액 (원)', 130], ['절사', 190], ['최종 금액 (원)', 150], ['부가세 10% (원)', 130]];
    const hasMonthly = c.monthly || wiz.get().blocks.some((b) => b.recurring);
    const tbody = h('tbody', {},
      h('tr', {}, h('td', { style: 'text-align:center;font-weight:600' }, '일시불'), td(amt('one')), dcCell(dc, 'discount'), td(amt('dc')),
        h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:6px;align-items:center;justify-content:flex-end' }, roundSel, amt('tr'))),
        td(amt('fin', true)), td(amt('vat'))),
      hasMonthly ? h('tr', {}, h('td', { style: 'text-align:center;font-weight:600' }, '월 사용료'), td(amt('mon')), dcCell(mdc, 'monthly_discount'), td(amt('mdc')),
        h('td', { style: 'text-align:center;color:var(--text-3)' }, '절사 안 함'), td(amt('monFin', true)), h('td', { style: 'text-align:center;color:var(--text-3)' }, '별도')) : null);
    els.warn = h('div', { style: 'display:none;margin-top:8px;padding:8px;background:var(--warn-bg);border:1px solid #FFE380;font-size:12px' });
    const card = h('div', { class: 'card', style: 'margin-bottom:12px;padding:10px 12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 합계'),
        h('span', { class: 'ss-detailbar__note' }, '소계 → 특별 DC → 절사 → 부가세 별도')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((x, [, w]) => x + w, 0)}px;min-width:100%` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
          tbody)),
      els.warn);
    syncTotals(c);
    return card;
  }

  // 견적 구성 줄 — 3단계 맨 위. 지금 블록 순서(번호 · 이름 · 소계)를 한눈에 보이고, 블록을 더한다.
  // 블록 순서가 견적서에 찍히는 순서다. 순서 바꾸기는 각 블록 머리의 ▲ ▼ (또는 이 줄의 칩을 누르면 그 블록으로 간다).
  function blockBar() {
    const blocks = wiz.get().blocks;
    const sel = h('select', { class: 'ss-select', style: 'width:220px' });
    const btn = h('button', { class: 'ss-btn ss-btn--save' }, '블록 추가');
    blockDefs().then((defs) => {
      const have = new Set(blocks.map((x) => x.block_code));
      const opts = defs.filter((d) => d.code !== 'SUMMARY' && !have.has(d.code)).map((d) => [d.code, `${d.name}${d.recurring ? ' (월)' : ''}`]);
      if (!payOn()) opts.push(['__PAY', '결제 방안']); // 뺀 결제 방안을 다시 넣는다
      if (!condsOn(wiz.get())) opts.push(['__COND', '견적조건']); // 뺀 견적조건을 다시 넣는다
      sel.replaceChildren(...(opts.length ? opts.map(([v, l]) => h('option', { value: v }, l))
        : [h('option', { value: '' }, '더할 블록이 없습니다')]));
      btn.disabled = !opts.length;
    });
    btn.addEventListener('click', async () => {
      if (sel.value === '__PAY' || sel.value === '__COND') {
        if (sel.value === '__PAY') setPay({ enabled: true });
        else wiz.patch({ conds_on: true });
        openDocs.add(sel.value === '__PAY' ? 'PAY' : 'CONDS'); // 다시 넣으면 펼쳐서 보인다
        repaintLeft();
        document.getElementById(sel.value === '__PAY' ? 'blk-PAY' : 'blk-CONDS')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const d = (await blockDefs()).find((x) => x.code === sel.value);
      if (!d) return;
      // 새 블록은 맨 아래에 붙인다 — 자리는 ▲ ▼ 로 옮긴다
      wiz.get().blocks.push({ block_code: d.code, name: d.name, recurring: !!d.recurring, ...(d.code === 'LABOR' ? { labor: [] } : { items: [] }) });
      repaintLeft();
      document.getElementById('blk-' + d.code)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // 예전 '견적 구성' 칩 줄은 뺐다 — 순서 · 소계는 묶음 머리 번호와 오른쪽 견적 요약이 대신한다(개선안 v2)
    sel.style.height = '30px'; btn.style.height = '30px';
    return h('div', { class: 'qz-cardhead' },
      // 필수 — 블록 · 품목이 없거나 금액이 0원이면 발행할 수 없다(5단계 발행 전 확인)
      h('span', { class: 'qz-cardhead__title', style: 'white-space:nowrap', title: '블록과 품목을 넣어야 발행할 수 있습니다' }, '견적 품목', h('span', { class: 'req-mark' }, '*')),
      blocks.length ? null : h('span', { class: 'ss-detailbar__note' }, '견적서에 넣을 블록(셋업비용 · 솔루션 견적 · 서비스 이용료 · 개발인건비 등)을 먼저 추가하세요.'),
      h('div', { class: 'ss-detailbar__spacer' }), sel, btn);
  }

  // ── 구성 질문(SaaS) — 개선안 v2 2번(2026-11-02 사용자 승인) ──────────────
  // 답하면 아래 품목 행이 바뀐다. 표에서 직접 고친 값은 질문을 다시 건드리기 전까지 그대로 둔다.
  //   서비스     — 서비스 이용료 · '(S2C)' 붙은 품목을 고른 서비스로(syncService)
  //   요금 기준  — 서비스 이용료 행의 인원 / 건수 + 숫자 → 가격정책 구간 금액
  //   독립인프라 — 사용: 고른 서비스의 독립인프라 행을 넣는다(금액은 비움) / 사용 안 함: 뺀다
  //   내부 연계  — 내부시스템 연계 품목 설명의 ■ 항목 중 고른 것만 세부기능에 남긴다
  function questionsCard() {
    if (!catalog || !catalog.services.length) return null;
    const st = wiz.get();
    const allRows = () => (wiz.get().blocks || []).flatMap((b) => (b.items || []).map((r) => ({ b, r })));
    const svcCode = quoteService(st, catalog.services);
    const svc = catalog.services.find((x) => x.code === svcCode);
    const field = (label, ...ctrl) => h('div', { class: 'qz-q__item' }, h('label', {}, label), ...ctrl);
    const dis = (el, on) => { if (on || wiz.readOnly) el.disabled = true; return el; };

    // 서비스
    const svcSel = dis(h('select', { class: 'ss-select', onchange: (e) => {
      wiz.patch({ type: { service: e.target.value } });
      const n = syncService(wiz.get(), e.target.value, catalog);
      // 서비스 이용료 행 — 이름은 가격정책 용어 그대로, 이미 넣은 인원 · 건수가 있으면 새 서비스의 구간 금액으로
      for (const b of wiz.get().blocks || []) for (const it of b.items || []) {
        if (!bands[it.item_code]) continue;
        if (svcTerm) it.name = svcTerm;
        const v = it.band && it.band_qty != null && it.band_qty !== '' ? bandOf(bands[it.item_code], it.band, num(it.band_qty)) : null;
        if (v) { it.base_price = num(v.price); it.proposed_price = num(v.price); }
      }
      repaintLeft();
      if (n) toast(`서비스에 맞춰 ${n}개 행을 바꿨습니다.`, 'ok');
    } }, ...(svcCode ? [] : [h('option', { value: '', selected: true, disabled: true }, '선택')]),
    ...catalog.services.map((x) => h('option', { value: x.code, selected: x.code === svcCode }, `${x.label} — ${x.item.spec || ''}`))));

    // 요금 기준 — 서비스 이용료 행(구간형)
    const bandHit = allRows().find(({ r }) => bands[r.item_code]);
    const bandRow = bandHit && bandHit.r;
    const variants = bandRow ? bands[bandRow.item_code] : [];
    const kinds = Object.keys(BAND_KINDS).filter((k) => variants.some((v) => (v.key === 'COUNT' ? 'COUNT' : 'USER') === k));
    const applyBandQ = (band, qty) => {
      if (!bandRow) return;
      bandRow.band = band || null;
      bandRow.band_qty = qty === '' || qty == null ? null : num(qty);
      if (bandRow.band) bandRow.unit = bandUnitOf(bandRow.band);
      const v = bandRow.band && bandRow.band_qty != null ? bandOf(variants, bandRow.band, bandRow.band_qty) : null;
      bandRow.base_price = v ? num(v.price) : null;
      bandRow.proposed_price = v ? num(v.price) : null;
      repaintLeft();
    };
    const kindSel = dis(h('select', { class: 'ss-select', style: 'width:90px;flex:none', onchange: (e) => applyBandQ(e.target.value, bandRow.band_qty ?? 1) },
      ...(bandRow && bandRow.band ? [] : [h('option', { value: '', selected: true, disabled: true }, '선택')]),
      ...kinds.map((k) => h('option', { value: k, selected: bandRow && bandRow.band === k }, BAND_KINDS[k][0]))), !bandRow);
    const qtyIn = dis(numInput(bandRow ? bandRow.band_qty ?? '' : '', () => {}, { class: 'ss-input', style: 'text-align:right;flex:1;min-width:0',
      onchange: (e) => applyBandQ(bandRow.band || kinds[0], String(e.target.value).replace(/,/g, '')) }), !bandRow || !bandRow.band);
    const qtyUnit = h('span', { style: 'align-self:center;font-size:13px;width:14px' }, bandRow && bandRow.band ? BAND_KINDS[bandRow.band][1] : '');

    // 독립인프라
    const infraHits = allRows().filter(({ r }) => /^독립인프라/.test(String(r.name || '')));
    const infraItem = svc && catalog.items.find((x) => x.name === `독립인프라(${svc.label})`);
    const infraSel = dis(h('select', { class: 'ss-select', onchange: (e) => {
      if (e.target.value === 'N') {
        for (const { b, r } of infraHits) { const i = b.items.indexOf(r); if (i >= 0) b.items.splice(i, 1); }
      } else if (infraItem) {
        // 서비스 이용료 행이 있는 블록(없으면 첫 월정액 블록)에 넣는다 — 금액은 비움(셋업비용 밖 규칙)
        const blk = (bandHit && bandHit.b) || (wiz.get().blocks || []).find((b) => b.recurring);
        if (!blk) { toast('월정액 블록(서비스 이용료)을 먼저 넣으세요.', 'err'); return repaintLeft(); }
        blk.items = blk.items || [];
        blk.items.push({ ...withPolicyGroup(itemRow(infraItem)), base_price: null, proposed_price: 0, amount: 0 });
      }
      repaintLeft();
    } }, h('option', { value: 'Y', selected: infraHits.length > 0 }, '사용'), h('option', { value: 'N', selected: !infraHits.length }, '사용 안 함')),
    !infraHits.length && !infraItem);

    // 내부 연계 — 품목 설명의 ■ 항목
    const ifHit = allRows().find(({ r }) => r.item_code === 'PRO_SAAS_IF' || r.name === '내부시스템 연계');
    const ifItem = catalog.items.find((x) => x.code === 'PRO_SAAS_IF');
    const sections = [];
    for (const line of String((ifItem && ifItem.spec) || '').split('\n')) {
      if (/^\s*■/.test(line)) sections.push({ title: line.replace(/^\s*■\s*/, '').trim(), lines: [line] });
      else if (sections.length) sections[sections.length - 1].lines.push(line);
    }
    const ifSpec = ifHit ? String(ifHit.r.spec || '') : '';
    const checks = sections.map((sec) => {
      const cb = dis(h('input', { type: 'checkbox', checked: !!ifHit && ifSpec.includes(sec.title), onchange: () => {
        const on = checks.filter(([c]) => c.checked).map(([, x]) => x);
        ifHit.r.spec = on.map((x) => x.lines.join('\n')).join('\n');
        repaintLeft();
      } }), !ifHit);
      return [cb, sec];
    });

    return h('div', { class: 'qz-card' },
      h('div', { class: 'qz-cardhead' }, h('span', { class: 'qz-cardhead__title' }, '구성 질문'),
        h('span', { class: 'ss-detailbar__note' }, '답하면 아래 품목이 바뀝니다. 표에서 직접 고친 값은 그대로 둡니다.')),
      h('div', { class: 'qz-q' },
        field('서비스', svcSel),
        field('요금 기준', h('div', { class: 'qz-q__row' }, kindSel, qtyIn, qtyUnit)),
        field('독립인프라', infraSel),
        field('내부 연계', sections.length
          ? h('div', { class: 'qz-checks' }, ...checks.map(([cb, sec]) => h('label', {}, cb, sec.title.replace(/\(.*\)$/, ''))))
          : h('span', { class: 'ss-detailbar__note' }, '연계 항목이 없습니다'))));
  }

  // 품목 블록은 표 하나에 묶음 행으로(머리 칸은 한 번만). 개발인건비(LABOR)는 칸이 달라 그 자리에 따로 표를 둔다
  function blockTables() {
    const blocks = wiz.get().blocks;
    const cols = itemCols(blocks.filter((b) => b.block_code !== 'LABOR').flatMap((b) => b.items || []));
    const specAt = cols.findIndex(([t]) => t === '세부기능');
    const minW = cols.reduce((a, [, w], i) => a + (i === specAt ? 200 : w), 0);
    const table = (trs) => h('div', { class: 'qz-block__grid' }, h('div', { class: 'ss-gridwrap', style: 'overflow:auto' },
      h('table', { class: 'ss-grid ss-grid--sized qz-onetable', style: `width:100%;min-width:${minW}px` },
        // 세부기능 칸은 너비를 두지 않는다 — 남는 폭을 받아 표가 화면 폭에 맞는다
        h('colgroup', {}, ...cols.map(([, w], i) => h('col', { style: i === specAt ? '' : `width:${w}px` }))),
        h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
        h('tbody', {}, ...trs))));
    const parts = [];
    let cur = null;
    for (const b of blocks) {
      if (b.block_code === 'LABOR') {
        if (cur) { parts.push(table(cur)); cur = null; }
        parts.push(blockCard(b, repaintLeft));
        continue;
      }
      (cur = cur || []).push(...blockCard(b, repaintLeft, { cols }));
    }
    if (cur) parts.push(table(cur));
    return parts;
  }

  function repaintLeft() {
    const c = recalcBlocks(wiz.get());
    left.replaceChildren();
    const q = questionsCard();
    if (q) left.appendChild(q);
    // 결제 방안은 견적 품목 카드 안 맨 아래 묶음으로(블록들 다음 번호) — 견적서 문구 카드에는 견적조건만
    const nBlocks = wiz.get().blocks.length;
    els.payPlan = null; els.payNote = null;
    left.appendChild(h('div', { class: 'qz-card' }, blockBar(), ...blockTables(), payOn() ? payPlanCard(nBlocks + 1, 'group') : null));
    // 견적서 순서대로 번호 — 블록들 다음 결제 방안(넣는 경우), 그다음 견적조건
    const n = wiz.get().blocks.length;
    const payNo = payOn() ? n + 1 : null;
    const condNo = condsOn(wiz.get()) ? n + (payOn() ? 2 : 1) : null;
    // 옵션(서버이중화 · 계열사 추가 등 규칙 마스터 연동) 안내 칸은 뺐다 — 기능이 생기면 그때 넣는다
    // 견적서와 같은 순서 — 결제 방안 다음에 견적조건
    if (condNo) left.appendChild(docsCard(null, condNo));
    // 합계 표(소계 · 특별 DC · 절사 · 부가세)는 화면에서 뺐다(2026-11-02 사용자 요청) — 금액은 5단계 견적 요약 · 미리보기에서 본다.
    // 저장된 특별 DC · 절사 값은 그대로 계산에 쓴다. 인력투입계획 경고 줄만 남긴다. summaryCard 는 다시 쓸 때를 위해 둔다
    // 인력투입계획 경고는 오른쪽 '발행 전 확인' 에 함께 보인다(els.warn 은 두지 않는다)
    syncTotals(c);
    wiz.patch({});
    preview.schedule(wiz);
  }

  // 견적서 문구 — 결제 방안 · 견적조건은 접힌 요약 줄. 누르면 그 자리에서 펼쳐 고친다(개선안 v2)
  function docsCard(payNo, condNo) {
    const row = (key, no, name, summary, build) => {
      const open = openDocs.has(key);
      const line = h('div', { class: 'qz-doc', onclick: () => { if (open) openDocs.delete(key); else openDocs.add(key); repaintLeft(); } },
        h('span', { class: 'qz-group__no' }, String(no)), h('span', { class: 'qz-doc__name' }, name),
        h('span', { class: 'qz-doc__sum' }, open ? '' : summary), h('span', { class: 'qz-doc__open' }, open ? '접기 ▴' : '펼치기 ▾'));
      return h('div', {}, line, open ? build() : null);
    };
    const pp = payState();
    const r = pp.ratio ?? 50;
    const conds = (wiz.get().conds || []).filter((c) => c.text && c.text.trim());
    return h('div', { class: 'qz-card' },
      h('div', { class: 'qz-cardhead', style: 'border-bottom:0' }, h('span', { class: 'qz-cardhead__title' }, '견적서 문구'),
        h('span', { class: 'ss-detailbar__note' }, '누르면 펼쳐서 고칩니다')),
      payNo ? row('PAY', payNo, '결제 방안', `셋업비용 계약체결 ${r}% / 구축완료 ${100 - r}%${Array.isArray(pp.rows) && pp.rows.length ? ' · 직접 고친 문구' : ''}`, () => payPlanCard(payNo, true)) : null,
      condNo ? row('CONDS', condNo, '견적조건', conds.length ? `${conds.length}문장 — ${conds[0].text}` : '문장 없음 — 견적서에 찍히지 않습니다', () => condCard(condNo, true)) : null);
  }

  // 견적조건 — 템플릿 조건셋으로 채워지고, 여기서 문구를 고치거나 줄을 더한다.
  // 견적서 하단 "▣ 견적조건" 블록이 이 배열을 그대로 싣는다.
  function condCard(no, embedded) {
    const conds = wiz.get().conds || [];
    const list = h('div', {});
    const touch = () => { wiz.patch({ conds }); preview.schedule(wiz); };
    const rowOf = (c) => {
      const row = h('div', { style: 'display:flex;gap:6px;margin-bottom:6px' },
        h('input', { class: 'input', style: 'flex:1', value: c.text || '',
          oninput: (e) => { c.text = e.target.value; touch(); } }));
      const del = h('button', { class: 'btn btn-sm btn-danger' }, '×');
      del.addEventListener('click', () => {
        const i = conds.indexOf(c); if (i >= 0) conds.splice(i, 1);
        row.remove(); touch();
      });
      row.appendChild(del);
      return row;
    };
    conds.forEach((c) => list.appendChild(rowOf(c)));
    // 문구가 비어 있으면 견적서에 견적조건 칸이 찍히지 않는다
    const empty = h('div', { class: 'ss-detailbar__note' }, '견적조건 문구가 없습니다. [행추가] 로 넣으세요. 비워 두면 견적서에 찍히지 않습니다.');
    if (!conds.length) list.appendChild(empty);
    const add = h('button', { class: 'ss-btn ss-btn--gridrow' }, '행추가');
    add.addEventListener('click', () => {
      empty.remove();
      const c = { text: '' }; conds.push(c); list.appendChild(rowOf(c)); touch();
    });
    return h('div', { class: embedded ? '' : 'card', id: 'blk-CONDS', style: (embedded ? 'padding:0 12px 12px' : 'margin-bottom:12px;padding:10px 12px') + ';scroll-margin-top:12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        embedded ? null : h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${no}. 견적조건`),
        h('span', { class: 'ss-detailbar__note' }, '견적서 하단에 그대로 인쇄됩니다'),
        h('div', { class: 'ss-detailbar__spacer' }), add,
        // 빼도 문장은 남겨 둔다 — 블록 추가에서 다시 넣으면 그대로 돌아온다
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => { wiz.patch({ conds_on: false }); repaintLeft(); } }, '블록 빼기')),
      h('div', { style: 'margin-top:8px' }, list));
  }

  // ── 결제 방안 ───────────────────────────────────────────────
  // 견적마다 고친다(state.pay_plan = { enabled, ratio, rows }).
  //   enabled — 견적서에 넣을지. 없으면 템플릿 설정(has_pay_plan)을 따른다 — 직접 작성 견적도 켤 수 있다
  //   ratio   — 셋업비용 계약체결 시 비율(%), 나머지는 구축완료 후. 바꾸면 기본 문구를 다시 만든다
  //   rows    — 직접 고친 표. null 이면 금액 · 비율로 기본 문구(서버 QuoteHtml.payPlanRows 와 같은 문구)
  const PAY_COLS = [['선택', 44], ['구분', 150], ['지급시점', 220], ['비용', 360], ['내역', 420]];
  const payState = () => wiz.get().pay_plan || {};
  const payOn = () => {
    const pp = payState();
    return 'enabled' in pp ? !!pp.enabled : !!(wiz.get().applied && wiz.get().applied.has_pay_plan);
  };
  const setPay = (part) => { wiz.patch({ pay_plan: { ...payState(), ...part } }); };

  const shownPayRows = (c) => {
    const pp = payState();
    return Array.isArray(pp.rows) && pp.rows.length ? pp.rows : payPlanDefault(c.final, c.monthlyFinal, pp.ratio ?? 50);
  };

  // 결제 방안을 넣는 견적에서만 그린다(repaintLeft). 빼면 맨 위 [블록 추가] 목록에 '결제 방안' 이 나온다
  function payPlanCard(no, embedded) {
    const pp = payState();
    const picked = new Set();
    const gbtn = (label, onclick) => h('button', { class: 'ss-btn ss-btn--gridrow', onclick }, label);
    // 처음 고치는 순간 지금 보이는 기본 문구를 견적에 옮겨 담는다 — 그 뒤로는 금액이 바뀌어도 그대로 둔다
    const materialize = () => {
      const c = recalcBlocks(wiz.get());
      if (!(Array.isArray(payState().rows) && payState().rows.length)) setPay({ rows: shownPayRows(c).map((r) => [...r]) });
      return payState().rows;
    };
    const ratio = numInput(pp.ratio ?? 50, () => {}, { class: 'ss-input', style: 'width:70px;text-align:right',
      onchange: (e) => {
        const v = Number(e.target.value);
        if (!(v > 0 && v <= 100)) { e.target.value = payState().ratio ?? 50; return toast('비율은 1~100 사이로 넣으세요.', 'err'); }
        setPay({ ratio: v, rows: null }); // 비율로 기본 문구를 다시 만든다
        repaintLeft();
        toast(`계약체결 ${v}% / 구축완료 ${100 - v}% 로 다시 만들었습니다.`, 'ok');
      } });
    const tools = [
        gbtn('행추가', () => { const rows = materialize(); rows.push(['', '', '', '']); setPay({ rows }); repaintLeft(); }),
        gbtn('행삭제', () => {
          if (!picked.size) return toast('삭제할 행을 선택하세요.', 'err');
          const rows = materialize().filter((_, i) => !picked.has(i));
          setPay({ rows }); repaintLeft();
        }),
        gbtn('기본값으로', () => { setPay({ rows: null }); repaintLeft(); toast('금액과 비율로 기본 문구를 다시 만들었습니다.', 'ok'); }),
        // 빼면 견적서에서 결제 방안 표가 빠진다. 다시 넣을 때는 맨 위 [블록 추가] 에서 '결제 방안'
        h('button', { class: 'ss-btn ss-btn--delete', onclick: () => { setPay({ enabled: false }); repaintLeft(); toast('결제 방안을 뺐습니다. 맨 위 [블록 추가] 에서 다시 넣을 수 있습니다.', 'ok'); } }, '블록 빼기'),
    ];
    const ratioLabel = h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;margin-left:' + (embedded ? '4px' : '12px') }, '계약체결 시', ratio, '%');
    // group — 견적 품목 카드 안의 묶음(2026-11-02 사용자 요청 "결제방안도 견적 품목으로"). 머리 줄은 다른 블록과 같은 모양
    if (embedded === 'group') {
      const closed = collapsed.has('PAY');
      const head = h('div', { class: 'qz-group', style: 'border-top:2px solid var(--ss-bd)' },
        h('button', { class: 'qz-caret' + (closed ? ' is-closed' : ''), title: closed ? '펴기' : '접기',
          html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>',
          onclick: () => { if (closed) collapsed.delete('PAY'); else collapsed.add('PAY'); repaintLeft(); } }),
        h('span', { class: 'qz-group__no' }, String(no)), h('span', { class: 'qz-group__name' }, '결제 방안'), ratioLabel,
        h('span', { class: 'qz-group__sum' }), h('span', { class: 'qz-group__tools' }, ...tools));
      const blk = h('div', { class: 'qz-block', id: 'blk-PAY', style: 'scroll-margin-top:12px' }, head);
      if (closed) return blk;
      const body = h('div', { class: 'qz-block__grid' });
      blk.appendChild(body);
      const tbody = h('tbody');
      els.payPlan = { tbody, picked };
      paintPayPlan(recalcBlocks(wiz.get()));
      body.appendChild(h('div', { class: 'ss-gridwrap', style: 'overflow:auto' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${PAY_COLS.reduce((x, [, w]) => x + w, 0)}px;min-width:100%` },
          h('colgroup', {}, ...PAY_COLS.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...PAY_COLS.map(([t]) => h('th', {}, t)))),
          tbody)));
      body.appendChild(els.payNote = h('div', { class: 'ss-detailbar__note', style: 'margin-top:6px' }));
      paintPayNote();
      return blk;
    }
    const bar = h('div', { class: 'ss-detailbar', style: 'margin-top:0;flex-wrap:wrap' },
      embedded ? null : h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${no}. 결제 방안`),
      ratioLabel, h('div', { class: 'ss-detailbar__spacer' }), ...tools);
    const card = h('div', { class: embedded ? '' : 'card', id: 'blk-PAY', style: (embedded ? 'padding:0 12px 12px' : 'margin-bottom:12px;padding:10px 12px') + ';scroll-margin-top:12px' }, bar);
    const tbody = h('tbody');
    els.payPlan = { tbody, picked };
    paintPayPlan(recalcBlocks(wiz.get()));
    card.appendChild(h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
      h('table', { class: 'ss-grid ss-grid--sized', style: `width:${PAY_COLS.reduce((x, [, w]) => x + w, 0)}px;min-width:100%` },
        h('colgroup', {}, ...PAY_COLS.map(([, w]) => h('col', { style: `width:${w}px` }))),
        h('thead', {}, h('tr', {}, ...PAY_COLS.map(([t]) => h('th', {}, t)))),
        tbody)));
    card.appendChild(els.payNote = h('div', { class: 'ss-detailbar__note', style: 'margin-top:6px' }));
    paintPayNote();
    return card;
  }

  function paintPayNote() {
    if (!els.payNote) return;
    els.payNote.textContent = Array.isArray(payState().rows) && payState().rows.length
      ? '직접 고친 내용입니다 — 금액이 바뀌어도 그대로 둡니다. [기본값으로] 를 누르면 지금 금액 · 비율로 다시 만듭니다.'
      : '기본 문구입니다 — 금액 · 비율을 따라 바뀝니다. 칸을 고치면 그 뒤로는 고친 내용을 씁니다.';
  }

  function paintPayPlan(c) {
    const ref = els.payPlan;
    if (!ref) return;
    const custom = Array.isArray(payState().rows) && payState().rows.length;
    // 직접 고친 표는 금액이 바뀌어도 다시 그리지 않는다(입력 중인 칸이 날아가지 않게)
    if (custom && ref.tbody.childElementCount) return;
    const rows = shownPayRows(c);
    ref.tbody.replaceChildren(...rows.map((r, i) => h('tr', {},
      h('td', {}, h('input', { type: 'checkbox', 'aria-label': '선택', checked: ref.picked.has(i),
        onchange: (e) => { if (e.target.checked) ref.picked.add(i); else ref.picked.delete(i); } })),
      ...r.map((v, j) => {
        const ta = h('textarea', { class: 'ss-cellinput', rows: lines(v),
          style: 'height:auto;resize:vertical;line-height:1.5;padding:4px 6px;text-align:' + (j === 0 ? 'center' : 'left'),
          oninput: (e) => {
            const rowsNow = materialize2();
            rowsNow[i][j] = e.target.value;
            e.target.rows = lines(e.target.value);
            setPay({ rows: rowsNow });
            paintPayNote();
          } });
        ta.value = v;
        return h('td', { class: 'ss-cell--input' }, ta);
      }))));
  }
  // 칸 입력용 — 기본 문구를 견적에 옮겨 담고 그 배열을 돌려준다
  function materialize2() {
    const pp = payState();
    if (Array.isArray(pp.rows) && pp.rows.length) return pp.rows.map((r) => [...r]);
    return shownPayRows(recalcBlocks(wiz.get())).map((r) => [...r]);
  }

  repaintLeft();
}
