// STEP④ 인력투입계획(2026-11-03 이름 변경, 예전 '인건비') — 2분할. 좌 공수·월별배분 / 우 유사견적(자리만). 리스크 계수 칸은 뺐다(2026-11-03).
// validateMonthAlloc 의 Σ 검증(배분 합계 = 공수)을 STEP③ 과 같은 규칙으로 이관했다.
//
// 금액을 산출하는 인건비는 **LABOR 블록뿐**이다. 비-LABOR 블록(SETUP 등)에 붙은 인건비 행은
// 인력투입계획 부록용 공수 배분이며, 금액은 이미 같은 블록의 셋업 품목에 들어 있다.
// (실측 SK이터닉스: 셋업 3.7MM × 12,000,000 = 44,400,000 한 줄뿐, 인건비 행 없음)
// 그래서 비-LABOR 블록에는 단가·금액 칸을 아예 만들지 않는다.
import { h, won, numInput, toast, confirmModal } from '../../../ui.js';
import { recalcBlocks } from './step3-config.js';

const num = (v) => Number(v) || 0;
// 월 칸 — 투입 개월수(basic.plan_months)만큼 M1 ~ Mn(2026-11-03 사용자 요청). 개월수가 없으면 저장된 배분의 마지막 달, 그것도 없으면 6.
// 옛 견적의 'M' 칸(예전 고정 M · M1 ~ M5)은 값이 있을 때만 앞에 둔다
const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 60;
function monthKeys(state) {
  const allocs = (state.blocks || []).flatMap((b) => b.labor || []).map((l) => l.month_alloc || {});
  const last = Math.max(0, ...allocs.flatMap((a) => Object.keys(a)).map((k) => Number(k.slice(1)) || 0));
  const n = num(state.basic.plan_months) || last || DEFAULT_MONTHS;
  const hasM = allocs.some((a) => a.M != null && a.M !== '');
  return [...(hasM ? ['M'] : []), ...Array.from({ length: n }, (_, i) => 'M' + (i + 1))];
}

// 실제 투입월 — 시작월('YYYY-MM')이 있으면 Mk 아래에 'YY.MM'. 옛 'M' 칸에는 붙이지 않는다
function monthLabel(start, m) {
  const k = Number(m.slice(1));
  const [y, mo] = String(start || '').split('-').map(Number);
  if (!k || !y || !mo) return '';
  const t = (y * 12 + (mo - 1)) + (k - 1);
  return String(Math.floor(t / 12) % 100).padStart(2, '0') + '.' + String((t % 12) + 1).padStart(2, '0');
}

// 자동 배분(2026-11-03 사용자 요청) — AI 가 아니라 정해진 규칙. 역할마다 일하는 구간을 정하고(전체 기간의 비율),
// 그 구간에 공수를 0.1 단위로 고르게 나눈다. 누적 반올림이라 남는 0.1 이 구간 전체에 흩어지고 합계는 공수와 꼭 맞는다
const ROLE_SPAN = {
  PM: (p) => true, //                         전 기간
  DEV: (p) => p >= 0.4, //                    구현 ~ 안정화(뒤쪽 약 60%)
  UIUX: (p) => p >= 0.3 && p < 0.8, //        가운데 구간
  ARCHITECT: (p) => p < 0.25 || (p >= 0.65 && p < 0.85), // 처음 설계 · 통합테스트
};
function splitMM(mm, n, role) {
  const inSpan = ROLE_SPAN[String(role || '').toUpperCase()] || (() => true);
  let on = Array.from({ length: n }, (_, i) => inSpan((i + 0.5) / n));
  if (!on.some(Boolean)) on = on.map(() => true); // 개월수가 너무 짧아 구간이 비면 전 기간
  const cnt = on.filter(Boolean).length;
  const units = Math.round(mm * 10);
  let j = 0;
  const out = on.map((x) => { if (!x) return 0; const u = Math.round(((j + 1) * units) / cnt) - Math.round((j * units) / cnt); j++; return u; });
  // 공수가 0.1 단위가 아니면(예: 8.55) 남는 끝자리를 가장 큰 달에 붙인다
  const diff = Math.round((mm - units / 10) * 100) / 100;
  const vals = out.map((u) => u / 10);
  if (diff) { const i = vals.indexOf(Math.max(...vals)); vals[i] = Math.round((vals[i] + diff) * 100) / 100; }
  return vals;
}

