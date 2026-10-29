// 견적 작성 위저드 — 5단계. 상태는 여기서만 보관하고 각 step 은 순수 렌더러다.
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
import { copyQuote, viewQuote, deleteQuote, downloadQuote, mailQuote } from '../quote-actions.js';
import { h, toast, clear, confirmModal } from '../../../ui.js';
import { setPage } from '../../../layout/gnb.js';
import { renderStep1 } from './step1-basic.js';
import { renderStep2, validateStep2, resetTemplateCache } from './step2-type.js';
import { renderStep3, appliedPatch, openPreview } from './step3-config.js';
import { openTemplatePicker } from './template-picker.js';
import { renderStep4 } from './step4-labor.js';
import { renderStep5, quotePayload } from './step5-review.js';

const DRAFT_KEY = 'sq.wizard.draft.v1';
const OPEN_STEP_KEY = 'sq.wizard.openStep'; // 상세 ↔ 수정 전환 때 이어서 열 단계
export const STATUS_OPTS = [['DRAFT', '작성중'], ['SENT', '발송'], ['WON', '수주'], ['LOST', '실주']];

const STEPS = [
  { n: 1, label: '기본정보', render: renderStep1 },
  { n: 2, label: '유형 선택', render: renderStep2 },
  { n: 3, label: '구성', render: renderStep3 },
  { n: 4, label: '인건비', render: renderStep4 },
  { n: 5, label: '검토·발행', render: renderStep5 },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(d, n) {
  const x = new Date((d || todayStr()) + 'T00:00:00');
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

function blankState() {
  return {
    step: 1,
    basic: {
      customer_name: '', customer_contact: '', purpose: '', phone: '', email: '',
      quote_date: todayStr(), valid_until: addDays(todayStr(), 30),
      pay_terms: '고객사 결제조건', install_note: '협의된 프로젝트 기간',
      // 마스터 연동 예정 (작업 13) — 화면에는 비활성으로 노출한다
      company_class: null, channel: null,
    },
    type: { quote_type: 'BUILD', deployment: null, template_code: null },
    blocks: [], applied: null, laborYear: null, hasLaborPlan: false,
    round_unit: 100000,
    discount: { mode: 'TARGET', value: null },          // null = DC 미적용
    monthly_discount: { mode: 'TARGET', value: null },  // 월 사용료 특별DC (하겐다즈 SaaS 300,000→100,000)
    conds: [], riskFactors: [],
    savedAt: null,
    quoteId: null, quoteNo: null, // 서버에 저장된 견적이면 채워진다 (임시저장 또는 수정)
    status: 'DRAFT',
  };
}

// 저장된 견적 → 위저드 상태. 메모에 접어 둔 견적용도·결제조건·연락처·이메일을 다시 풀어낸다(previewHeader 의 역).
const MEMO_KEYS = { 견적용도: 'purpose', 결제조건: 'pay_terms', 연락처: 'phone', 이메일: 'email' };
const n0 = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const day = (v) => (v ? String(v).slice(0, 10) : '');
function dcOf(type, value) {
  // 저장 시 할인 없음은 type null 로 남는다. TARGET 0 은 무상제공이라 값 0 을 살린다.
  return type ? { mode: type, value: n0(value) ?? 0 } : { mode: 'TARGET', value: null };
}
function fromQuote(q, tpl) {
  const st = blankState();
  const memo = {};
  for (const line of String(q.memo || '').split('\n')) {
    const m = line.match(/^\[(.+?)\]\s?(.*)$/);
    if (m && MEMO_KEYS[m[1]]) memo[MEMO_KEYS[m[1]]] = m[2];
  }
  Object.assign(st.basic, {
    customer_name: q.customer_name || '', customer_contact: q.customer_contact || '',
    quote_date: day(q.quote_date) || st.basic.quote_date, valid_until: day(q.valid_until),
    purpose: memo.purpose || '', phone: memo.phone || '', email: memo.email || '',
    pay_terms: memo.pay_terms && memo.pay_terms !== '-' ? memo.pay_terms : '',
  });
  st.type = { quote_type: q.quote_type || 'BUILD', deployment: q.deployment, template_code: q.template_code };
  st.blocks = (q.blocks || []).map((b) => ({
    block_code: b.block_code, name: b.title, recurring: !!b.recurring,
    items: (b.items || []).map((it) => ({
      item_code: it.item_code, category: it.category, name: it.name, spec: it.spec, unit: it.unit,
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
  st.quoteId = q.id; st.quoteNo = q.quote_no;
  st.status = q.status || 'DRAFT';
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

export async function renderWizard(root, opts = {}) {
  resetTemplateCache(); // 견적 템플릿 화면에서 바꾼 내용을 다시 받는다
  const editMode = !!opts.quote;
  const readOnly = !!opts.readOnly;
  let state;
  if (editMode) {
    let tpl = null;
    if (opts.quote.template_code) {
      try { ({ template: tpl } = await http.templateDetail(opts.quote.template_code)); } catch { /* 템플릿이 없어도 수정은 된다 */ }
    }
    state = fromQuote(opts.quote, tpl);
    // 상세 ↔ 수정 전환이면 보던 단계에서, 아니면 상세는 1단계 · 수정은 3단계(구성)
    const keep = Number(sessionStorage.getItem(OPEN_STEP_KEY));
    sessionStorage.removeItem(OPEN_STEP_KEY);
    state.step = keep >= 1 && keep <= STEPS.length ? keep : readOnly ? 1 : 3;
  } else {
    // 신규는 빈 화면 — 예전에 남은 브라우저 보관분도 지운다
    localStorage.removeItem(DRAFT_KEY);
    state = blankState();
  }

  const api = {
    patch(part) { state = deepMerge(state, part); persist(); paintFooterState(); },
    get() { return state; },
    go(n) {
      if (n < 1 || n > STEPS.length) return;
      // 앞으로 갈 때만 검증한다. 뒤로 가기는 항상 허용. 상세(읽기 전용)는 검증하지 않는다.
      if (n > state.step && !readOnly) {
        const err = validate(state.step, state);
        if (err) return toast(err, 'err');
      }
      state.step = n; persist(); paint();
    },
    next() { api.go(state.step + 1); },
    prev() { api.go(state.step - 1); },
    reset() { localStorage.removeItem(DRAFT_KEY); state = blankState(); paint(); },
    // 발행 후 정리 — 이 견적을 담고 있던 브라우저 보관분만 지운다
    finish(id) {
      const d = loadDraft();
      if (!editMode || (d && d.quoteId === id)) localStorage.removeItem(DRAFT_KEY);
    },
    addDays,
    focusCustomer: () => focusCustomer(), // STEP⑤ 가 수신처 없음 오류에서 쓴다
    readOnly,
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
  function persist() { /* 의도적으로 비움 */ }

  // 서버 임시저장 — 상태는 그대로 '작성중'. 견적 구성(블록)이 생긴 뒤부터 저장할 수 있다.
  let saving = false;
  async function saveDraft() {
    if (saving) return;
    if (!state.blocks.length) return toast('3단계(구성)에서 템플릿이 적용된 뒤부터 임시저장할 수 있습니다.', 'err');
    saving = true;
    try {
      // 템플릿 불러오기로 1단계를 건너뛰면 수신처가 비어 있다 — 화면 위 기본정보 줄의 수신처 칸으로 안내한다
      if (!state.basic.customer_name.trim()) {
        toast('수신처(고객사명)를 입력하세요.', 'err');
        focusCustomer();
        return;
      }
      const payload = quotePayload(state);
      const { quote } = state.quoteId
        ? await http.updateQuote(state.quoteId, payload)
        : await http.createQuote(payload);
      state.quoteId = quote.id; state.quoteNo = quote.quote_no;
      state.savedAt = new Date().toTimeString().slice(0, 5);
      persist(); paintFooterState(); paintTitle();
      toast(`견적 ${quote.quote_no} 을(를) 작성중으로 임시저장했습니다.`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally { saving = false; }
  }

  const savedText = () => (state.savedAt ? `서버 임시저장 ${state.savedAt}` : '');
  function paintFooterState() {
    const el = document.getElementById('wizard-saved');
    if (el) el.textContent = savedText();
  }

  // 템플릿 불러오기 — 기본정보는 두고 유형 · 구성 · 인력 · 견적조건을 템플릿 내용으로 바꾼 뒤 3단계(구성)로 간다.
  // 특별DC 는 금액이 달라지므로 비운다. 이미 구성이 있으면 바꾸기 전에 묻는다.
  function pickTemplate() {
    openTemplatePicker({ state, onPick: async ({ tpl, d }) => {
      if (state.blocks.length) {
        const ok = await confirmModal({ title: '템플릿 불러오기',
          message: `지금 작성한 구성 · 인력 · 견적조건 · 특별DC 를 '${tpl.name}' 내용으로 바꿉니다. 기본정보(수신처 등)는 그대로 둡니다.`,
          okLabel: '바꾸기' });
        if (!ok) return;
      }
      state = deepMerge(state, {
        type: { quote_type: tpl.quote_type, deployment: tpl.deployment, template_code: tpl.code },
        ...appliedPatch(d),
        discount: { mode: 'TARGET', value: null }, monthly_discount: { mode: 'TARGET', value: null },
      });
      state.step = 3;
      persist(); paint();
      toast(`'${tpl.name}' 템플릿을 불러왔습니다.`, 'ok');
      if (d.unregistered && d.unregistered.length) {
        toast(`가격정책 미등록 모듈 ${d.unregistered.length}건 — 기준단가가 비어 있습니다: ${d.unregistered.join(', ')}`, 'err');
      }
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

  // 상세 ↔ 수정 — 보던 단계를 넘겨 준다
  const switchTo = (hash) => { sessionStorage.setItem(OPEN_STEP_KEY, String(state.step)); location.hash = hash; };

  function paintTitle() {
    const head = readOnly ? '견적 상세' : editMode ? '견적 수정' : '견적 작성';
    const path = `견적관리 / ${head}${state.quoteNo ? ' ' + state.quoteNo : ''} / ${state.step}. ${STEPS[state.step - 1].label}`;
    if (readOnly) {
      const q = { id: state.quoteId, quote_no: state.quoteNo };
      setPage({ title: head, path, actions: [
        { label: '목록', onClick: () => { location.hash = '#/quotes'; } },
        { label: '수정', onClick: () => switchTo(`#/quotes/${state.quoteId}/edit`) },
        { label: '복사', onClick: () => copyQuote(q) },
        { label: '견적서 보기', onClick: () => viewQuote(q) },
        { label: 'PDF', onClick: () => downloadQuote(q, 'pdf') },
        { label: 'Excel', onClick: () => downloadQuote(q, 'excel') },
        { label: '메일 발송', onClick: () => mailQuote(mailTarget(), onMailSent) },
        { label: '삭제', onClick: () => deleteQuote(q) },
        { label: '이전', onClick: () => api.prev() },
        { label: '다음', primary: true, onClick: () => api.next() },
      ] });
      return;
    }
    setPage({
      title: head,
      path,
      actions: [
        ...(editMode ? [{ label: '취소', onClick: () => switchTo(`#/quotes/${state.quoteId}`) }] : []),
        { label: '템플릿 불러오기', onClick: pickTemplate },
        { label: '미리보기', onClick: () => openPreview(api) },
        { label: '임시저장', onClick: saveDraft },
        { label: '이전', onClick: () => api.prev() },
        { label: '다음', primary: true, onClick: () => api.next() },
      ],
    });
  }

  function stepsBar() {
    return h('div', { class: 'steps' }, ...STEPS.map((s) => {
      const cls = s.n < state.step ? 'done' : s.n === state.step ? 'on' : '';
      return h('div', { class: cls, onclick: () => api.go(s.n), style: 'cursor:pointer' },
        h('span', { class: 'n' }, String(s.n)), s.label);
    }));
  }

  // 기본정보 줄 — 2단계부터 화면 위에 수신처 · 담당자 · 견적용도를 늘 보여 준다.
  // 템플릿 불러오기로 1단계를 건너뛰어도 여기서 바로 입력한다. 나머지 기본정보(연락처 · 일자 등)는 1단계에서.
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
    const cell = (label, el, req) => h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);white-space:nowrap' },
      label, req ? h('span', { style: 'color:var(--danger)' }, '*') : null, el);
    loadCustomers();
    return h('div', { class: 'card', style: 'margin-bottom:12px' },
      h('div', { class: 'card-b', style: 'display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;padding:10px 14px' },
        // 5단계는 수신처 유무로 발행 가능 여부가 바뀐다 — 입력을 마치면(포커스가 나가면) 다시 그린다
        cell('수신처', inp('customer_name', '고객사명 (예: 솔브레인)', '220px', { list: 'wiz-customer-list',
          onchange: () => { if (state.step === 5) paint(); } }), true),
        cell('담당자', inp('customer_contact', '예) 김OO 책임', '150px')),
        cell('견적용도', inp('purpose', '예) 전자구매시스템 구축 견적 (SaaS)', '320px')),
        h('span', { 'data-keep': '' }, cell('상태', statusSelect({ style: 'width:96px' }))),
        list));
  }

  function focusCustomer() {
    const el = document.getElementById('wiz-basic-customer_name');
    if (!el) return;
    el.style.borderColor = 'var(--danger)';
    el.scrollIntoView({ block: 'center' });
    el.focus();
  }

  function paint() {
    clear(root);
    root.appendChild(stepsBar());
    if (state.step >= 2) root.appendChild(basicBar());
    const body = h('div', {});
    root.appendChild(body);
    root.appendChild(h('div', { class: 'page-sub', id: 'wizard-saved', style: 'margin-top:10px;text-align:right' },
      savedText()));
    paintTitle(); // GNB 액션 — 작업 7 의 setPage 인터페이스

    STEPS[state.step - 1].render(body, state, api);
    if (readOnly) {
      lock(body);
      const bar = root.querySelector('.card');
      if (bar && state.step >= 2) lock(bar);
    }
  }

  // 읽기 전용 — 입력 · 버튼을 모두 잠근다(상태 상자 data-keep 은 뺀다). 단계가 늦게 그리는 부분도 따라 잠근다.
  // 2단계의 유형 · 템플릿 카드는 버튼이 아니라서 누르지 못하게 막는다.
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
  if (step === 1) {
    if (!state.basic.customer_name.trim()) return '수신처(고객사명)를 입력하세요.';
    if (!state.basic.quote_date) return '견적일자를 입력하세요.';
    return null;
  }
  if (step === 2) return validateStep2(state);
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
