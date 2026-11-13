// 견적 작성 위저드 — 4단계(2026-11-03 5단계 검토·결재요청 탭을 없앰). 상태는 여기서만 보관하고 각 step 은 순수 렌더러다.
// 순서: ① 유형 선택 → ② 기본정보 → ③ 구성 → ④ 인력투입계획(2026-11-03 이름 변경) (2026-10-30 사용자 요청 — 유형을 먼저 고른다).
// 파일 이름(step1-basic · step2-type)은 예전 순서 그대로다.
//
// step 계약:  render(root, state, api) → void
//   state 를 읽어 화면을 그리고, 값이 바뀌면 api.patch({...}) 로 변경분만 돌려준다.
//   단계 이동은 api.go(n) / api.next() / api.prev().
//
// 신규(#/quotes/new)는 늘 빈 화면에서 시작한다(2026-10-29 사용자 요청 — 예전 브라우저 자동 보관 · 복원은 없앴다).
// 임시저장 버튼 — 서버에 '작성중(DRAFT)' 견적으로 저장한다. 견적 목록에 나오고 다른 PC 에서도 이어 쓴다.
//      처음엔 POST 로 견적번호를 받고, 그 뒤로는 같은 견적을 PUT 으로 덮어쓴다.
// 수정: #/quotes/:id/edit 은 저장된 견적을 읽어 위저드 상태로 되돌린 뒤 STEP③ 에서 연다.
//      수정 중에는 브라우저 자동 보관을 하지 않는다(새 견적 작성분과 섞이지 않게).
// 상세: #/quotes/:id 는 같은 화면을 읽기 전용(readOnly)으로 연다 — 입력은 모두 잠그고 단계 이동만 된다.
//      상태(작성중 · 발송 · 수주 · 실주)만 상세에서도 바로 바꾼다(PATCH /status).
//      상세 ↔ 수정을 오갈 때 보던 단계를 이어서 연다(sessionStorage).
import { api as http } from '../../../api.js';
import { copyQuote, reviseQuote, viewQuote, deleteQuote, downloadQuote, mailQuote } from '../quote-actions.js';
import { h, toast, clear, confirmModal } from '../../../ui.js';
import { setPage } from '../../../layout/gnb.js';
import { renderStep1, uploadPendingFiles } from './step1-basic.js';
import { renderStep2, validateStep2, resetTemplateCache } from './step2-type.js';
import { renderStep3, openPreview, BAND_LINE_RE, configMissing, svcFeeMissing, priceMissingRows, zeroBlocks, focusZero, sortLaborByRole } from './step3-config.js';
import { openQuotePicker } from './quote-picker.js';
import { renderStep4 } from './step4-labor.js';
import { reviewActions, quotePayload } from './step5-review.js';

const DRAFT_KEY = 'sq.wizard.draft.v1';
const OPEN_STEP_KEY = 'sq.wizard.openStep'; // 상세 ↔ 수정 전환 때 이어서 열 단계
export const STATUS_OPTS = [['DRAFT', '작성중'], ['SENT', '발송'], ['WON', '수주'], ['LOST', '실주']];

const STEPS = [
  { n: 1, label: '유형 선택', render: renderStep2 },
  { n: 2, label: '기본정보', render: renderStep1 },
  { n: 3, label: '구성', render: renderStep3 },
  { n: 4, label: '인력투입계획', render: renderStep4 },
];

// 날짜 → 'YYYY-MM-DD'(한국 시간 그대로). toISOString 은 세계 표준시로 바꿔 하루 앞 날짜가 된다
// (2026-11-07 오류 수정: 견적유효일이 +29일로, 오전 9시 전 견적일자가 어제로 들어갔다)
const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
function addDays(d, n) {
  const x = new Date((d || todayStr()) + 'T00:00:00');
  x.setDate(x.getDate() + n);
  return ymd(x);
}

