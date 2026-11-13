import { api } from '../api.js';
import { h, toast, loading, clear, numInput, resizableColumns } from '../ui.js';
import { openLaborUpload } from './labor-upload.js';

// 협회노임단가 — 연도별 직무 노임단가(한국SW산업협회 SW기술자 평균임금). SingleSuite 편집 그리드(2026-11-10 사용자 요청).
// 노임단가(M/D)를 고치면 평균임금 · 제경비 · 기술료 · 협회 기준단가를 산정식으로 다시 계산한다(서버 LaborRateSheet.compute 와 같은 식).
// 근무일은 연도마다 다르다(2026년 20.5일, 2025년 20.6일) — 단가표 업로드 때 협회 엑셀에서 읽어 연도에 저장된다.
// 회사 기준단가 = 견적 인건비의 기준단가. 기본은 협회 기준단가에서 백만원 미만 절사, 칸에서 직접 고칠 수 있다.
// 마스터 > 협회노임단가(sq_labor_standards)와 같은 내용이 겹쳐 있어 이 화면 하나로 합쳤다(마스터 쪽은 숨김).
const won = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));
const floorMillion = (v) => Math.floor(Number(v) / 1e6) * 1e6;
function compute(md, days) {
  const mm = md * days, oh = mm * 1.1, tech = (mm + oh) * 0.2;
  return { wage_mm: Math.round(mm), overhead: Math.round(oh), tech_fee: Math.round(tech), apply_price: Math.round(mm + oh + tech) };
}
const EDIT_KEYS = ['role_name', 'grade', 'wage_md', 'wage_mm', 'overhead', 'tech_fee', 'apply_price', 'company_price', 'note'];

