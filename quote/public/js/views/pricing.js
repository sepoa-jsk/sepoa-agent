import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, loading, clear, openModal, confirmModal } from '../ui.js';

// 가격정책 = 모듈 단가(sq_modules.base_price) + 직무 단가(sq_labor_roles.base_price)
// 를 직접 편집한다(방향 A). 네고율/variants 는 마스터로 이동했으므로 여기 없다.
// std_mm(표준투입 M/M)은 화면에 노출하지 않되 DB 값은 보존한다(견적 계산용).
const TABS = [
  {
    key: 'modules', tabLabel: '솔루션 모듈 단가', type: 'modules', scoped: true,
    unitLabel: '모듈', priceLabel: '기준단가', addLabel: '＋ 모듈 추가',
    nameLabel: '모듈명', priceFieldLabel: '기준단가 (원)',
  },
  {
    key: 'labor', tabLabel: '직무별 단가', type: 'labor_roles', scoped: false,
    unitLabel: '직무', priceLabel: '표준단가 (1 M/M)', addLabel: '＋ 직무 추가',
    nameLabel: '직무명', priceFieldLabel: '표준단가 1 M/M (원)',
    notice: '직무 단가는 전 솔루션 공통, 1 M/M 기준입니다.',
    injectSolution: 'PROCURE', // 신규 저장 시 solution(NOT NULL) 자동 세팅
  },
];

const S = {
  tabActive: 'padding:7px 16px;border-radius:999px;border:1px solid #0747A6;background:#0747A6;color:#fff;font-weight:600;font-size:13px;cursor:pointer',
  tabIdle: 'padding:7px 16px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--text-sub);font-weight:600;font-size:13px;cursor:pointer',
  ctxBar: 'display:flex;align-items:center;gap:10px;padding:12px 14px;margin-bottom:14px;background:var(--panel);border:0.5px solid var(--line);border-radius:var(--radius)',
  linkBtn: 'background:none;border:none;color:var(--accent);cursor:pointer;font-size:12.5px;font-weight:600;padding:2px 6px',
  thead: 'background:var(--bg)',
  check: 'color:#0747A6;font-weight:700',
  uncheck: 'color:#ccc',
};

