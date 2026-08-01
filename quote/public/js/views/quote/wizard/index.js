// 견적 작성 위저드 — 5단계. 상태는 여기서만 보관하고 각 step 은 순수 렌더러다.
//
// step 계약:  render(root, state, api) → void
//   state 를 읽어 화면을 그리고, 값이 바뀌면 api.patch({...}) 로 변경분만 돌려준다.
//   단계 이동은 api.go(n) / api.next() / api.prev().
//
// 임시저장: 단계 이동·값 변경 시 localStorage 에 저장한다. 새로고침해도 복원된다.
import { h, toast, clear } from '../../../ui.js';
import { setPage } from '../../../layout/gnb.js';
import { renderStep1 } from './step1-basic.js';
import { renderStep2, validateStep2 } from './step2-type.js';
import { renderStep3 } from './step3-config.js';
import { renderStep4 } from './step4-labor.js';
import { renderStep5 } from './step5-review.js';

const DRAFT_KEY = 'sq.wizard.draft.v1';

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
  };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.basic ? d : null;
  } catch { return null; }
}

export async function renderWizard(root) {
  const draft = loadDraft();
  let state = draft || blankState();
  if (draft) toast(`작성 중이던 견적을 복원했습니다. (${draft.savedAt || '임시저장'})`, 'ok');

  const api = {
    patch(part) { state = deepMerge(state, part); persist(); paintFooterState(); },
    get() { return state; },
    go(n) {
      if (n < 1 || n > STEPS.length) return;
      // 앞으로 갈 때만 검증한다. 뒤로 가기는 항상 허용.
      if (n > state.step) {
        const err = validate(state.step, state);
        if (err) return toast(err, 'err');
      }
      state.step = n; persist(); paint();
    },
    next() { api.go(state.step + 1); },
    prev() { api.go(state.step - 1); },
    reset() { localStorage.removeItem(DRAFT_KEY); state = blankState(); paint(); },
    addDays,
  };

  function persist() {
    state.savedAt = new Date().toTimeString().slice(0, 5);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* 용량 초과 무시 */ }
  }

  function paintFooterState() {
    const el = document.getElementById('wizard-saved');
    if (el) el.textContent = state.savedAt ? `임시저장 ${state.savedAt}` : '';
  }

  function stepsBar() {
    return h('div', { class: 'steps' }, ...STEPS.map((s) => {
      const cls = s.n < state.step ? 'done' : s.n === state.step ? 'on' : '';
      return h('div', { class: cls, onclick: () => api.go(s.n), style: 'cursor:pointer' },
        h('span', { class: 'n' }, String(s.n)), s.label);
    }));
  }

  function paint() {
    clear(root);
    root.appendChild(stepsBar());
    const body = h('div', {});
    root.appendChild(body);
    root.appendChild(h('div', { class: 'page-sub', id: 'wizard-saved', style: 'margin-top:10px;text-align:right' },
      state.savedAt ? `임시저장 ${state.savedAt}` : ''));

    // GNB 액션 — 작업 7 의 setPage 인터페이스
    setPage({
      title: '견적 작성',
      path: `견적관리 / 견적 작성 / ${state.step}. ${STEPS[state.step - 1].label}`,
      actions: [
        { label: '임시저장', onClick: () => { persist(); paintFooterState(); toast('임시저장했습니다.', 'ok'); } },
        { label: '이전', onClick: () => api.prev() },
        { label: '다음', primary: true, onClick: () => api.next() },
      ],
    });

    STEPS[state.step - 1].render(body, state, api);
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