function blankState() {
  return {
    step: 1,
    basic: {
      customer_name: '', customer_contact: '', purpose: '', phone: '', email: '',
      quote_date: todayStr(), valid_until: addDays(todayStr(), 30),
      pay_terms: '고객사 결제조건', install_note: '협의된 프로젝트 기간',
      // 기업구분 — 드롭다운(기업구분 마스터 key). 메모 [기업구분] 줄로 저장한다. 채널(DIRECT · AGENCY)은 [채널] 줄
      company_class: null, channel: null,
      // 상주 여부(ONSITE · REMOTE · PARTIAL) — 온프레미스 견적 품목 머리에서 고른다. 메모 [상주] 줄(2026-11-02)
      onsite: 'ONSITE',
      // 투입 개월수 — 4단계 인력투입계획의 M1 ~ Mn 칸 수. 메모 [투입개월] 줄(2026-11-03)
      plan_months: null,
      // 실제 투입 시작월(선택, 'YYYY-MM') — 넣으면 M1 ~ Mn 아래에 26.11 같은 실제 월을 붙인다. 메모 [투입시작] 줄(2026-11-03)
      plan_start: '',
      // 담당자 정보(우리 영업 담당) — 로그인한 사용자로 채운다. 메모 [영업담당] · [영업연락처] · [영업이메일] 줄(2026-11-02)
      rep_name: '', rep_phone: '', rep_email: '',
      // 최종 고객사 — 채널이 간접(AGENCY)일 때. 수신처는 중간업체(예: BSG), 견적용도에는 최종 고객(예: JW). 메모 [최종고객]
      end_customer: '',
      // 근거 메일(V14 source_mail) — 고객사에서 온 메일 링크 · 붙여넣은 본문. 본문에서 고객 담당자 · 연락처 · 이메일을 뽑는다
      mail_url: '', mail_text: '',
      // 유지보수 견적(견적 종류 MAINT, 2026-11-07) — 금액 기준: QUOTE 구축 견적 불러오기 · MANUAL 직접 입력 · PREV 전년도 금액.
      //   원 견적번호 · 원 계약명 · 계약일 · 솔루션 공급가 / 전년도 금액(연) · 인상률(%) / 유지보수 기간. 메모 [유지보수기준] 등 줄로 저장
      maint_basis: 'QUOTE', maint_ref: '', maint_contract: '', maint_date: '', maint_supply: null,
      maint_prev: null, maint_raise: null, maint_from: '', maint_to: '',
    },
    type: { quote_type: 'BUILD', deployment: null, template_code: null, solution: null }, // solution — 1단계에서 고른 솔루션(템플릿을 거른다)
    blocks: [], applied: null, laborYear: null, hasLaborPlan: false,
    round_unit: 100000,
    discount: { mode: 'TARGET', value: null },          // null = DC 미적용
    monthly_discount: { mode: 'TARGET', value: null },  // 월 사용료 특별DC (하겐다즈 SaaS 300,000→100,000)
    conds: [], riskFactors: [],
    conds_on: null, // 견적조건 블록을 넣었는가 — null 이면 문장이 있는지로 정한다(step3 condsOn)
    savedAt: null,
    quoteId: null, quoteNo: null, // 서버에 저장된 견적이면 채워진다 (임시저장 또는 수정)
    status: 'DRAFT',
    pay_plan: null, // 견적별 결제 방안 { enabled, ratio, rows } — null 이면 템플릿 설정 · 기본 문구
  };
}

// 저장된 견적 → 위저드 상태. 메모에 접어 둔 견적용도·결제조건·연락처·이메일을 다시 풀어낸다(previewHeader 의 역).
const MEMO_KEYS = { 견적용도: 'purpose', 결제조건: 'pay_terms', 연락처: 'phone', 이메일: 'email', 기업구분: 'company_class', 상주: 'onsite', 투입개월: 'plan_months', 투입시작: 'plan_start',
  채널: 'channel', 최종고객: 'end_customer', 영업담당: 'rep_name', 영업연락처: 'rep_phone', 영업이메일: 'rep_email',
  유지보수기준: 'maint_basis', 원견적: 'maint_ref', 원계약: 'maint_contract', 계약일: 'maint_date', 솔루션공급가: 'maint_supply',
  전년도금액: 'maint_prev', 인상률: 'maint_raise', 유지보수기간: 'maint_period' };
const n0 = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const day = (v) => (v ? String(v).slice(0, 10) : '');
function dcOf(type, value) {
  // 저장 시 할인 없음은 type null 로 남는다. TARGET 0 은 무상제공이라 값 0 을 살린다.
  return type ? { mode: type, value: n0(value) ?? 0 } : { mode: 'TARGET', value: null };
}
// SaaS 구간 행(step3-config.js) — note 'BAND:키:숫자' 를 읽고, 저장할 때 붙인 세부기능 끝 '(건수 40건 기준)' 줄을 떼어 낸다
function bandOfNote(it) {
  const m = /^BAND:(USER|COUNT|COMPANY)(?::([\d.]+))?$/.exec(it.note || '');
  if (!m) return { spec: it.spec };
  return { spec: String(it.spec || '').replace(BAND_LINE_RE, ''), band: m[1], band_qty: m[2] != null ? Number(m[2]) : Number(it.qty) || 1 };
}

