// 선택 팝업 — 견적 작성에서 '고르는' 값은 팝업에서 고른다(직접 입력도 그대로 된다).
//   pickItems    : 가격정책 품목(여러 개) — 솔루션 · 구축형태 · 검색으로 걸러 체크해 넣는다
//   pickRole     : 노임단가 직무(하나) — 사용 중인 연도의 적용단가가 기준단가가 된다
//   pickCustomer : 고객사 마스터(하나) — 수신처 · 담당자 · 연락처 · 이메일을 채운다
// 모두 Promise 로 고른 값을 돌려주고, 닫으면 null(품목은 빈 배열).
import { api } from '../../api.js';
import { store } from '../../app.js';
import { h, won, clear, openModal } from '../../ui.js';

// 구축형은 하나로 보인다(공통 · 일시불 · 분납을 합침, 2026-11-02 사용자 요청)
const DEPLOYMENTS = [['', '전체 구축형태'], ['ONPREM', '구축형'], ['SAAS', 'SaaS'], ['PCLOUD', 'Private Cloud']];
const depKey = (c) => (String(c || '').startsWith('ONPREM') ? 'ONPREM' : c || '');
const depName = (c) => (DEPLOYMENTS.find(([k]) => k === depKey(c)) || [])[1] || c || '';

// 공통 틀 — 위에 거르기 줄, 가운데 표, 아래 확인 · 취소
function pickerModal({ title, filters, head, width = '920px', multi, onOk }) {
  const tbody = h('tbody');
  const okBtn = h('button', { class: 'btn btn-primary', disabled: true }, multi ? '추가' : '선택');
  const m = openModal({
    title,
    body: h('div', {},
      h('div', { style: 'display:flex;gap:6px;margin-bottom:8px' }, ...filters),
      h('div', { style: 'max-height:58vh;overflow:auto;border:1px solid #E7EAF0' },
        h('table', { class: 'ss-grid', style: 'width:100%' }, h('thead', {}, h('tr', {}, ...head.map((t) => h('th', {}, t)))), tbody))),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  m.back.querySelector('.modal').style.width = width;
  okBtn.onclick = () => { onOk(); m.close(); };
  return { tbody, okBtn, m };
}

export function pickItems({ solution, deployment, exclude } = {}) {
  return new Promise(async (resolve) => {
    const solutions = (await store.getMaster()).solutions || [];
    let items = [];
    const picked = new Map();
    let done = false;
    const search = h('input', { class: 'ss-input', placeholder: '코드 · 품목명 · 구분 검색', style: 'flex:1', oninput: () => paint() });
    const solSel = h('select', { class: 'ss-select', style: 'width:130px', onchange: () => load() },
      ...solutions.map((s) => h('option', { value: s.code, selected: s.code === solution }, s.name || s.code)));
    const depSel = h('select', { class: 'ss-select', style: 'width:140px', onchange: () => load() },
      ...DEPLOYMENTS.map(([v, l]) => h('option', { value: v, selected: v === depKey(deployment) }, l)));
    const { tbody, okBtn, m } = pickerModal({
      title: '품목 선택', multi: true, filters: [search, solSel, depSel],
      head: ['', '코드', '구분', '품목명', '세부기능', '단위', '기준단가 (원)', '구축형태'],
      onOk: () => { done = true; resolve([...picked.values()]); },
    });
    // 취소 · 바깥 누르기로 닫히면 빈 배열
    const obs = new MutationObserver(() => { if (!m.back.isConnected) { obs.disconnect(); if (!done) resolve([]); } });
    obs.observe(document.body, { childList: true });
    async function load() {
      clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 8, class: 'ss-cell--empty' }, '불러오는 중...')));
      // 구축형은 전체를 받아 ONPREM* 를 모두 보인다
      const dep = depSel.value;
      try { items = (await api.pricing(solSel.value, dep && dep !== 'ONPREM' ? dep : undefined)).items || []; } catch { items = []; }
      if (dep) items = items.filter((i) => depKey(i.deployment) === dep);
      if (exclude) items = items.filter((i) => !exclude.has(i.code));
      paint();
    }
    function paint() {
      const q = search.value.trim().toLowerCase();
      clear(tbody);
      const rows = items.filter((i) => !q || [i.code, i.name, i.category].some((v) => String(v || '').toLowerCase().includes(q)));
      if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 8, class: 'ss-cell--empty' }, '품목이 없습니다. 가격정책 > 견적 품목에서 등록하세요.')));
      for (const i of rows) {
        const box = h('input', { type: 'checkbox', checked: picked.has(i.code), onchange: (e) => {
          if (e.target.checked) picked.set(i.code, i); else picked.delete(i.code);
          okBtn.disabled = !picked.size; okBtn.textContent = picked.size ? `추가 (${picked.size})` : '추가';
        } });
        tbody.appendChild(h('tr', { class: 'is-clickable', onclick: (e) => { if (e.target !== box) box.click(); } },
          h('td', {}, box), h('td', { class: 'ss-cell--link' }, i.code), h('td', {}, i.category || ''),
          h('td', { class: 'ss-cell--left' }, i.name), h('td', { class: 'ss-cell--left', title: i.spec || '' }, String(i.spec || '').split('\n')[0]),
          h('td', {}, i.unit || ''), h('td', { class: 'ss-cell--amount' }, won(i.base_price)), h('td', {}, depName(i.deployment))));
      }
    }
    load();
    setTimeout(() => search.focus(), 0);
  });
}

