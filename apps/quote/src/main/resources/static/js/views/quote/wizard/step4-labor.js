// STEP④ 인건비 — 3분할. 좌 리스크 팩터 / 중 공수·월별배분 / 우 유사견적(자리만).
// validateMonthAlloc 의 Σ 검증(배분 합계 = 공수)을 STEP③ 과 같은 규칙으로 이관했다.
//
// 금액을 산출하는 인건비는 **LABOR 블록뿐**이다. 비-LABOR 블록(SETUP 등)에 붙은 인건비 행은
// 인력투입계획 부록용 공수 배분이며, 금액은 이미 같은 블록의 셋업 품목에 들어 있다.
// (실측 SK이터닉스: 셋업 3.7MM × 12,000,000 = 44,400,000 한 줄뿐, 인건비 행 없음)
// 그래서 비-LABOR 블록에는 단가·금액 칸을 아예 만들지 않는다.
import { h, won, numInput } from '../../../ui.js';
import { RISK_FACTORS, FACTOR_NOTE } from './risk-factors.js';
import { recalcBlocks } from './step3-config.js';

const num = (v) => Number(v) || 0;
const MONTHS = ['M', 'M1', 'M2', 'M3', 'M4', 'M5'];

export function renderStep4(root, state, wiz) {
  root.replaceChildren();

  const laborBlocks = (state.blocks || []).filter((b) => (b.labor || []).length);
  if (!laborBlocks.length) {
    root.appendChild(h('div', { class: 'banner inf' },
      h('div', {}, h('b', {}, '이 템플릿에는 인건비 블록이 없습니다.'),
        'SaaS·PCloud 는 셋업비가 MM 기반이라 STEP③ 에서 함께 입력합니다. 다음 단계로 넘어가세요.')));
    return;
  }

  const layout = h('div', { style: 'display:grid;grid-template-columns:260px 1fr 240px;gap:14px;align-items:start' });
  const colL = h('div', {}); const colM = h('div', { style: 'min-width:0' }); const colR = h('div', {});
  layout.appendChild(colL); layout.appendChild(colM); layout.appendChild(colR);
  root.appendChild(layout);

  // ── 좌: 리스크 팩터 ──
  const picked = new Set(state.riskFactors || []);
  const factorList = h('div', {});
  for (const f of RISK_FACTORS) {
    const on = picked.has(f.code);
    const box = h('div', { class: 'factor' + (on ? ' on' : '') },
      h('input', { type: 'checkbox', checked: on }),
      h('div', { class: 't' },
        h('b', {}, f.label), h('span', {}, f.desc)),
      h('span', { class: 'co' }, f.type === 'MULTIPLY' ? `×${f.factor}` : `+${f.factor}${f.unit || ''}`));
    box.addEventListener('click', () => {
      if (picked.has(f.code)) picked.delete(f.code); else picked.add(f.code);
      wiz.patch({ riskFactors: [...picked] });
      renderStep4(root, wiz.get(), wiz);
    });
    factorList.appendChild(box);
  }
  colL.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '리스크 계수'), h('span', { class: 'sub' }, `${picked.size}개 선택`)),
    h('div', { class: 'card-b' },
      h('div', { class: 'banner wrn', style: 'margin-bottom:10px' },
        h('div', {}, h('b', {}, '아직 반영되지 않습니다'), FACTOR_NOTE)),
      factorList)));

  // ── 중: 역할별 공수 + 월별 배분 ──
  const warn = h('div', { style: 'display:none;margin:10px 14px;padding:8px;background:var(--warn-bg);border:1px solid #FFE380;font-size:12px' });

  // 합계행 갱신은 블록별 id 로 찾는다(비-LABOR 블록도 공수 합계를 보여준다).
  const mmTotalId = (b) => 'mm-total-' + b.block_code;
  const mTotalId = (b, m) => 'mtot-' + b.block_code + '-' + m;

  function sync() {
    const c = recalcBlocks(wiz.get());
    warn.textContent = c.laborErrors.length ? '인력투입계획 확인: ' + c.laborErrors.join(' / ') : '';
    warn.style.display = c.laborErrors.length ? '' : 'none';
    const t = document.getElementById('labor-total');
    if (t) t.textContent = won(laborBlocks.filter((b) => b.block_code === 'LABOR').reduce((a, b) => a + (b._sub || 0), 0));
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

  const monthCells = (l) => (state.hasLaborPlan ? MONTHS.map((m) => h('td', { class: 'num' },
    numInput((l.month_alloc || {})[m] ?? '', (v) => {
      l.month_alloc = l.month_alloc || {};
      if (v === '' || v === '-' || v === '.') delete l.month_alloc[m]; else l.month_alloc[m] = Number(v);
      sync();
    }, { class: 'input', style: 'width:56px;text-align:right' }))) : []);

  for (const b of laborBlocks) {
    const isLabor = b.block_code === 'LABOR';
    const tb = h('tbody');

    for (const l of b.labor) {
      if (isLabor) {
        const amt = h('td', { class: 'num' }, won(l.amount || 0));
        const recalc = () => { l.amount = Math.round(num(l.proposed_price) * num(l.mm)); amt.textContent = won(l.amount); };
        const priceInp = numInput(l.proposed_price, (v) => { l.proposed_price = v; recalc(); sync(); },
          { class: 'input', style: 'width:118px;text-align:right;background:var(--primary-weak);color:var(--primary);font-weight:600' });
        tb.appendChild(h('tr', {},
          roleCell(l), h('td', { class: 'sub' }, l.task || ''),
          h('td', { class: 'num' }, mmInput(l, recalc)),
          h('td', { class: 'num' }, l.base_price != null ? won(l.base_price) : '-'),
          h('td', { class: 'num' }, priceInp),
          amt, ...monthCells(l)));
      } else {
        // 단가·금액 칸을 만들지 않는다. 편집 가능한 것은 공수와 월별 배분뿐이다.
        tb.appendChild(h('tr', {},
          roleCell(l), h('td', { class: 'sub' }, l.task || ''),
          h('td', { class: 'num' }, mmInput(l)),
          ...monthCells(l)));
      }
    }

    const headCells = isLabor
      ? [h('th', {}, '역할(등급)'), h('th', {}, '세부내역'), h('th', { class: 'num' }, '공수 (MM)'),
        h('th', { class: 'num' }, '기준단가 (원)'), h('th', { class: 'num' }, '제안단가 (원)'),
        h('th', { class: 'num' }, '제안금액 (원)')]
      : [h('th', {}, '역할(등급)'), h('th', {}, '세부내역'), h('th', { class: 'num' }, '공수 (MM)')];

    const footCells = isLabor
      ? [h('td', { colspan: '2', class: 'num' }, '합계 (M/M)'),
        h('td', { class: 'num', id: mmTotalId(b) }, ''),
        h('td', {}), h('td', {}), h('td', { class: 'num', id: 'labor-total' }, '')]
      : [h('td', { colspan: '2', class: 'num' }, '합계 (M/M)'),
        h('td', { class: 'num', id: mmTotalId(b) }, '')];

    colM.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' },
      h('div', { class: 'card-h' }, h('h2', {}, b.name),
        isLabor
          ? (state.hasLaborPlan ? h('span', { class: 'badge badge-yellow' }, '인력투입계획') : null)
          : h('span', { class: 'badge' }, '공수 배분')),
      isLabor ? null : h('div', { class: 'banner inf', style: 'margin:10px 14px 0' },
        h('div', {}, '인력투입계획 부록용 공수 배분입니다. 금액은 셋업 항목에 포함됩니다.')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, ...headCells,
          ...(state.hasLaborPlan ? MONTHS.map((m) => h('th', { class: 'num' }, m)) : []))),
        tb,
        h('tfoot', {}, h('tr', {}, ...footCells,
          ...(state.hasLaborPlan ? MONTHS.map((m) => h('td', { class: 'num', id: mTotalId(b, m) }, '')) : []))))),
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