function fromQuote(q, tpl, tplConds) {
  const st = blankState();
  const memo = {};
  for (const line of String(q.memo || '').split('\n')) {
    const m = line.match(/^\[(.+?)\]\s?(.*)$/);
    if (m && MEMO_KEYS[m[1]]) memo[MEMO_KEYS[m[1]]] = m[2];
  }
  Object.assign(st.basic, {
    customer_name: q.customer_name || '', customer_contact: q.customer_contact || '',
    quote_date: day(q.quote_date) || st.basic.quote_date, valid_until: day(q.valid_until),
    purpose: memo.purpose || '', phone: memo.phone || '', email: memo.email || '', company_class: memo.company_class || null, onsite: ({ 비상주: 'REMOTE', 부분상주: 'PARTIAL' })[memo.onsite] || 'ONSITE', plan_months: n0(memo.plan_months), plan_start: memo.plan_start || '',
    mail_url: (q.source_mail && q.source_mail.url) || '', mail_text: (q.source_mail && q.source_mail.text) || '',
    channel: memo.channel || null, end_customer: memo.end_customer || '', rep_name: memo.rep_name || '', rep_phone: memo.rep_phone || '', rep_email: memo.rep_email || '',
    pay_terms: memo.pay_terms && memo.pay_terms !== '-' ? memo.pay_terms : '',
    maint_basis: memo.maint_basis || 'QUOTE', maint_ref: memo.maint_ref || '', maint_contract: memo.maint_contract || '', maint_date: memo.maint_date || '',
    maint_supply: n0(memo.maint_supply), maint_prev: n0(memo.maint_prev), maint_raise: n0(memo.maint_raise),
    maint_from: String(memo.maint_period || '').split('~')[0] || '', maint_to: String(memo.maint_period || '').split('~')[1] || '',
  });
  st.type = { quote_type: q.quote_type || 'BUILD', deployment: q.deployment, template_code: q.template_code, manual: !q.template_code, solution: q.solution };
  st.blocks = (q.blocks || []).map((b) => ({
    block_code: b.block_code, name: b.title, recurring: !!b.recurring,
    items: (b.items || []).map((it) => ({
      item_code: it.item_code, category: it.category, name: it.name, unit: it.unit,
      ...bandOfNote(it),
      ...(/^MAINT_RATE:[\d.]+$/.test(it.note || '') ? { maint_rate: Number(it.note.split(':')[1]) } : {}), // 견적에서 고친 유지보수 요율
      qty: Number(it.qty), base_price: n0(it.base_price), proposed_price: Number(it.proposed_price) || 0,
      amount: Number(it.amount) || 0,
    })),
    labor: (b.labor || []).map((l) => ({
      role_code: l.role_code, role_name: l.role_name, role_label: l.role_label, grade: l.grade, task: l.task,
      mm: Number(l.mm), base_price: n0(l.base_price), proposed_price: Number(l.proposed_price) || 0,
      amount: Number(l.amount) || 0, month_alloc: l.month_alloc || {},
    })),
  }));
  st.applied = { solution: q.solution, brand: q.brand, ...(tpl || {}) };
  st.hasLaborPlan = !!(tpl && tpl.has_labor_plan);
  st.round_unit = n0(q.round_unit) ?? 100000;
  st.discount = dcOf(q.discount_type, q.discount_value);
  st.monthly_discount = dcOf(q.monthly_discount_type, q.monthly_discount_value);
  st.conds = (q.conditions || []).map((c) => ({ text: typeof c === 'string' ? c : c.text || '' }));
  // 저장된 빈 목록 = 견적조건을 뺀 견적. 저장값이 없으면(null, 옛 견적) 정하지 않는다
  st.conds_on = Array.isArray(q.conditions) ? st.conds.length > 0 : null;
  // 옛 견적(저장값 null)은 견적서가 템플릿 문구를 찍는다 — 화면에도 그 문구를 보여 준다
  if (st.conds_on === null && (tplConds || []).length) {
    st.conds = tplConds.map((t) => ({ text: t }));
    st.conds_on = true;
  }
  st.quoteId = q.id; st.quoteNo = q.quote_no;
  st.revision = q.revision || 1; st.revisionReason = q.revision_reason || ''; // 차수(V11) · 차수 추가 사유(V13) — 읽기만
  st.status = q.status || 'DRAFT';
  st.pay_plan = q.pay_plan && typeof q.pay_plan === 'object' ? q.pay_plan : null;
  st.step = 3;
  return st;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.basic ? d : null;
  } catch { return null; }
}

// 작성 · 수정 중인 내용 — 화면 주소(#/quotes/new · #/quotes/5/edit)마다 메모리에 둔다.
// 하단 탭으로 다른 화면(가격정책 등)에 갔다 와도 이어서 쓴다(2026-10-30 오류 수정 — 예전에는 새로 그리며 비웠다).
// 탭을 닫거나(×) 발행 · 취소하면 지운다. 새로 고침(F5)하면 비어 있는 것은 예전과 같다.
const live = new Map();
window.addEventListener('ss:tabclose', (e) => { if (e.detail === 'new') live.clear(); });
// 견적 목록 [신규] — 작성 중이던 신규 견적을 비우고 빈 화면에서 시작한다(2026-11-07 사용자 요청)
export function clearNewQuote() { live.delete('#/quotes/new'); }

