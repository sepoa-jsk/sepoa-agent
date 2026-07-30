import { api } from '../api.js';
import { h, toast, loading, clear } from '../ui.js';

// 임금단가(개발인건비) 관리 — 연도 탭 / 단가 테이블 편집 / 새 연도 복제 / 활성 연도 지정.
// 라우트는 ADMIN 게이트라 편집 허용(서버도 requireAdmin).
const won = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));

export async function renderLaborRates(root) {
  root.appendChild(loading());

  let years = [];
  let cur = null; // { year, year_id, source, active, rates }

  try {
    ({ years } = await api.laborYears());
  } catch (err) {
    clear(root).appendChild(h('div', { class: 'empty' }, err.message));
    return;
  }
  // 활성 연도 우선, 없으면 최신
  const startYear = (years.find((y) => y.active) || years[0] || {}).year || null;
  await loadYear(startYear);
  clear(root);
  paint();

  async function loadYear(year) {
    cur = await api.laborRates(year);
  }

  function paint() {
    clear(root);
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'page-title' }, '임금단가 관리'),
        h('div', { class: 'page-sub' }, '개발인건비 기준단가(한국SW산업협회 노임 기반). 연도별 이력으로 관리하며, 활성 연도의 단가가 견적에 적용됩니다.')),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: newYear }, '＋ 새 연도(직전 복제)'))));

    // 연도 탭
    const tabs = h('div', { class: 'tabs', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px' });
    for (const y of years) {
      const on = cur && y.year === cur.year;
      tabs.appendChild(h('button', {
        class: 'btn btn-sm' + (on ? ' btn-navy' : ''),
        onclick: on ? null : () => switchYear(y.year),
      }, `${y.year}${y.active ? ' ●' : ''}`));
    }
    root.appendChild(tabs);

    if (!cur || !cur.year) {
      root.appendChild(h('div', { class: 'empty' }, '등록된 임금단가 연도가 없습니다. seed/phase5.js 로 시드하세요.'));
      return;
    }

    // 헤더 정보 + 활성 지정
    root.appendChild(h('div', { class: 'panel', style: 'margin-bottom:12px' },
      h('div', { class: 'panel-body', style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' },
        h('strong', {}, `${cur.year}년`),
        cur.active ? h('span', { class: 'badge badge-green' }, '활성(견적 적용 중)')
          : h('button', { class: 'btn btn-sm', onclick: makeActive }, '이 연도를 활성으로'),
        h('span', { class: 'page-sub', style: 'flex:1' }, cur.source || ''))));

    // 단가 테이블
    const tb = h('tbody');
    const inputs = [];
    for (const r of cur.rates) {
      const cell = (key, opt = {}) => {
        const inp = h('input', {
          class: 'input', style: 'height:28px;' + (opt.num ? 'text-align:right;width:120px' : 'width:100%;min-width:90px'),
          type: opt.num ? 'number' : 'text', step: 'any', value: r[key] == null ? '' : r[key],
          oninput: (e) => { edits(r.id)[key] = e.target.value; },
        });
        inputs.push(inp);
        return inp;
      };
      tb.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'tag' }, r.role_code)),
        h('td', {}, cell('role_name')),
        h('td', {}, cell('grade')),
        h('td', { class: 'num' }, cell('wage_md', { num: true })),
        h('td', { class: 'num' }, cell('wage_mm', { num: true })),
        h('td', { class: 'num' }, cell('overhead', { num: true })),
        h('td', { class: 'num' }, cell('tech_fee', { num: true })),
        h('td', { class: 'num' }, cell('apply_price', { num: true })),
        h('td', {}, cell('note'))));
    }
    root.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid master-grid' },
        h('thead', {}, h('tr', {},
          h('th', {}, '역할코드'), h('th', {}, '역할명'), h('th', {}, '등급'),
          h('th', { class: 'num' }, '노임(M/D)'), h('th', { class: 'num' }, '평균임금(M/M)'),
          h('th', { class: 'num' }, '제경비(110%)'), h('th', { class: 'num' }, '기술료(20%)'),
          h('th', { class: 'num' }, '기준단가(적용가)'), h('th', {}, '비고'))),
        tb)),
      h('div', { style: 'padding:12px 14px;display:flex;justify-content:flex-end;gap:8px' },
        h('span', { class: 'page-sub', style: 'align-self:center' },
          '산정식: 평균임금=노임×20.5 → 제경비=평균임금×110% → 기술료=(평균임금+제경비)×20% → 기준단가=합. 기준단가가 견적 인건비의 기준단가로 쓰입니다.'),
        h('button', { class: 'btn btn-navy', onclick: saveEdits }, '변경사항 저장'))));
  }

  // 편집 버퍼 (id → {col: value})
  const _edits = {};
  function edits(id) { return (_edits[id] = _edits[id] || {}); }

  async function saveEdits() {
    const ids = Object.keys(_edits).filter((id) => Object.keys(_edits[id]).length);
    if (!ids.length) return toast('변경사항이 없습니다.', 'ok');
    try {
      for (const id of ids) await api.updateLaborRate(id, _edits[id]);
      for (const id of ids) delete _edits[id];
      await loadYear(cur.year);
      paint();
      toast(`${ids.length}개 단가를 저장했습니다.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  async function switchYear(year) {
    for (const k of Object.keys(_edits)) delete _edits[k];
    await loadYear(year);
    paint();
  }

  async function makeActive() {
    try {
      await api.setActiveLaborYear(cur.year_id);
      ({ years } = await api.laborYears());
      await loadYear(cur.year);
      paint();
      toast(`${cur.year}년을 활성 연도로 지정했습니다.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  async function newYear() {
    const latest = years[0] ? years[0].year : new Date().getFullYear();
    const input = prompt(`새 연도를 입력하세요 (직전 연도 ${latest} 단가를 복제합니다).`, String(latest + 1));
    if (!input) return;
    const year = Number(input);
    if (!year || year < 2000 || year > 2100) return toast('연도가 올바르지 않습니다.', 'err');
    try {
      const r = await api.createLaborYear({ year, clone_from_year: latest, source: `${year}년 임금단가 (${latest}년 복제)` });
      ({ years } = await api.laborYears());
      await loadYear(year);
      paint();
      toast(`${year}년 생성 (${r.cloned}개 단가 복제). 값을 확인·수정 후 활성 지정하세요.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }
}
