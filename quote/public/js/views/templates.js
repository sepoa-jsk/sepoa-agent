import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, loading, clear } from '../ui.js';

// 견적서 템플릿 관리(ADMIN) — 솔루션별 목록 + 상세(블록/기본모듈/인건비/조건).
// 5-B 완료 기준: 솔루션별 템플릿 목록 노출, 상세에서 블록·기본모듈·인건비 확인.
const DEP = { ONPREM: '구축형(On-prem)', SAAS: 'SaaS', PCLOUD: 'Private Cloud', INSTALL: '분납' };
const depName = (c) => DEP[c] || c;
const solName = (c) => (store.solutionName ? store.solutionName(c) : c) || c;

export async function renderTemplates(root) {
  root.appendChild(loading());
  let templates = [];
  try { ({ templates } = await api.templates()); }
  catch (err) { clear(root).appendChild(h('div', { class: 'empty' }, err.message)); return; }
  clear(root);

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '견적서 템플릿'),
      h('div', { class: 'page-sub' }, '솔루션×구축형태별 프리셋. 견적 작성에서 템플릿을 고르면 블록·기본모듈·인건비가 자동 편입됩니다. (공통 블록/조건/임금단가는 참조만)'))));

  const layout = h('div', { style: 'display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap' });
  const listCol = h('div', { style: 'width:320px;flex:none' });
  const detailCol = h('div', { style: 'flex:1;min-width:420px' });
  layout.appendChild(listCol); layout.appendChild(detailCol);
  root.appendChild(layout);

  // 솔루션별 그룹핑
  const bySol = {};
  for (const t of templates) (bySol[t.solution] = bySol[t.solution] || []).push(t);

  let curCode = null;
  function renderList() {
    clear(listCol);
    if (!templates.length) { listCol.appendChild(h('div', { class: 'empty' }, '템플릿이 없습니다. seed/phase5.js 로 시드하세요.')); return; }
    for (const [sol, list] of Object.entries(bySol)) {
      listCol.appendChild(h('div', { class: 'page-sub', style: 'font-weight:700;margin:10px 4px 6px;color:var(--text-sub)' }, solName(sol)));
      for (const t of list) {
        const on = t.code === curCode;
        listCol.appendChild(h('div', {
          class: 'panel', style: 'padding:10px 12px;margin-bottom:6px;cursor:pointer;' + (on ? 'border-color:var(--accent);box-shadow:0 0 0 2px rgba(26,86,170,.12)' : ''),
          onclick: () => selectTpl(t.code),
        },
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' },
            h('strong', {}, t.name),
            t.active ? null : h('span', { class: 'badge badge-gray' }, '비활성')),
          h('div', { class: 'page-sub', style: 'margin-top:2px' }, `${depName(t.deployment)}${t.brand ? ' · ' + t.brand : ''}`)));
      }
    }
  }

  async function selectTpl(code) {
    curCode = code;
    renderList();
    clear(detailCol).appendChild(loading());
    let d;
    try { d = await api.templateDetail(code); }
    catch (err) { clear(detailCol).appendChild(h('div', { class: 'empty' }, err.message)); return; }
    renderDetail(d);
  }

  function chip(text, cls) { return h('span', { class: 'badge ' + (cls || 'badge-blue'), style: 'margin-right:6px' }, text); }

  function renderDetail(d) {
    const t = d.template;
    clear(detailCol);
    // 헤더
    detailCol.appendChild(h('div', { class: 'panel', style: 'margin-bottom:12px' },
      h('div', { class: 'panel-body' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px' },
          h('div', {}, h('strong', { style: 'font-size:16px' }, t.name), h('span', { class: 'page-sub', style: 'margin-left:8px' }, t.code)),
          h('div', {},
            t.include_maintenance ? chip('유지보수 포함', 'badge-green') : null,
            t.include_component ? chip('컴포넌트 포함', 'badge-green') : null,
            t.active ? chip('활성', 'badge-blue') : chip('비활성', 'badge-gray'))),
        h('div', { class: 'page-sub', style: 'margin-top:6px' },
          `${solName(t.solution)} · ${depName(t.deployment)}${t.brand ? ' · ' + t.brand : ''}${t.condition_set ? ' · 조건: ' + t.condition_set : ''}`))));

    // 블록 구성
    const blockWrap = h('div', {});
    for (const b of d.blocks) {
      const items = (d.items && d.items[b.block_code]) || [];
      const body = h('div', { style: 'padding:10px 14px' });
      if (b.block_code === 'LABOR') {
        if (d.labor.length) {
          const tb = h('tbody');
          for (const l of d.labor) tb.appendChild(h('tr', {},
            h('td', {}, h('span', { class: 'tag' }, l.role_code)),
            h('td', {}, l.label || ''),
            h('td', { class: 'page-sub' }, l.task || ''),
            h('td', { class: 'num' }, Number(l.mm_default) + ' MM')));
          body.appendChild(h('table', { class: 'grid master-grid' },
            h('thead', {}, h('tr', {}, h('th', {}, '역할'), h('th', {}, '표기'), h('th', {}, '세부내역'), h('th', { class: 'num' }, '기본공수'))), tb));
        } else body.appendChild(h('div', { class: 'page-sub' }, '기본 투입계획 없음(견적에서 입력)'));
      } else if (items.length) {
        body.appendChild(h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' },
          ...items.map((it) => h('span', { class: 'tag' }, it.item_code + (Number(it.qty_default) !== 1 ? ` ×${Number(it.qty_default)}` : '')))));
      } else body.appendChild(h('div', { class: 'page-sub' }, '기본 모듈 없음(견적에서 추가)'));

      blockWrap.appendChild(h('div', { class: 'panel', style: 'margin-bottom:10px' },
        h('div', { class: 'panel-head', style: 'display:flex;gap:8px;align-items:center' },
          h('strong', {}, b.name),
          b.recurring ? chip('월정액', 'badge-yellow') : null,
          b.optional ? chip('선택', 'badge-gray') : null,
          h('span', { class: 'page-sub', style: 'margin-left:auto' }, (b.columns || []).join(' · '))),
        body));
    }
    detailCol.appendChild(blockWrap);

    // 견적조건
    if (d.conditions && d.conditions.length) {
      detailCol.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'panel-head' }, `견적조건 (${t.condition_set})`),
        h('div', { class: 'panel-body' }, h('div', { style: 'display:flex;flex-direction:column;gap:5px' },
          ...d.conditions.map((c) => h('div', { class: 'page-sub' }, '-. ' + c))))));
    }
  }

  renderList();
  // 첫 템플릿 자동 선택
  if (templates.length) selectTpl(templates[0].code);
  else detailCol.appendChild(h('div', { class: 'empty' }, '왼쪽에서 템플릿을 선택하세요.'));
}
