// 노임단가표 업로드 창 — 연도를 넣고 한국SW산업협회 'SW기술자 평균임금' 공표 엑셀(또는 PDF)을 고르면
// 서버가 표를 읽어(POST /api/labor-rates/parse) 직무별 노임단가(M/D) · 근무일과 산정식 결과를 채운다. 협회 17개 직무 중 회사가 쓰는 직무만 체크된다.
// 여기서 확인 · 고친 뒤 [등록] 하면 그 연도가 만들어지거나(비활성) 같은 직무코드 값이 덮어써진다.
// 활성 연도 지정은 등록과 따로 한다 — 등록만으로 견적 단가가 바뀌지 않는다.
import { api } from '../api.js';
import { h, toast, clear, openModal, numInput } from '../ui.js';

const won = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));

// 산정식 — 서버 LaborRateSheet.compute 와 같다(중간값은 반올림하지 않고, 적용단가는 합을 반올림). 화면 표시용이고 등록 때 서버가 다시 계산한다.
function compute(md, days) {
  const mm = md * days, oh = mm * 1.1, tech = (mm + oh) * 0.2, apply = Math.round(mm + oh + tech);
  return { wage_mm: Math.round(mm), overhead: Math.round(oh), tech_fee: Math.round(tech), apply_price: apply, company_price: Math.floor(apply / 1e6) * 1e6 };
}