// 행별 자동 배분(2026-11-03 사용자 요청) — 그 행에 마지막으로 넣은 달의 값으로 다음 달부터 채운다.
// 남은 공수(공수 - 이미 넣은 합)가 다 쓰일 때까지 같은 값, 마지막 달은 남은 만큼. 넣은 칸이 없으면 역할 규칙(splitMM)으로 나눈다.
// 돌려주는 값은 개월수가 모자라 못 채운 공수(0 이면 다 채움)
const r2 = (v) => Math.round(v * 100) / 100;
function fillRow(l, n) {
  const a = l.month_alloc = l.month_alloc || {};
  const keys = Array.from({ length: n }, (_, i) => 'M' + (i + 1));
  const lastIdx = keys.map((k) => num(a[k]) > 0).lastIndexOf(true);
  if (lastIdx < 0 && !num(a.M)) {
    splitMM(num(l.mm), n, l.role_code).forEach((v, i) => { if (v) a[keys[i]] = v; });
    return 0;
  }
  const step = lastIdx >= 0 ? num(a[keys[lastIdx]]) : 0;
  let left = r2(num(l.mm) - Object.values(a).reduce((s, v) => s + num(v), 0));
  for (let i = lastIdx + 1; i < n && left > 0 && step > 0; i++) {
    const v = r2(Math.min(step, left));
    a[keys[i]] = v; left = r2(left - v);
  }
  return Math.max(0, left);
}