export async function renderPricing(root) {
  const master = await store.getMaster();
  const solutions = master.solutions || [];
  const defaultSolution = solutions.find((s) => s.code === 'PROCURE')?.code || solutions[0]?.code || '';

  const state = { tab: 'modules', solution: defaultSolution };
  const current = () => TABS.find((t) => t.key === state.tab);
  const checkCell = (v) => (v ? h('span', { style: S.check }, '✓') : h('span', { style: S.uncheck }, '–'));

  // ── 헤더 ──
  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '가격정책 관리'),
      h('div', { class: 'page-sub' }, '모듈·직무 단가를 관리합니다. 네고율은 마스터에서 관리합니다.')
    )
  ));

  // ── 탭 바 ──
  const tabbar = h('div', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0 14px;flex-wrap:wrap' });
  TABS.forEach((t) => tabbar.appendChild(h('button', {
    dataset: { tab: t.key },
    style: t.key === state.tab ? S.tabActive : S.tabIdle,
    onclick: () => { state.tab = t.key; refresh(); },
  }, t.tabLabel)));
  root.appendChild(tabbar);

  // ── 컨텍스트(솔루션 셀렉트) / 안내문 ──
  const ctxWrap = h('div', {});
  root.appendChild(ctxWrap);

  // ── 테이블 + 하단 추가 버튼 ──
  const thead = h('thead');
  const tbody = h('tbody');
  root.appendChild(h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
    h('table', { class: 'grid master-grid' }, thead, tbody))));
  const addBtn = h('button', { class: 'add-section', style: 'margin-top:12px', onclick: () => editItem(null) }, '＋ 추가');
  root.appendChild(addBtn);

  function syncTabs() {
    tabbar.querySelectorAll('button').forEach((b) => {
      b.setAttribute('style', b.dataset.tab === state.tab ? S.tabActive : S.tabIdle);
    });
  }

  function buildContext() {
    const t = current();
    clear(ctxWrap);
    if (t.scoped) {
      const sel = h('select', { class: 'select', onchange: () => { state.solution = sel.value; load(); } },
        ...solutions.map((s) => h('option', { value: s.code, selected: s.code === state.solution }, s.name || s.code)));
      ctxWrap.appendChild(h('div', { style: S.ctxBar },
        h('span', { style: 'font-size:12.5px;color:var(--text-sub);font-weight:700' }, '솔루션'), sel));
    } else if (t.notice) {
      ctxWrap.appendChild(h('div', { class: 'page-sub', style: 'margin:2px 0 12px' }, t.notice));
    }
  }

  function buildHead() {
    const t = current();
    clear(thead).appendChild(h('tr', { style: S.thead },
      h('th', {}, t.unitLabel),
      h('th', { class: 'num' }, t.priceLabel),
      h('th', { class: 'center' }, '필수'),
      h('th', { class: 'center' }, '사용'),
      h('th', { style: 'text-align:right' }, '관리')
    ));
  }

  function refresh() {
    syncTabs();
    buildContext();
    buildHead();
    addBtn.textContent = current().addLabel;
    load();
  }

  async function load() {
    const t = current();
    clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 5 }, loading())));
    try {
      const { rows } = await api.masterList(t.type, t.scoped ? state.solution : undefined);
      clear(tbody);
      if (!rows || rows.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: 5 }, h('div', { class: 'empty' }, '데이터가 없습니다.'))));
        return;
      }
      for (const row of rows) {
        tbody.appendChild(h('tr', { style: row.active ? null : 'opacity:.5' },
          h('td', {}, h('strong', {}, row.name)),
          h('td', { class: 'num' }, won(row.base_price)),
          h('td', { class: 'center' }, checkCell(row.required)),
          h('td', { class: 'center' }, checkCell(row.active)),
          h('td', { style: 'text-align:right' },
            h('button', { style: S.linkBtn, onclick: () => editItem(row) }, '수정'))
        ));
      }
    } catch (err) {
      clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 5 }, h('div', { class: 'empty' }, err.message))));
    }
  }

  function fld(label, input, full) {
    return h('div', { class: full ? 'field full' : 'field' }, h('label', {}, label), input);
  }

  function editItem(row) {
    const t = current();
    const isNew = !row;
    const f = {
      code: row?.code || '',
      name: row?.name || '',
      base_price: row?.base_price ?? 0,
      required: row ? (row.required ? 1 : 0) : 0,
      active: row ? (row.active ? 1 : 0) : 1,
    };

    const codeInput = h('input', { class: 'input', value: f.code, oninput: (e) => { f.code = e.target.value; },
      style: 'font-family:ui-monospace,SFMono-Regular,Consolas,monospace' });
    const nameInput = h('input', { class: 'input', value: f.name, oninput: (e) => { f.name = e.target.value; } });
    const priceInput = h('input', { class: 'input', type: 'number', step: 'any', value: f.base_price, oninput: (e) => { f.base_price = e.target.value; } });
    const reqCheck = h('input', { type: 'checkbox', checked: !!f.required, onchange: (e) => { f.required = e.target.checked ? 1 : 0; } });
    const actCheck = h('input', { type: 'checkbox', checked: !!f.active, onchange: (e) => { f.active = e.target.checked ? 1 : 0; } });
    const checkRow = (cb, txt) => h('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, cb, h('span', {}, txt));

    const grid = h('div', { class: 'form-grid' });
    if (isNew) grid.appendChild(fld('코드', codeInput));   // 신규만 코드 입력(수정 시 코드 고정)
    grid.appendChild(fld(t.nameLabel, nameInput, !isNew));
    grid.appendChild(fld(t.priceFieldLabel, priceInput));
    grid.appendChild(fld('필수', checkRow(reqCheck, '필수 항목')));
    grid.appendChild(fld('사용', checkRow(actCheck, '사용 (체크 해제 시 중지)')));

    const saveBtn = h('button', { class: 'btn btn-primary' }, isNew ? '추가' : '저장');
    const modal = openModal({
      title: `${t.unitLabel} 단가 ${isNew ? '추가' : '수정'}`,
      body: h('div', {}, grid),
      footer: [h('button', { class: 'btn', onclick: () => modal.close() }, '취소'), saveBtn],
    });

    saveBtn.onclick = async () => {
      if (isNew && !f.code.trim()) return toast('코드를 입력하세요.', 'err');
      if (!f.name.trim()) return toast('이름을 입력하세요.', 'err');
      // std_mm 은 payload 에 넣지 않는다 → 수정 시 기존값 유지, 신규 시 DB 기본값(1.00).
      const payload = {
        name: f.name.trim(),
        base_price: Number(f.base_price) || 0,
        required: f.required ? 1 : 0,
        active: f.active ? 1 : 0,
      };
      if (isNew) {
        payload.code = f.code.trim();
        payload.solution = t.scoped ? state.solution : (t.injectSolution || 'PROCURE');
      }
      saveBtn.disabled = true;
      try {
        if (isNew) await api.masterCreate(t.type, payload);
        else await api.masterUpdate(t.type, row.id, payload);
        toast('저장되었습니다.', 'ok');
        modal.close();
        load();
      } catch (err) { toast(err.message, 'err'); saveBtn.disabled = false; }
    };
  }

  refresh();
}