// 구획 제목 아이콘(2026-11-03 디자인 개선) — 제목 글자로 고른다. 스테퍼(단계 번호)와 구획 제목이 다른 모양이 되게.
// 선 아이콘(24 격자, 굵기 2). 맞는 것이 없으면 기본(문서) 아이콘
const HEAD_ICONS = [
  [/기본정보/, '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h4"/>'],
  [/고객|수신/, '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>'],
  [/담당자/, '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'],
  [/조건|일자/, '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  [/첨부/, '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"/>'],
  [/근거|메일/, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'],
  [/솔루션/, '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  [/구축|SaaS|서비스/, '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>'],
  [/템플릿|정책/, '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'],
  [/품목|구성/, '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'],
  [/요약|금액/, '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  [/투입|개월|유사/, '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'],
];
const DOC_ICON = '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>';
function headIcon(text) {
  const path = (HEAD_ICONS.find(([re]) => re.test(text)) || [, DOC_ICON])[1];
  return h('span', { class: 'qz-ico', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>` });
}
function decorateHeads(el) {
  const apply = () => el.querySelectorAll('.card-h h2:not([data-ico])').forEach((t) => {
    t.setAttribute('data-ico', '');
    t.prepend(headIcon(t.textContent));
  });
  apply();
  new MutationObserver(apply).observe(el, { childList: true, subtree: true });
}

export async function renderWizard(root, opts = {}) {
  resetTemplateCache(); // 견적 템플릿 화면에서 바꾼 내용을 다시 받는다
  root.classList.add('qz-wiz'); // 견적 작성 화면 전용 모양 — 구획 · 라벨 · 입력칸 대비(ss-app.css, 2026-11-03). 다른 화면으로 가면 app.js 가 뗀다
  const editMode = !!opts.quote;
  const readOnly = !!opts.readOnly;
  let state;
  const liveKey = location.hash;
  if (!readOnly && live.has(liveKey)) {
    state = live.get(liveKey);
  } else if (editMode) {
    let tpl = null;
    let tplConds = null;
    if (opts.quote.template_code) {
      try { ({ template: tpl, conditions: tplConds } = await http.templateDetail(opts.quote.template_code)); } catch { /* 템플릿이 없어도 수정은 된다 */ }
    }
    state = fromQuote(opts.quote, tpl, tplConds);
    // 상세 ↔ 수정 전환이면 보던 단계에서, 아니면 상세는 2단계(기본정보) · 수정은 3단계(구성)
    const keep = Number(sessionStorage.getItem(OPEN_STEP_KEY));
    sessionStorage.removeItem(OPEN_STEP_KEY);
    state.step = keep >= 1 && keep <= STEPS.length ? keep : readOnly ? 2 : 3;
  } else {
    // 신규는 빈 화면 — 예전에 남은 브라우저 보관분도 지운다
    localStorage.removeItem(DRAFT_KEY);
    state = blankState();
  }
  if (!readOnly) live.set(liveKey, state);

  const api = {
    patch(part) { state = deepMerge(state, part); persist(); paintFooterState(); },
    get() { return state; },
    go(n) {
      if (n < 1 || n > STEPS.length) return;
      // 앞으로 갈 때만 검증한다. 뒤로 가기는 항상 허용. 상세(읽기 전용)는 검증하지 않는다.
      if (n > state.step && !readOnly) {
        const err = validate(state.step, state);
        if (err) { toast(err, 'err'); if (state.step === 3) focusZero(state); return; }
      }
      if (state.step === 3 && !readOnly) sortLaborByRole(state);
      state.step = n; persist(); paint();
    },
    next() { api.go(state.step + 1); },
    prev() { api.go(state.step - 1); },
    reset() { localStorage.removeItem(DRAFT_KEY); state = blankState(); persist(); paint(); },
    // 발행 후 정리 — 이 견적을 담고 있던 브라우저 보관분만 지운다
    finish(id) {
      const d = loadDraft();
      if (!editMode || (d && d.quoteId === id)) localStorage.removeItem(DRAFT_KEY);
      live.delete(liveKey);
    },
    addDays,
    focusCustomer: () => focusCustomer(), // STEP⑤ 가 수신처 없음 오류에서 쓴다
    readOnly,
    editMode, // 저장된 견적을 [수정] 으로 연 경우 — 견적용도 자동 문구를 건드리지 않는다
    // 상태 — 상세에서는 바로 서버에 반영하고, 작성 · 수정 중에는 저장할 때 같이 보낸다
    async setStatus(v) {
      if (!readOnly) { api.patch({ status: v }); return true; }
      try {
        await http.setStatus(state.quoteId, v);
        state.status = v;
        toast('상태가 변경되었습니다.', 'ok');
        return true;
      } catch (err) { toast(err.message, 'err'); return false; }
    },
    statusSelect: () => statusSelect(),
  };

  // 상태 선택 상자 — data-keep 이라 상세(읽기 전용)에서도 잠그지 않는다
  function statusSelect(attrs = {}) {
    const sel = h('select', { class: 'input', 'data-keep': '', ...attrs, onchange: async (e) => {
      const ok = await api.setStatus(e.target.value);
      if (!ok) e.target.value = state.status;
      document.querySelectorAll('select[data-status]').forEach((x) => { x.value = state.status; });
    } }, ...STATUS_OPTS.map(([v, l]) => h('option', { value: v, selected: v === state.status }, l)));
    sel.setAttribute('data-status', '');
    return sel;
  }

  // 브라우저 자동 보관은 하지 않는다(신규는 늘 빈 화면). 저장은 [임시저장] · [발행] 으로 서버에.
  function persist() { if (!readOnly) live.set(liveKey, state); } // 브라우저 보관(localStorage)은 하지 않는다 — 메모리만

  // 서버 임시저장 — 상태는 그대로 '작성중'. 견적 구성(블록)이 생긴 뒤부터 저장할 수 있다.
  let saving = false;
  async function saveDraft() {
    if (saving) return;
    if (!state.blocks.length) return toast('3단계(구성)에서 템플릿이 적용된 뒤부터 임시저장할 수 있습니다.', 'err');
    saving = true;
    try {
      // 템플릿 불러오기로 2단계(기본정보)를 건너뛰면 수신처가 비어 있다 — 화면 위 기본정보 줄의 수신처 칸으로 안내한다
      if (!state.basic.customer_name.trim()) {
        toast('수신처(고객사명)를 입력하세요.', 'err');
        focusCustomer();
        return;
      }
      // 구성 필수값(SaaS 서비스 · 요금 기준 · 서비스 이용료 금액)이 비면 임시저장도 막는다(2026-11-02 사용자 요청)
      const noPrice = priceMissingRows(state);
      const miss = [...configMissing(state), ...zeroBlocks(state), ...(svcFeeMissing(state) ? ['서비스 이용료 금액을 입력하세요'] : []),
        ...(noPrice.length ? [`제안단가를 입력하세요(${noPrice.slice(0, 3).join(', ')}${noPrice.length > 3 ? ` 외 ${noPrice.length - 3}` : ''})`] : [])];
      if (miss.length) {
        toast(`필수 입력이 빠져 임시저장할 수 없습니다 — ${miss.map((t) => t.replace(/^구성 질문:\s*/, '')).join(' / ')}`, 'err');
        if (state.step !== 3) api.go(3);
        focusZero(state); // 수량 · 공수가 전부 0 이면 그 칸으로(2026-11-03 사용자 요청)
        return;
      }
      const sorted = sortLaborByRole(state);
      const payload = quotePayload(state);
      const { quote } = state.quoteId
        ? await http.updateQuote(state.quoteId, payload)
        : await http.createQuote(payload);
      state.quoteId = quote.id; state.quoteNo = quote.quote_no;
      state.savedAt = new Date().toTimeString().slice(0, 5);
      // 저장 전에 담아 둔 첨부 · 고객 전달 파일을 이제 올린다(2026-11-03)
      const nFiles = await uploadPendingFiles(state);
      persist(); paintFooterState(); paintTitle();
      toast(`견적 ${quote.quote_no} 을(를) 작성중으로 임시저장했습니다.${nFiles ? ` 파일 ${nFiles}개도 올렸습니다.` : ''}`, 'ok');
      if ((nFiles && state.step === 2) || (sorted && state.step === 3)) paint(); // 파일 목록 · 역할 순서 정렬을 화면에
    } catch (err) {
      toast(err.message, 'err');
    } finally { saving = false; }
  }

  const savedText = () => (state.savedAt ? `서버 임시저장 ${state.savedAt}` : '');
  function paintFooterState() {
    const el = document.getElementById('wizard-saved');
    if (el) el.textContent = savedText();
  }

  // 기존 견적서 불러오기 — 템플릿 고르기와 따로. 이미 작성한 견적의 유형 · 구성 · 단가 · 특별DC · 결제 방안 · 견적조건을 가져온다.
  // 기본정보(수신처 · 담당자 · 견적용도 등)와 지금 견적의 번호 · 상태는 그대로 둔다 — 복사와 달리 새 견적을 만들지 않는다.
  function pickQuote() {
    openQuotePicker({ currentId: state.quoteId, onPick: async ({ quote }) => {
      if (state.blocks.length) {
        const ok = await confirmModal({ title: '견적서 불러오기',
          message: `지금 작성한 구성 · 인력 · 견적조건 · 특별DC 를 ${quote.quote_no} 견적 내용으로 바꿉니다. 기본정보(수신처 등)는 그대로 둡니다.`,
          okLabel: '바꾸기' });
        if (!ok) return;
      }
      let tpl = null;
      let tplConds = null;
      if (quote.template_code) {
        try { ({ template: tpl, conditions: tplConds } = await http.templateDetail(quote.template_code)); } catch { /* 템플릿이 없어도 가져온다 */ }
      }
      const src = fromQuote(quote, tpl, tplConds);
      for (const k of ['type', 'blocks', 'applied', 'hasLaborPlan', 'round_unit', 'discount', 'monthly_discount', 'conds', 'conds_on', 'pay_plan']) {
        state[k] = src[k];
      }
      state.step = 3;
      persist(); paint();
      toast(`${quote.quote_no} 견적 내용을 불러왔습니다.`, 'ok');
    } });
  }

  // 메일 발송 — 받는 사람 기본값은 견적의 이메일. 실제로 보내면 상태가 발송으로 바뀐다
  const mailTarget = () => ({ id: state.quoteId, quote_no: state.quoteNo, customer_name: state.basic.customer_name,
    email: state.basic.email, purpose: state.basic.purpose });
  function onMailSent(r) {
    if (!r.status) return;
    state.status = r.status;
    document.querySelectorAll('select[data-status]').forEach((x) => { x.value = r.status; });
  }
  api.mail = () => mailQuote(mailTarget(), onMailSent);
  // 견적서 불러오기 버튼은 1단계 직접 작성 줄에 있다(2026-10-30 사용자 요청 — 위 액션에서 옮김).
  // 템플릿은 1단계 화면 목록에서 고른다 — 따로 여는 [템플릿 불러오기] 창은 없앴다.
  api.pickQuote = pickQuote;

  // 상세 ↔ 수정 — 보던 단계를 넘겨 준다
  const switchTo = (hash) => { sessionStorage.setItem(OPEN_STEP_KEY, String(state.step)); location.hash = hash; };

  // 맨 위 액션 줄에 얹는 버튼 묶음 — 3단계부터 결재요청 · PDF · Excel(2026-10-31, 2026-11-03 5단계 탭을 없애며 옮김 · 메일 발송은 뺌)
  let topExtra = null;
  api.setTopActions = (node) => { topExtra = node; paintTitle(); };

  function paintTitle() {
    const head = readOnly ? '견적 상세' : editMode ? '견적 수정' : '견적 작성';
    const path = `견적관리 / ${head}${state.quoteNo ? ' ' + state.quoteNo : ''} / ${state.step}. ${STEPS[state.step - 1].label}`;
    if (readOnly) {
      const q = { id: state.quoteId, quote_no: state.quoteNo };
      // 상세와 수정은 같은 자리 순서(2026-11-03 사용자 요청) — 업무 | 문서 보기(연한 파랑) | 나가기(목록 ↔ 취소)
      //   상세: 수정 · 차수 추가 · 복사 · 삭제 | 견적서 보기 · PDF · Excel | 목록
      // 메일 발송 · 인장시스템 연계는 상세에서 뺐다 — 인장시스템 연계는 작성 화면의 [결재요청]이 연다
      setPage({ title: head, path, actions: [
        { label: '수정', onClick: () => switchTo(`#/quotes/${state.quoteId}/edit`) },
        { label: '차수 추가', onClick: () => reviseQuote(q) },
        { label: '복사', onClick: () => copyQuote(q) },
        { label: '삭제', kind: 'delete', onClick: () => deleteQuote(q) },
        { label: '견적서 보기', kind: 'secondary', gap: true, onClick: () => viewQuote(q) },
        { label: 'PDF', kind: 'secondary', onClick: () => downloadQuote(q, 'pdf') },
        { label: 'Excel', kind: 'secondary', onClick: () => downloadQuote(q, 'excel') },
        { label: '목록', gap: true, onClick: () => { location.hash = '#/quotes'; } },
        // 이전 · 다음은 두지 않는다 — 단계 이동은 단계 탭을 누른다(2026-10-31 사용자 요청)
      ] });
      return;
    }
    setPage({
      title: head,
      path,
      actions: [
        // 상세와 같은 자리 순서(2026-11-03 사용자 요청) — 업무: 임시저장 · 결재요청 · 삭제(한 세트) | 문서 보기: 미리보기 · PDF · Excel(연한 파랑)
        //   | 나가기: 취소(상세의 목록 자리) | 이전 · 다음(회색 채움). 결재요청 · PDF · Excel 은 topExtra(모든 단계)
        { label: '임시저장', onClick: saveDraft },
        ...(topExtra ? [{ node: topExtra.approve }] : []),
        // 삭제 — 수정 중인 견적을 지운다(2026-11-03 사용자 요청). 되돌릴 수 없어 먼저 묻고, 지우면 고치던 내용도 버리고 목록으로
        ...(editMode ? [{ label: '삭제', kind: 'delete', onClick: async () => {
          const ok = await confirmModal({ title: '견적 삭제', danger: true, okLabel: '삭제',
            message: `${state.quoteNo || '이'} 견적을 삭제하시겠습니까? 되돌릴 수 없습니다.` });
          if (!ok) return;
          try { await http.deleteQuote(state.quoteId); live.delete(liveKey); toast('삭제되었습니다.', 'ok'); location.hash = '#/quotes'; }
          catch (err) { toast(err.message, 'err'); }
        } }] : []),
        { label: '미리보기', kind: 'secondary', gap: true, onClick: () => openPreview(api) },
        ...(topExtra ? [{ node: topExtra.docs }] : []),
        ...(editMode ? [{ label: '취소', gap: true, onClick: () => { live.delete(liveKey); switchTo(`#/quotes/${state.quoteId}`); } }] : []),
        // 첫 단계에는 이전이, 마지막 단계(인력투입계획)에는 다음이 없다 — 눌러도 반응이 없던 것을 끈다(2026-11-02 사용자 요청)
        { label: '이전', kind: 'nav', gap: true, disabled: state.step <= 1, onClick: () => api.prev() },
        { label: '다음', kind: 'nav', disabled: state.step >= STEPS.length, onClick: () => api.next() },
      ],
    });
  }

  // 단계 — 누르면 그 단계로 간다. 단계 사이 › · 이름 아래 짧은 상태(완료 · 작성 중) · 마우스를 올리면 바탕이 깔린다(2026-11-03).
  // 키보드(Tab → Enter)로도 옮길 수 있다
  function stepsBar() {
    const items = [];
    STEPS.forEach((s, i) => {
      const done = s.n < state.step, on = s.n === state.step;
      const cls = done ? 'done' : on ? 'on' : '';
      const cap = on ? (readOnly ? '보는 중' : '작성 중') : done ? '완료' : '';
      const go = () => { if (!on) api.go(s.n); };
      if (i) items.push(h('span', { class: 'steps__arrow', 'aria-hidden': 'true' }, '›'));
      items.push(h('div', { class: cls, role: 'button', tabindex: on ? '-1' : '0', title: on ? `${s.n}단계 — ${s.label}` : `${s.n}단계 ${s.label}(으)로 이동`,
        'aria-current': on ? 'step' : null, onclick: go, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } },
      h('span', { class: 'n' }, done ? '✓' : String(s.n)), // 끝난 단계는 체크(개선안 v2)
      h('span', { class: 'steps__txt' }, h('b', {}, s.label), cap ? h('small', {}, cap) : null)));
    });
    return h('div', { class: 'steps' }, ...items);
  }

  // 기본정보 줄 — 3단계부터 화면 위에 수신처 · 담당자 · 견적용도를 늘 보여 준다.
  // 템플릿 불러오기로 2단계(기본정보)를 건너뛰어도 여기서 바로 입력한다. 나머지 기본정보(연락처 · 일자 등)는 2단계에서.
  let customers = null;
  function basicBar() {
    const b = state.basic;
    const list = h('datalist', { id: 'wiz-customer-list' });
    const loadCustomers = () => {
      if (customers) return fill();
      customers = [];
      http.masterList('customers').then((r) => { customers = (r.rows || []).filter((c) => c.active !== 0); fill(); }).catch(() => {});
    };
    const fill = () => list.replaceChildren(...customers.map((c) => h('option', { value: c.name })));
    const inp = (key, ph, width, extra = {}) => h('input', {
      class: 'input', id: `wiz-basic-${key}`, value: b[key] || '', placeholder: ph, style: `width:${width}`, ...extra,
      oninput: (e) => {
        const patch = { basic: { [key]: e.target.value } };
        // 고객사 마스터의 이름을 고르면 담당자를 채운다(비어 있을 때만)
        const c = key === 'customer_name' && (customers || []).find((x) => x.name === e.target.value.trim());
        if (c && c.contact_name && !state.basic.customer_contact) {
          patch.basic.customer_contact = c.contact_name;
          const ct = document.getElementById('wiz-basic-customer_contact');
          if (ct) ct.value = c.contact_name;
        }
        e.target.style.borderColor = '';
        api.patch(patch);
      },
    });
    const cell = (label, el, req) => h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px;color:#64748B;white-space:nowrap' },
      label, req ? h('span', { style: 'color:var(--danger)' }, '*') : null, el);
    loadCustomers();
    // 상자 없이 한 줄(개선안 v2) — 저장된 견적이면 오른쪽에 번호 · 차수
    return h('div', { class: 'qz-info' },
      h('div', { class: 'qz-info__row' },
        cell('수신처', inp('customer_name', '고객사명 (예: 솔브레인)', '220px', { list: 'wiz-customer-list' }), true),
        cell('고객 담당자', inp('customer_contact', '예) 김OO 책임', '150px')),
        cell('견적용도', inp('purpose', '예) 전자구매시스템 구축 견적 (SaaS)', '320px')),
        h('span', { 'data-keep': '' }, cell('상태', statusSelect({ style: 'width:96px' }))),
        state.quoteNo ? h('span', { class: 'qz-info__no' }, `${state.quoteNo}${state.revision > 1 ? ` · ${state.revision}차` : ''}`) : null,
        list));
  }

  // 수신처 칸으로 커서 — 3단계부터는 위 기본정보 줄, 2단계는 고객 정보 칸. 1단계면 2단계로 옮긴 뒤(2026-11-03 결재요청 · 임시저장)
  function focusCustomer() {
    const find = () => document.getElementById('wiz-basic-customer_name') || document.getElementById('wiz-step2-customer_name');
    const moved = !find() && state.step === 1;
    if (moved) api.go(2);
    const mark = () => {
      const el = find();
      if (!el) return;
      el.style.borderColor = 'var(--danger)';
      el.scrollIntoView({ block: 'center' });
      el.focus();
    };
    mark();
    // 2단계 화면은 그린 직후 한 번 더 그려질 수 있다(견적용도 자동 문구) — 그 뒤에 다시 잡는다
    if (moved) setTimeout(mark, 200);
  }

  function paint() {
    clear(root);
    root.appendChild(stepsBar());
    if (state.step >= 3) root.appendChild(basicBar());
    const body = h('div', {});
    root.appendChild(body);
    root.appendChild(h('div', { class: 'page-sub', id: 'wizard-saved', style: 'margin-top:10px;text-align:right' },
      savedText()));
    topExtra = null; // 단계를 옮기면 그 단계 화면이 다시 얹는다
    paintTitle(); // GNB 액션 — 작업 7 의 setPage 인터페이스

    STEPS[state.step - 1].render(body, state, api);
    decorateHeads(body); // 구획 제목 앞 아이콘 — 단계 화면이 나중에 다시 그려도 붙는다
    // 결재요청 · 내려받기 버튼을 모든 단계에서 같은 자리에 얹는다(예전 5단계 화면이 하던 일).
    // 단계마다 버튼이 달라지지 않게(2026-11-03 사용자 요청). 아직 못 하는 상태면 누를 때 알린다(결재요청 검사 · 저장 전 내려받기 꺼짐)
    if (!readOnly) api.setTopActions(reviewActions(state, api));
    if (readOnly) {
      lock(body);
      const bar = root.querySelector('.card');
      if (bar && state.step >= 3) lock(bar);
    }
  }

  // 읽기 전용 — 입력 · 버튼을 모두 잠근다(상태 상자 data-keep 은 뺀다). 단계가 늦게 그리는 부분도 따라 잠근다.
  // 1단계의 유형 · 템플릿 카드는 버튼이 아니라서 누르지 못하게 막는다.
  function lock(el) {
    const apply = () => {
      el.querySelectorAll('input, select, textarea, button').forEach((c) => { if (!c.closest('[data-keep]') && !c.disabled) c.disabled = true; });
      el.querySelectorAll('.factor').forEach((c) => { c.style.pointerEvents = 'none'; });
    };
    apply();
    new MutationObserver(apply).observe(el, { childList: true, subtree: true });
  }

  paint();
}