export function renderStep4(root, state, wiz) {
  root.replaceChildren();

  const laborBlocks = (state.blocks || []).filter((b) => (b.labor || []).length);
  const MONTHS = monthKeys(state);
  if (!laborBlocks.length) {
    root.appendChild(h('div', { class: 'banner inf' },
      h('div', {}, h('b', {}, '이 견적에는 인력투입계획을 넣을 인력 행이 없습니다.'),
        'SaaS·PCloud 는 셋업비가 MM 기반이라 3단계(구성)에서 함께 입력합니다. 다 됐으면 위쪽 [결재요청]을 누르세요.')));
    return;
  }

  const layout = h('div', { style: 'display:grid;grid-template-columns:1fr 240px;gap:14px;align-items:start' });
  const colM = h('div', { style: 'min-width:0' }); const colR = h('div', {});
  layout.appendChild(colM); layout.appendChild(colR);
  root.appendChild(layout);

  // 리스크 계수 칸은 화면에서 뺐다(2026-11-03 사용자 요청 — 나중에 다시 요청 예정). 저장된 riskFactors 는 건드리지 않는다

  // ── 중: 역할별 공수 + 월별 배분 ──
  const warn = h('div', { style: 'display:none;margin:10px 14px;padding:8px;background:var(--warn-bg);border:1px solid #FFE380;font-size:12px' });

  // 합계행 갱신은 블록별 id 로 찾는다(비-LABOR 블록도 공수 합계를 보여준다).
  const mmTotalId = (b) => 'mm-total-' + b.block_code;
  const mTotalId = (b, m) => 'mtot-' + b.block_code + '-' + m;

  function sync() {
    const c = recalcBlocks(wiz.get());
    warn.textContent = c.laborErrors.length ? '인력투입계획 확인: ' + c.laborErrors.join(' / ') : '';
    warn.style.display = c.laborErrors.length ? '' : 'none';
    for (const b of laborBlocks) {
      const mmEl = document.getElementById(mmTotalId(b));
      if (mmEl) mmEl.textContent = b.labor.reduce((a, l) => a + num(l.mm), 0).toFixed(2);
      for (const m of MONTHS) {
        const el = document.getElementById(mTotalId(b, m));
        if (!el) continue;
        const s = b.labor.reduce((a, l) => a + num((l.month_alloc || {})[m]), 0);
        el.textContent = s ? s.toFixed(2) : '';
      }
    }
    wiz.patch({});
  }

  const roleCell = (l) => h('td', {}, h('span', { class: 'tag' }, l.role_code),
    l.grade ? h('span', { class: 'sub', style: 'margin-left:4px;color:var(--text-3)' }, l.grade) : null,
    h('div', {}, l.role_label || l.role_name || ''));

  // 숫자 칸은 numInput — 숫자만 받고, 커서가 나가면 콤마
  const mmInput = (l, after) => numInput(l.mm, (v) => { l.mm = v; if (after) after(); sync(); },
    { class: 'input', style: 'width:70px;text-align:right' });

  const monthCells = (l) => (MONTHS.map((m) => h('td', { class: 'num' },
    numInput((l.month_alloc || {})[m] ?? '', (v) => {
      l.month_alloc = l.month_alloc || {};
      if (v === '' || v === '-' || v === '.') delete l.month_alloc[m]; else l.month_alloc[m] = Number(v);
      sync();
    }, { class: 'input', style: 'width:56px;text-align:right' }))));

  // 행별 [자동 배분] — 그 행만 채운다(fillRow). 개월수가 모자라 남으면 알려 준다
  // 행별 [삭제] — 그 행의 월 칸만 비운다(공수는 그대로). 묻지 않는다(2026-11-03 사용자 요청)
  const rowAutoCell = (l) => h('td', { style: 'white-space:nowrap' }, h('button', { class: 'btn btn-sm', style: 'white-space:nowrap', disabled: !!wiz.readOnly,
    onclick: () => {
      const n = MONTHS.filter((m) => m !== 'M').length;
      const left = fillRow(l, n);
      renderStep4(root, wiz.get(), wiz);
      if (left > 0) toast(`${l.role_label || l.role_code}: M${n} 까지 채우고도 ${left} MM 이 남습니다. 개월수를 늘리거나 값을 고치세요.`, 'err');
    } }, '자동 배분'),
  h('button', { class: 'btn btn-sm', style: 'white-space:nowrap;margin-left:4px', disabled: !!wiz.readOnly,
    onclick: () => {
      l.month_alloc = {};
      wiz.patch({ basic: { plan_months: MONTHS.filter((m) => m !== 'M').length } }); // 다 비어도 개월수가 6 으로 돌아가지 않게
      renderStep4(root, wiz.get(), wiz);
    } }, '삭제'));

  // 투입 개월수 — 바꾸면 M1 ~ Mn 칸을 다시 그린다. 줄이면 넘친 달의 배분은 지운다(합계 검증이 숨은 값에 걸리지 않게)
  const nNow = MONTHS.filter((m) => m !== 'M').length;
  const monthsInp = numInput(nNow, () => {}, { class: 'input', style: 'width:60px;text-align:right', 'aria-label': '투입 개월수',
    onchange: (e) => {
      const n = Math.round(Number(e.target.value));
      if (!(n >= 1 && n <= MAX_MONTHS)) { e.target.value = nNow; return; }
      for (const b of laborBlocks) for (const l of b.labor) {
        for (const k of Object.keys(l.month_alloc || {})) if (k !== 'M' && Number(k.slice(1)) > n) delete l.month_alloc[k];
      }
      wiz.patch({ basic: { plan_months: n } });
      renderStep4(root, wiz.get(), wiz);
    } });
  // 실제 투입 시작월(선택) — 넣으면 M1 ~ Mn 머리 아래에 실제 월(26.11 …)이 붙는다. 비우면 M1 ~ Mn 만
  const startInp = h('input', { type: 'month', class: 'input', style: 'width:140px', 'aria-label': '투입 시작월',
    value: state.basic.plan_start || '', disabled: !!wiz.readOnly });
  startInp.addEventListener('change', () => {
    wiz.patch({ basic: { plan_start: startInp.value || '' } });
    renderStep4(root, wiz.get(), wiz);
  });
  // [자동 배분] — 모든 역할 행의 월 칸을 규칙대로 다시 채운다. 이미 넣은 값이 있으면 덮어써도 되는지 먼저 묻는다
  const autoBtn = h('button', { class: 'btn btn-sm', disabled: !!wiz.readOnly, onclick: async () => {
    const rows = laborBlocks.flatMap((b) => b.labor);
    const filled = rows.some((l) => Object.values(l.month_alloc || {}).some((v) => v !== '' && v != null));
    if (filled && !(await confirmModal({ title: '자동 배분', message: '이미 넣은 월별 공수를 모두 지우고 다시 나눕니다. 계속할까요?', okLabel: '다시 나누기' }))) return;
    for (const l of rows) {
      const vals = splitMM(num(l.mm), nNow, l.role_code);
      l.month_alloc = {};
      vals.forEach((v, i) => { if (v) l.month_alloc['M' + (i + 1)] = v; });
    }
    wiz.patch({ basic: { plan_months: nNow } }); // 옛 'M' 칸도 지웠으니 개월수를 그대로 남긴다
    renderStep4(root, wiz.get(), wiz);
    toast(`공수를 M1 ~ M${nNow} 에 나눴습니다. 필요한 칸만 고치세요.`, 'ok');
  } }, '자동 배분');
  // [전체 삭제] — 모든 역할 행의 월 칸을 비운다(공수 · 개월수 · 시작월은 그대로). 되돌릴 수 없으니 먼저 묻는다
  const clearBtn = h('button', { class: 'btn btn-sm', disabled: !!wiz.readOnly, onclick: async () => {
    const rows = laborBlocks.flatMap((b) => b.labor);
    if (!rows.some((l) => Object.keys(l.month_alloc || {}).length)) { toast('지울 월별 공수가 없습니다.'); return; }
    if (!(await confirmModal({ title: '전체 삭제', message: '모든 역할의 월별 공수를 지웁니다. 계속할까요?', okLabel: '전체 삭제', danger: true }))) return;
    for (const l of rows) l.month_alloc = {};
    wiz.patch({ basic: { plan_months: nNow } }); // 다 비어도 개월수가 6 으로 돌아가지 않게
    renderStep4(root, wiz.get(), wiz);
  } }, '전체 삭제');
  colM.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('div', { class: 'card-b', style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;flex-wrap:wrap' },
      h('b', {}, '투입 개월수'), monthsInp, '개월', autoBtn, clearBtn,
      h('b', { style: 'margin-left:16px' }, '시작월'), startInp, h('span', { class: 'sub', style: 'color:var(--text-3)' }, '(선택)'),
      h('span', { class: 'sub', style: 'color:var(--text-3);margin-left:8px' }, `M1 ~ M${nNow} 칸에 달마다 투입 공수(M/M)를 넣으세요. 역할 행은 3단계 개발인건비 행 그대로입니다.`))));

  for (const b of laborBlocks) {
    const isLabor = b.block_code === 'LABOR';
    const tb = h('tbody');

    for (const l of b.labor) {
      if (isLabor) {
        // 기준단가 · 제안단가 · 제안금액 칸은 두지 않는다(2026-11-03 사용자 요청 — 단가는 3단계에서 고친다).
        // 공수를 바꾸면 금액은 보이지 않아도 다시 계산한다
        const recalc = () => { l.amount = Math.round(num(l.proposed_price) * num(l.mm)); };
        tb.appendChild(h('tr', {},
          roleCell(l), h('td', { class: 'sub' }, l.task || ''),
          h('td', { class: 'num' }, mmInput(l, recalc)), rowAutoCell(l),
          ...monthCells(l)));
      } else {
        // 단가·금액 칸을 만들지 않는다. 편집 가능한 것은 공수와 월별 배분뿐이다.
        tb.appendChild(h('tr', {},
          roleCell(l), h('td', { class: 'sub' }, l.task || ''),
          h('td', { class: 'num' }, mmInput(l)), rowAutoCell(l),
          ...monthCells(l)));
      }
    }

    const headCells = [h('th', {}, '역할(등급)'), h('th', {}, '세부내역'), h('th', { class: 'num' }, '공수 (MM)'), h('th', {})];
    const footCells = [h('td', { colspan: '2', class: 'num' }, '합계 (M/M)'),
      h('td', { class: 'num', id: mmTotalId(b) }, ''), h('td', {})];

    colM.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' },
      h('div', { class: 'card-h' }, h('h2', {}, b.name),
        isLabor
          ? h('span', { class: 'badge badge-yellow' }, '인력투입계획')
          : h('span', { class: 'badge' }, '공수 배분')),
      isLabor ? null : h('div', { class: 'banner inf', style: 'margin:10px 14px 0' },
        h('div', {}, '인력투입계획 부록용 공수 배분입니다. 금액은 셋업 항목에 포함됩니다.')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, ...headCells,
          ...MONTHS.map((m) => {
            const lab = monthLabel(state.basic.plan_start, m);
            return h('th', { class: 'num' }, m, lab ? h('div', { style: 'font-weight:400;font-size:11px;color:var(--text-3)' }, lab) : null);
          }))),
        tb,
        h('tfoot', {}, h('tr', {}, ...footCells,
          ...MONTHS.map((m) => h('td', { class: 'num', id: mTotalId(b, m) }, '')))))),
      warn));
  }

  // ── 우: 유사 견적 (자리만) ──
  colR.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '유사 견적')),
    h('div', { class: 'card-b' },
      h('div', { class: 'empty', style: 'padding:24px 8px' },
        h('div', { style: 'font-size:12.5px' }, '데이터 축적 후 제공'),
        h('div', { class: 'sub', style: 'margin-top:6px' }, '견적 50건 이상 쌓이면 유사 사례를 참조합니다 (WBS STEP 9)')))));

  sync();
}