export function openLaborUpload({ defaultYear, onDone }) {
  let parsed = null;   // 서버 응답
  let rows = [];       // [{ use, role_code, role_name, grade, wage_md, note, sort, matched, ... }]
  const days = () => Number(parsed && parsed.work_days) || 20.5; // 근무일 — 문서에서 읽은 값(2026년 20.5, 2025년 20.6)

  const yearIn = h('input', { class: 'ss-input', style: 'width:90px;text-align:center', value: String(defaultYear) });
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.pdf', style: 'font-size:13px' });
  const readBtn = h('button', { class: 'btn btn-navy', onclick: read }, '읽기');
  const result = h('div', { style: 'margin-top:12px' },
    h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, '연도를 넣고 한국SW산업협회 SW기술자 평균임금 엑셀을 고른 뒤 [읽기] 를 누르세요.'));
  const sourceIn = h('input', { class: 'ss-input', style: 'flex:1;min-width:0' });
  const okBtn = h('button', { class: 'btn btn-primary', disabled: true, onclick: submit }, '등록');

  const m = openModal({
    title: '노임단가표 업로드',
    body: h('div', {},
      h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
        h('label', { style: 'font-size:13px' }, '연도'), yearIn, h('span', { style: 'font-size:13px' }, '년'),
        h('label', { style: 'font-size:13px;margin-left:12px' }, '단가표 파일'), fileIn, readBtn),
      result),
    footer: [h('div', { style: 'display:flex;align-items:center;gap:6px;flex:1;margin-right:12px' },
      h('span', { style: 'font-size:12px;color:var(--ss-ink-3);white-space:nowrap' }, '출처'), sourceIn),
    h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '1180px';

  async function read() {
    const year = Number(yearIn.value);
    if (!year || year < 2000 || year > 2100) return toast('연도를 확인하세요.', 'err');
    const file = fileIn.files[0];
    if (!file) return toast('단가표 엑셀을 고르세요.', 'err');
    readBtn.disabled = true; readBtn.textContent = '읽는 중…';
    try {
      parsed = await api.parseLaborSheet(year, file);
      rows = parsed.rows.map((r) => ({ ...r, use: !!r.role_code, matched: !!r.role_code, role_code: r.role_code || '' }));
      sourceIn.value = `한국SW산업협회 ${year}년 SW기술자 평균임금 (${parsed.file_name || file.name})`;
      paint();
    } catch (err) {
      clear(result).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
      okBtn.disabled = true;
    } finally { readBtn.disabled = false; readBtn.textContent = '읽기'; }
  }

  function paint() {
    clear(result);
    const ex = parsed.existing || {};
    const msgs = [...(parsed.warnings || [])];
    msgs.push(ex.exists
      ? `${parsed.year}년이 이미 있습니다(직무 ${ex.rate_count}개${ex.active ? ', 견적 적용 중' : ''}). 등록하면 직무코드가 같은 줄을 읽은 값으로 덮어씁니다.`
      : `${parsed.year}년을 새로 만듭니다. 등록 후 확인하고 [사용 연도 지정] 을 누르면 견적에 적용됩니다.`);
    msgs.push(`근무일 ${days()}일로 계산했습니다.`);
    if (rows.some((r) => !r.matched)) msgs.push(`기존 직무(${parsed.base_year || '-'}년)와 이름이 맞지 않는 직무는 체크가 꺼져 있습니다. 쓰려면 체크하고 직무코드를 넣으세요.`);
    result.appendChild(h('div', { style: 'font-size:12px;line-height:1.7;color:var(--ss-ink-2);background:#F8FAFC;border:1px solid #E7EAF0;border-radius:4px;padding:8px 12px' },
      ...msgs.map((t) => h('div', {}, '· ' + t))));

    const tbody = h('tbody');
    const cols = [['', 40], ['상태', 70], ['직무코드', 120], ['직무명', 180], ['등급', 90], ['노임단가 (M/D)', 120],
      ['평균임금 (M/M)', 120], ['제경비 (110%)', 120], ['기술료 (20%)', 110], ['협회 기준단가', 120], ['회사 기준단가', 120], ['비고', 150]];
    for (const r of rows) {
      const calc = compute(Number(r.wage_md) || 0, days());
      const amt = (v) => h('td', { style: 'text-align:right' }, won(v));
      const applyCell = h('td', { class: 'ss-cell--amount', style: 'font-weight:600' }, won(calc.apply_price));
      const calcCells = [amt(calc.wage_mm), amt(calc.overhead), amt(calc.tech_fee)];
      const companyCell = amt(calc.company_price);
      const txt = (key, attrs = {}) => h('td', { class: 'ss-cell--input' }, h('input', { class: 'ss-input', style: 'width:100%;height:28px', value: r[key] ?? '', ...attrs,
        oninput: (e) => { r[key] = e.target.value; } }));
      tbody.appendChild(h('tr', {},
        h('td', { style: 'text-align:center' }, h('input', { type: 'checkbox', checked: r.use, onchange: (e) => { r.use = e.target.checked; count(); } })),
        h('td', { style: 'text-align:center;color:' + (r.matched ? 'var(--ss-ink-3)' : 'var(--ss-emphasis)') }, r.matched ? '기존' : '새 직무'),
        txt('role_code', { placeholder: r.matched ? '' : '코드 입력' }),
        txt('role_name'),
        txt('grade'),
        h('td', { class: 'ss-cell--input' }, numInput(r.wage_md, (v) => {
          r.wage_md = v;
          const c = compute(Number(v) || 0, days());
          calcCells[0].textContent = won(c.wage_mm); calcCells[1].textContent = won(c.overhead);
          calcCells[2].textContent = won(c.tech_fee); applyCell.textContent = won(c.apply_price); companyCell.textContent = won(c.company_price);
        }, { class: 'ss-input', style: 'width:100%;height:28px;text-align:right' })),
        ...calcCells, applyCell, companyCell,
        txt('note')));
    }
    if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty' }, '읽은 직무가 없습니다.')));
    result.appendChild(h('div', { class: 'ss-gridwrap', style: 'margin-top:10px;max-height:52vh;overflow:auto' },
      h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((a, [, w]) => a + w, 0)}px` },
        h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
        h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
        tbody)));
    result.appendChild(h('div', { style: 'margin-top:6px;font-size:12px;color:var(--ss-ink-3)' },
      `산정식: 평균임금 = 노임 × ${days()} → 제경비 = 평균임금 × 110% → 기술료 = (평균임금 + 제경비) × 20% → 협회 기준단가 = 합. 회사 기준단가 = 백만원 미만 절사.`));
    count();
  }

  function count() {
    const n = rows.filter((r) => r.use).length;
    okBtn.disabled = !n;
    okBtn.textContent = n ? `등록 (${n}건)` : '등록';
  }

  async function submit() {
    const use = rows.filter((r) => r.use);
    const bad = use.findIndex((r) => !String(r.role_code).trim() || !String(r.role_name).trim() || !(Number(r.wage_md) > 0));
    if (bad >= 0) return toast(`${use[bad].role_name || bad + 1 + '번째'}: 직무코드 · 직무명 · 노임단가를 확인하세요.`, 'err');
    okBtn.disabled = true;
    try {
      const r = await api.importLaborRates({
        year: parsed.year, source: sourceIn.value.trim(), work_days: days(),
        rows: use.map((x) => ({ role_code: String(x.role_code).trim(), role_name: String(x.role_name).trim(), grade: x.grade,
          note: x.note, wage_md: Number(x.wage_md), sort: x.sort })),
      });
      m.close();
      toast(`${r.year}년 단가를 등록했습니다 (새로 ${r.inserted}건 · 덮어쓰기 ${r.updated}건).`, 'ok');
      onDone?.(r.year);
    } catch (err) {
      okBtn.disabled = false;
      toast(err.message, 'err');
    }
  }
}
