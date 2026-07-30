import { api } from '../api.js';
import { store } from '../app.js';
import { h, toast, loading, clear } from '../ui.js';

// 견적서 템플릿 관리(ADMIN) — 솔루션별 목록 + 상세(블록/기본모듈/인건비/조건).
// 5-B 완료 기준: 솔루션별 BUILD 템플릿 목록 노출, 상세에서 블록·기본모듈·인건비 확인.
const DEP = {
  ONPREM_LUMP: '구축형 일시불', ONPREM_INSTALL: '구축형 분납',
  SAAS: 'SaaS', PCLOUD: 'Private Cloud',
  ONPREM: '구축형(On-prem)', INSTALL: '분납', // 구 코드 하위호환
};
const depName = (c) => DEP[c] || c;
const solName = (c) => (store.solutionName ? store.solutionName(c) : c) || c;
const won = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'));

export async function renderTemplates(root) {
  root.appendChild(loading());
  let templates = [];
  try { ({ templates } = await api.templates({ quote_type: 'BUILD' })); }
  catch (err) { clear(root).appendChild(h('div', { class: 'empty' }, err.message)); return; }
  clear(root);

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '견적서 템플릿'),
      h('div', { class: 'page-sub' }, '견적유형 BUILD — 솔루션×구축형태별 프리셋. 견적 작성에서 템플릿을 고르면 블록·기본모듈·인건비가 자동 편입됩니다. (공통 블록/조건/임금단가는 참조만) 유지보수·추가개발(MAINT/ADDDEV)은 Phase 6.'))));

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
          h('div', { class: 'page-sub', style: 'margin-top:2px' }, `${depName(t.deployment)}${t.brand ? ' · ' + t.brand : ''}`),
          h('div', { class: 'page-sub', style: 'margin-top:3px;font-size:11px' }, (t.block_codes || []).join(' + '))));
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
            chip(t.quote_type || 'BUILD', 'badge-navy'),
            t.has_labor_plan ? chip('인력투입계획', 'badge-yellow') : null,
            t.include_maintenance ? chip('유지보수 포함', 'badge-green') : null,
            t.include_component ? chip('컴포넌트 포함', 'badge-green') : null,
            t.active ? chip('활성', 'badge-blue') : chip('비활성', 'badge-gray'))),
        h('div', { class: 'page-sub', style: 'margin-top:6px' },
          `${solName(t.solution)} · ${depName(t.deployment)}${t.brand ? ' · ' + t.brand : ''}${t.condition_set ? ' · 조건: ' + t.condition_set : ''}`))));

    // 기본모듈이 가격마스터에 없으면 견적 작성 시 단가가 안 잡힌다 — 먼저 알린다
    if (d.unregistered && d.unregistered.length) {
      detailCol.appendChild(h('div', { class: 'panel', style: 'margin-bottom:12px;border-color:#e0a800' },
        h('div', { class: 'panel-body' },
          h('div', { style: 'font-weight:700;margin-bottom:4px' }, `가격마스터 미등록 모듈 ${d.unregistered.length}건`),
          h('div', { class: 'page-sub' }, '아래 코드는 가격정책(sq_price_items)에 없어 기준단가가 조회되지 않습니다. 모듈 마스터 등록 후 재확인하세요.'),
          h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' },
            ...d.unregistered.map((c) => h('span', { class: 'badge badge-yellow' }, c))))));
    }

    // 블록 구성
    const blockWrap = h('div', {});
    for (const b of d.blocks) {
      const items = (d.items && d.items[b.block_code]) || [];
      const labor = (d.laborByBlock && d.laborByBlock[b.block_code]) || [];
      const body = h('div', { style: 'padding:10px 14px' });

      if (b.block_code === 'SUMMARY') {
        body.appendChild(h('div', { class: 'page-sub' }, b.calc || '소계합 → 특별DC → 십만단위 절사 → VAT 별도'));
      } else {
        if (items.length) {
          const tb = h('tbody');
          for (const it of items) tb.appendChild(h('tr', {},
            h('td', {}, h('span', { class: 'tag' }, it.item_code)),
            h('td', {}, it.registered ? (it.item_name || '') : h('span', { class: 'badge badge-yellow' }, '가격마스터 미등록')),
            h('td', { class: 'num' }, it.registered ? won(it.base_price) + (it.recurring ? ' /월' : '') : '-'),
            h('td', { class: 'num' }, '×' + Number(it.qty_default))));
          body.appendChild(h('table', { class: 'grid master-grid' },
            h('thead', {}, h('tr', {}, h('th', {}, '모듈코드'), h('th', {}, '모듈명'),
              h('th', { class: 'num' }, '기준단가'), h('th', { class: 'num' }, '기본수량'))), tb));
        }
        if (labor.length) {
          const tb = h('tbody');
          for (const l of labor) tb.appendChild(h('tr', {},
            h('td', {}, h('span', { class: 'tag' }, l.role_code)),
            h('td', {}, (l.role_label || l.role_name || '') + (l.grade ? ` (${l.grade})` : '')),
            h('td', { class: 'page-sub' }, l.task || ''),
            h('td', { class: 'num' }, Number(l.mm_default) + ' MM'),
            h('td', { class: 'num' }, l.base_price == null
              ? h('span', { class: 'badge badge-yellow' }, '임금단가 없음') : won(l.base_price))));
          body.appendChild(h('div', { style: items.length ? 'margin-top:10px' : '' },
            items.length ? h('div', { class: 'page-sub', style: 'margin-bottom:4px' }, '셋업 산정 근거(공수)') : null,
            h('table', { class: 'grid master-grid' },
              h('thead', {}, h('tr', {}, h('th', {}, '역할'), h('th', {}, '표기(등급)'), h('th', {}, '세부내역'),
                h('th', { class: 'num' }, '기본공수'), h('th', { class: 'num' }, '기준단가(적용연도)'))), tb)));
        }
        if (!items.length && !labor.length) {
          body.appendChild(h('div', { class: 'page-sub' },
            b.block_code === 'LABOR' ? '기본 투입계획 없음(견적에서 입력)' : '기본 모듈 없음(견적에서 추가)'));
        }
      }

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