export async function renderLaborRates(root) {
  root.appendChild(loading());

  let years = [];
  let cur = null;  // { year, year_id, source, active, rates }
  let rows = [];   // [{ orig, form }]
  const workDays = () => Number(cur && cur.work_days) || 20.5;

  try {
    ({ years } = await api.laborYears());
  } catch (err) {
    clear(root).appendChild(h('div', { class: 'empty' }, err.message));
    return;
  }
  // 사용 중인 연도 우선, 없으면 최신
  await loadYear((years.find((y) => y.active) || years[0] || {}).year || null);
  paint();

  async function loadYear(year) {
    cur = await api.laborRates(year);
    rows = (cur.rates || []).map((r) => ({ orig: r, form: { ...r } }));
  }
  const isDirty = () => rows.some(changed);
  function changed(r) { return EDIT_KEYS.some((k) => String(r.form[k] ?? '') !== String(r.orig[k] ?? '')); }

  function paint() {
    clear(root);
    const yearSel = h('select', { class: 'ss-select', 'aria-label': '연도', onchange: (e) => switchYear(Number(e.target.value), e) },
      ...years.map((y) => h('option', { value: y.year, selected: cur && y.year === cur.year }, `${y.year}년${y.active ? ' (사용 중)' : ''}`)));
    root.appendChild(h('div', { class: 'ss-edithead' },
      h('div', { class: 'ss-edithead__fields' }, h('div', { class: 'ss-field' }, yearSel)),
      h('div', { class: 'ss-actions' },
        h('button', { class: 'ss-btn ss-btn--default', onclick: upload }, '단가표 업로드'),
        h('button', { class: 'ss-btn ss-btn--default', onclick: newYear }, '새 연도'),
        cur && cur.year && !cur.active ? h('button', { class: 'ss-btn ss-btn--default', onclick: makeActive }, '사용 연도 지정') : null,
        h('button', { class: 'ss-btn ss-btn--save', onclick: saveEdits }, '저장'))));

    if (!cur || !cur.year) {
      root.appendChild(h('div', { class: 'empty' }, '등록된 노임단가 연도가 없습니다.'));
      return;
    }

    const COLS = [['코드', 110], ['이름', 180], ['등급', 80], ['노임단가 (M/D)', 120], [`평균임금 (×${workDays()}일)`, 130],
      ['제경비 (110%)', 120], ['기술료 (20%)', 120], ['협회 기준단가', 130], ['회사 기준단가', 130], ['비고', 240]];
    const tbody = h('tbody');
    rows.forEach((r) => tbody.appendChild(rowEl(r)));
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${COLS.reduce((s, [, w]) => s + w, 0)}px` },
      h('colgroup', {}, ...COLS.map(([, w]) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, ...COLS.map(([t]) => h('th', {}, t)))),
      tbody);
    root.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill' }, table));
    resizableColumns(table, 'quote2:labor-rates-cols');
  }

  function rowEl(r) {
    const f = r.form;
    const calc = {};
    const calcTd = (k) => (calc[k] = h('td', { class: 'ss-cell--amount' }, won(f[k])));
    const text = (k, attrs = {}) => h('td', { class: 'ss-cell--input' },
      h('input', { class: 'ss-cellinput', type: 'text', value: f[k] ?? '', 'aria-label': k, ...attrs, oninput: (e) => { f[k] = e.target.value; } }));
    const money = (k, onRaw) => numInput(f[k], onRaw, { class: 'ss-cellinput', style: 'text-align:right', 'aria-label': k });
    let companyIn;
    const mdIn = money('wage_md', (v) => {
      const autoCompany = f.company_price == null || f.company_price === '' || Number(f.company_price) === floorMillion(f.apply_price);
      f.wage_md = v;
      const md = Number(v);
      if (v === '' || !(md > 0)) return;
      Object.assign(f, compute(md, workDays()));
      ['wage_mm', 'overhead', 'tech_fee', 'apply_price'].forEach((k) => { calc[k].textContent = won(f[k]); });
      if (autoCompany) {
        f.company_price = floorMillion(f.apply_price);
        companyIn.replaceWith(companyIn = money('company_price', (x) => { f.company_price = x; }));
      }
    });
    companyIn = money('company_price', (x) => { f.company_price = x; });
    return h('tr', {},
      h('td', { class: 'ss-cell--link', style: 'text-align:center' }, f.role_code),
      text('role_name'), text('grade', { style: 'text-align:center' }),
      h('td', { class: 'ss-cell--input' }, mdIn),
      calcTd('wage_mm'), calcTd('overhead'), calcTd('tech_fee'), calcTd('apply_price'),
      h('td', { class: 'ss-cell--input' }, companyIn),
      text('note'));
  }

  async function saveEdits() {
    const list = rows.filter(changed);
    if (!list.length) return toast('변경된 내용이 없습니다.', 'ok');
    if (list.some((r) => !String(r.form.role_name ?? '').trim())) return toast('이름을 입력하세요.', 'err');
    try {
      for (const r of list) {
        const body = {};
        EDIT_KEYS.forEach((k) => {
          if (String(r.form[k] ?? '') === String(r.orig[k] ?? '')) return;
          const num = !['role_name', 'grade', 'note'].includes(k);
          body[k] = r.form[k] === '' || r.form[k] == null ? '' : num ? Number(r.form[k]) : r.form[k];
        });
        await api.updateLaborRate(r.orig.id, body);
      }
      await loadYear(cur.year);
      paint();
      toast(`${list.length}개 직무를 저장했습니다.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  async function switchYear(year, e) {
    if (isDirty()) {
      toast('저장하지 않은 변경이 있습니다. 먼저 저장하세요.', 'err');
      if (e) e.target.value = cur.year;
      return;
    }
    await loadYear(year);
    paint();
  }

  async function makeActive() {
    try {
      await api.setActiveLaborYear(cur.year_id);
      ({ years } = await api.laborYears());
      await loadYear(cur.year);
      paint();
      toast(`${cur.year}년을 사용 연도로 지정했습니다.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  // 협회 단가표 PDF 를 읽어 그 연도 단가를 채운다 — 기본 연도는 가장 최근 연도 다음 해
  function upload() {
    const latest = years[0] ? years[0].year : new Date().getFullYear() - 1;
    openLaborUpload({
      defaultYear: latest + 1 > new Date().getFullYear() + 1 ? latest : latest + 1,
      onDone: async (year) => {
        ({ years } = await api.laborYears());
        await loadYear(year);
        paint();
      },
    });
  }

  async function newYear() {
    const latest = years[0] ? years[0].year : new Date().getFullYear();
    const input = prompt(`새 연도를 입력하세요 (직전 연도 ${latest} 단가를 복제합니다).`, String(latest + 1));
    if (!input) return;
    const year = Number(input);
    if (!year || year < 2000 || year > 2100) return toast('연도가 올바르지 않습니다.', 'err');
    try {
      const r = await api.createLaborYear({ year, clone_from_year: latest, source: `${year}년 노임단가 (${latest}년 복제)` });
      ({ years } = await api.laborYears());
      await loadYear(year);
      paint();
      toast(`${year}년 생성 (${r.cloned}개 직무 복제). 값을 확인한 뒤 사용 연도로 지정하세요.`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }
}