function singlePick({ title, head, load, row, empty, width }) {
  return new Promise(async (resolve) => {
    let list = [];
    let done = false;
    const search = h('input', { class: 'ss-input', placeholder: '검색', style: 'flex:1', oninput: () => paint() });
    const { tbody, m } = pickerModal({ title, head, width, multi: false, filters: [search], onOk: () => {} });
    m.back.querySelector('.modal-foot .btn-primary').remove(); // 한 줄을 누르면 바로 고른다
    const obs = new MutationObserver(() => { if (!m.back.isConnected) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.body, { childList: true });
    function paint() {
      const q = search.value.trim().toLowerCase();
      clear(tbody);
      const rows = list.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q));
      if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: head.length, class: 'ss-cell--empty' }, empty)));
      for (const x of rows) {
        tbody.appendChild(h('tr', { class: 'is-clickable', onclick: () => { done = true; m.close(); resolve(x); } }, ...row(x)));
      }
    }
    try { list = await load(); } catch { list = []; }
    paint();
    setTimeout(() => search.focus(), 0);
  });
}

// 견적 인건비 기준단가 — 회사 기준단가(company_price), 없으면 협회 기준단가(apply_price) (2026-11-10 사용자 요청)
export const laborBase = (r) => (r == null ? null : r.company_price != null ? Number(r.company_price) : r.apply_price != null ? Number(r.apply_price) : null);

export function pickRole() {
  return singlePick({
    title: '직무 선택 (노임단가)', width: '760px', empty: '노임단가가 없습니다. 협회노임단가 화면에서 등록하세요.',
    head: ['직무코드', '직무명', '등급', '노임단가 (M/D)', '회사 기준단가 (원)', '비고'],
    load: async () => (await api.laborRates()).rates || [],
    row: (r) => [h('td', { class: 'ss-cell--link' }, r.role_code), h('td', { class: 'ss-cell--left' }, r.role_name), h('td', {}, r.grade || ''),
      h('td', { class: 'ss-cell--amount' }, won(r.wage_md)), h('td', { class: 'ss-cell--amount' }, won(laborBase(r))), h('td', { class: 'ss-cell--left' }, r.note || '')],
  });
}

export function pickCustomer() {
  return singlePick({
    title: '고객사 선택', width: '820px', empty: '등록된 고객사가 없습니다. 기준정보 > 고객사에서 등록하거나 직접 입력하세요.',
    head: ['코드', '고객사명', '원청사', '담당자', '연락처', '이메일'],
    // 간접 고객(경유 업체가 있는 행)은 경유 업체 행을 _via 로 붙여 돌려준다 — 견적에서 수신처 = 경유 업체, 최종 고객사 = 이 고객
    load: async () => {
      const all = ((await api.masterList('customers')).rows || []).filter((c) => c.active !== 0);
      return all.map((c) => ({ ...c, _via: c.via_code ? all.find((p) => p.code === c.via_code) || null : null }));
    },
    row: (c) => [h('td', { class: 'ss-cell--link' }, c.code),
      h('td', { class: 'ss-cell--left' }, c.name, c.kind === 'PARTNER' ? h('span', { style: 'margin-left:6px;font-size:11px;color:var(--ss-ink-3)' }, '원청사') : null),
      h('td', { class: 'ss-cell--left' }, c._via ? c._via.name : ''), h('td', {}, c.contact_name || ''),
      h('td', {}, c.contact_phone || ''), h('td', { class: 'ss-cell--left' }, c.contact_email || '')],
  });
}

// 품목 → 견적 행. 제안단가는 기준단가로 시작한다(템플릿 적용과 같다)
export function itemRow(i) {
  const base = i.base_price != null ? Number(i.base_price) : null;
  return { item_code: i.code, category: i.category || '', name: i.name, spec: i.spec || '', unit: i.unit || '',
    qty: Number(i.qty_default) || 1, base_price: base, proposed_price: base || 0, amount: 0 };
}