// 단계별 전진 조건. 통과 못 하면 메시지를 돌려준다.
function validate(step, state) {
  if (step === 1) return validateStep2(state); // 유형 선택
  if (step === 2) { // 기본정보
    if (!state.basic.customer_name.trim()) return '수신처(고객사명)를 입력하세요.';
    if (!state.basic.quote_date) return '견적일자를 입력하세요.';
    if (state.type.quote_type === 'MAINT') { // 유지보수 — 금액 기준 값이 있어야 솔루션유지보수를 계산한다
      const b = state.basic;
      if (b.maint_basis === 'PREV' ? !Number(b.maint_prev) : !Number(b.maint_supply)) {
        return b.maint_basis === 'PREV' ? '전년도 유지보수 금액을 입력하세요.' : b.maint_basis === 'QUOTE' ? '구축 견적을 불러오세요.' : '솔루션 공급가를 입력하세요.';
      }
    }
    return null;
  }
  if (step === 3) { // 구성 — 솔루션 수량 · 개발인건비 공수가 전부 0 이면 다음으로 못 간다
    const z = zeroBlocks(state);
    return z.length ? z.join(' / ') : null;
  }
  return null;
}

// 얕은 병합으로는 basic/type 을 통째로 갈아치우게 되므로 1단계 깊이까지 병합한다
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object')
      ? { ...base[k], ...v } : v;
  }
  return out;
}
