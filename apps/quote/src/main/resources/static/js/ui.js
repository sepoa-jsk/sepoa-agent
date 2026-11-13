// UI 헬퍼 — DOM 생성, 포맷, 토스트, 모달
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
export const wonSuffix = (n) => won(n) + '원';

export function fmtDate(d) {
  return d ? String(d).slice(0, 10) : '';
}

export function statusBadge(status) {
  const map = {
    DRAFT: ['작성중', 'badge-gray'],
    SENT: ['발송', 'badge-blue'],
    WON: ['수주', 'badge-green'],
    LOST: ['실주', 'badge-red'],
  };
  const [label, cls] = map[status] || [status, 'badge-gray'];
  return h('span', { class: `badge ${cls}` }, label);
}

let toastTimer;
export function toast(msg, kind = '') {
  const root = document.getElementById('toast-root');
  const t = h('div', { class: `toast ${kind}` }, msg);
  root.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// 바깥(어두운 바탕)을 눌러 닫기 — 누르기 시작한 곳도 바깥일 때만. 창 안에서 글자를 끌어 고르다
// 마우스를 바깥에서 놓으면 click 이 바탕에 떨어져 창이 닫히던 것(2026-11-03 사용자 요청)
function closeOnBackdrop(back, onClose) {
  let downOnBack = false;
  back.addEventListener('mousedown', (e) => { downOnBack = e.target === back; });
  back.addEventListener('click', (e) => { if (e.target === back && downOnBack) onClose(); downOnBack = false; });
}

export function confirmModal({ title, message, okLabel = '확인', danger = false }) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okLabel);
    const cancel = h('button', { class: 'btn' }, '취소');
    ok.onclick = () => { back.remove(); resolve(true); };
    cancel.onclick = () => { back.remove(); resolve(false); };
    closeOnBackdrop(back, () => { back.remove(); resolve(false); });
    back.appendChild(h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, title),
      h('div', { class: 'modal-body' }, message),
      h('div', { class: 'modal-foot' }, cancel, ok)
    ));
    document.body.appendChild(back);
  });
}

export function openModal({ title, body, footer }) {
  const back = h('div', { class: 'modal-back' });
  closeOnBackdrop(back, () => back.remove());
  const modal = h('div', { class: 'modal' },
    h('div', { class: 'modal-head' }, title),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, ...footer) : null
  );
  back.appendChild(modal);
  document.body.appendChild(back);
  return { close: () => back.remove(), back };
}

// 견적서 미리보기 창 버튼 — 창 머리 줄 오른쪽에 [—] 최소화 · [□] 최대화 · [×] 닫기 (2026-10-31, 배율 버튼은 뺐다).
//   최소화: 내용 · 아래 줄을 숨기고 머리 줄만 화면 오른쪽 아래에 둔다(뒤 화면을 보고 누를 수 있게). 다시 누르면 돌아온다.
//   최대화: 창을 화면 가득 넓힌다. 다시 누르면 처음 크기.
const WIN_ICON = {
  min: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 7h10" stroke="currentColor" stroke-width="1.2"/></svg>',
  max: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  restore: '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="4.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 4.5V2.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" stroke-width="1.2"/></svg>',
};
// 창 버튼 [—] 최소화 · [□] 최대화(다시 누르면 이전 크기) — 머리 줄이 따로 있는 창(결재요청 · 날인 신청)용(2026-11-03 사용자 요청).
// box — .modal, parts — 최소화할 때 숨길 것들(머리 줄 빼고). 돌려준 버튼 묶음을 머리 줄에 넣는다
export function windowControls(box, parts) {
  const back = box.parentElement;
  const orig = { width: box.style.width, maxWidth: box.style.maxWidth, maxHeight: box.style.maxHeight, height: box.style.height };
  let max = false;
  let min = false;
  const btn = (title, icon, onclick) => h('button', { type: 'button', title, 'aria-label': title, html: icon, onclick,
    style: 'width:34px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:0;background:none;color:var(--ss-ink-2,#475569);cursor:pointer;border-radius:4px',
    onmouseenter: (e) => { e.currentTarget.style.background = '#EEF2F6'; },
    onmouseleave: (e) => { e.currentTarget.style.background = 'none'; } });
  const size = () => {
    box.style.width = min ? '440px' : max ? 'calc(100vw - 24px)' : orig.width;
    box.style.maxWidth = min || max ? 'none' : orig.maxWidth;
    box.style.maxHeight = max && !min ? 'calc(100vh - 24px)' : orig.maxHeight;
    box.style.height = max && !min ? 'calc(100vh - 24px)' : orig.height;
  };
  const minBtn = btn('최소화', WIN_ICON.min, () => {
    min = !min;
    parts.forEach((el) => { el.style.display = min ? 'none' : ''; });
    // 오른쪽 아래에 머리 줄만 — 뒤 화면을 보고 누를 수 있게
    back.style.background = min ? 'transparent' : '';
    back.style.pointerEvents = min ? 'none' : '';
    back.style.alignItems = min ? 'flex-end' : '';
    back.style.justifyContent = min ? 'flex-end' : '';
    back.style.padding = min ? '0 24px 24px 0' : '';
    box.style.pointerEvents = 'auto';
    minBtn.title = min ? '원래 크기' : '최소화';
    size();
  });
  const maxBtn = btn('최대화', WIN_ICON.max, () => {
    if (min) minBtn.click();
    max = !max;
    maxBtn.innerHTML = max ? WIN_ICON.restore : WIN_ICON.max;
    maxBtn.title = max ? '이전 크기' : '최대화';
    size();
  });
  return h('span', { style: 'display:inline-flex;gap:2px;margin-right:6px' }, minBtn, maxBtn);
}

export function previewControls(frame, box, close) {
  const back = box.parentElement;
  const head = box.querySelector('.modal-head');
  const parts = [box.querySelector('.modal-body'), box.querySelector('.modal-foot')].filter(Boolean);
  // 높이를 쥔 것이 iframe 자신(height)이거나 감싼 상자(flex)다
  const tall = frame.style.height ? frame : frame.parentElement;
  const orig = { width: box.style.width, height: tall.style.height };
  let max = false;
  let min = false;
  const btn = (title, icon, onclick) => h('button', { type: 'button', title, 'aria-label': title, html: icon, onclick,
    style: 'width:40px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:0;background:none;color:var(--ss-ink-2,#475569);cursor:pointer;border-radius:4px',
    onmouseenter: (e) => { e.currentTarget.style.background = title === '닫기' ? '#E81123' : '#EEF2F6'; if (title === '닫기') e.currentTarget.style.color = '#fff'; },
    onmouseleave: (e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--ss-ink-2,#475569)'; } });
  const minBtn = btn('최소화', WIN_ICON.min, () => {
    min = !min;
    parts.forEach((el) => { el.style.display = min ? 'none' : ''; });
    back.style.background = min ? 'transparent' : '';
    back.style.pointerEvents = min ? 'none' : '';
    back.style.alignItems = min ? 'flex-end' : '';
    back.style.justifyContent = min ? 'flex-end' : '';
    back.style.padding = min ? '0 24px 24px 0' : '';
    box.style.pointerEvents = 'auto';
    box.style.width = min ? '420px' : (max ? '96vw' : orig.width);
    minBtn.title = min ? '원래 크기' : '최소화';
  });
  const maxBtn = btn('최대화', WIN_ICON.max, () => {
    if (min) minBtn.click();
    max = !max;
    box.style.width = max ? '96vw' : orig.width;
    box.style.maxWidth = max ? '96vw' : '';
    tall.style.height = max ? 'calc(100vh - 190px)' : orig.height; // 머리 · 아래 줄이 화면 안에 남게
    maxBtn.innerHTML = max ? WIN_ICON.restore : WIN_ICON.max;
    maxBtn.title = max ? '이전 크기' : '최대화';
  });
  head.style.display = 'flex';
  head.style.alignItems = 'center';
  head.style.paddingRight = '8px';
  head.appendChild(h('span', { style: 'display:inline-flex;gap:2px;margin-left:auto' }, minBtn, maxBtn, btn('닫기', WIN_ICON.close, close)));
}

export function loading(text = '불러오는 중...') {
  return h('div', { class: 'empty' }, h('span', { class: 'spinner' }), h('div', { style: 'margin-top:10px' }, text));
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// 그리드 칸 너비 조절 — 머리 칸 오른쪽 끝을 끌어 늘이고 줄인다. 두 번 누르면 처음 너비로.
// table 에 colgroup 이 있고 col 수와 첫 머리행 th 수가 같아야 한다. data-fixed 가 붙은 th 는 조절하지 않는다.
// storeKey 를 주면 이 브라우저에 너비를 기억한다(저장이 막혀 있어도 조절은 된다).
export function resizableColumns(table, storeKey) {
  const cols = [...table.querySelectorAll('colgroup > col')];
  const ths = [...table.querySelectorAll('thead tr:first-child > th')];
  if (!cols.length || cols.length !== ths.length) return;
  const initCols = cols.map((c) => c.style.width);
  const initTable = { width: table.style.width, minWidth: table.style.minWidth };
  const MIN = 40;

  const apply = (w) => {
    cols.forEach((c, i) => { c.style.width = w[i] + 'px'; });
    table.style.width = w.reduce((a, b) => a + b, 0) + 'px';
    table.style.minWidth = '';
    table.classList.add('is-resized'); // 상자보다 좁아져도 표 오른쪽 끝에 선이 남게
  };
  const measure = () => ths.map((t) => Math.round(t.getBoundingClientRect().width));

  if (storeKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
      if (Array.isArray(saved) && saved.length === cols.length) apply(saved);
    } catch { /* 기억 못 해도 조절은 된다 */ }
  }

  ths.forEach((th, i) => {
    if (th.dataset.fixed != null) return;
    const grip = document.createElement('span');
    grip.className = 'ss-colgrip';
    grip.title = '끌어서 너비 조절 · 두 번 누르면 처음 너비';
    grip.addEventListener('click', (e) => e.stopPropagation()); // 머리 칸 정렬 클릭과 겹치지 않게
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const w = measure();
      apply(w);
      const startX = e.clientX, start = w[i];
      const move = (ev) => { w[i] = Math.max(MIN, start + ev.clientX - startX); apply(w); };
      const up = (ev) => {
        move(ev); // 움직임 없이 바로 놓아도 놓은 자리까지 반영
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('is-colresizing');
        if (storeKey) { try { localStorage.setItem(storeKey, JSON.stringify(w)); } catch { /* 무시 */ } }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.classList.add('is-colresizing');
    });
    grip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      cols.forEach((c, j) => { c.style.width = initCols[j]; });
      Object.assign(table.style, initTable);
      table.classList.remove('is-resized');
      if (storeKey) { try { localStorage.removeItem(storeKey); } catch { /* 무시 */ } }
    });
    th.appendChild(grip);
  });
}

// 숫자 칸 — 보일 때는 정수부에 3자리 콤마, 누르면(포커스) 콤마 없는 값으로 고친다.
// 소수부는 입력·저장된 그대로 둔다(0.20 → 0.20). 숫자만 받는다 — 소수점은 하나, 빼기는 맨 앞에만.
// 입력하는 동안은 콤마가 없고, 커서가 다른 칸으로 가면(blur) 콤마를 붙인다.
export const comma = (v) => {
  if (v == null || v === '') return '';
  const m = String(v).match(/^(-?)(\d+)(.*)$/);
  return m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + m[3] : String(v);
};
// 숫자 · 소수점 하나 · 맨 앞 빼기만 남긴다
export const cleanNum = (v) => {
  const s = String(v ?? '').replace(/[^\d.-]/g, '');
  const neg = s.startsWith('-') ? '-' : '';
  const [int, ...dec] = s.replace(/-/g, '').split('.');
  return neg + int + (dec.length ? '.' + dec.join('') : '');
};
// plain 이면(연도 등) 콤마를 넣지 않는다
export function numInput(raw, onRaw, attrs, plain = false) {
  let cur = raw == null ? '' : String(raw);
  const show = (v) => (plain ? v : comma(v));
  // Ctrl+Z 되돌리기 — 포커스 · 콤마 때문에 값을 코드로 바꿔 넣어서 브라우저 기본 되돌리기가 지워진다.
  // 그래서 칸마다 입력 이력을 따로 두고 Ctrl+Z(Mac 은 Cmd+Z)로 한 단계씩 되돌린다(2026-11-03 사용자 요청)
  const hist = [cur];
  let undoing = false;
  return h('input', {
    ...attrs, type: 'text', inputMode: 'decimal', value: show(cur),
    // 누르면 값 전체를 골라 둔다 — 그대로 치면 원래 값(예: 1)을 덮어쓴다(2026-11-02 사용자 요청: '1' 뒤에 붙어 101 이 되던 것)
    onfocus: (e) => { if (e.target.readOnly) return; e.target.value = cur; const el = e.target; setTimeout(() => { if (document.activeElement === el) el.select(); }, 0); },
    onblur: (e) => { e.target.value = show(cur); },
    onkeydown: (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || e.target.readOnly) return;
      e.preventDefault();
      if (hist.length < 2) return;
      hist.pop();
      undoing = true;
      e.target.value = hist[hist.length - 1];
      e.target.dispatchEvent(new Event('input', { bubbles: true })); // 다른 input 리스너도 같은 값을 받게
      undoing = false;
      e.target.select();
    },
    oninput: (e) => {
      const t = cleanNum(e.target.value);
      if (t !== e.target.value) e.target.value = t;
      cur = t;
      if (!undoing && t !== hist[hist.length - 1]) { hist.push(t); if (hist.length > 50) hist.shift(); }
      onRaw(t);
    },
  });
}

// 여러 개 체크 드롭다운 — 칸 바로 아래에 체크 목록. 체크하면 바로 onChange('A,B' | null), 바깥을 누르거나 Esc 로 닫는다.
// 표가 상자 안에서 스크롤되므로 목록은 화면 위(body)에 띄운다. options 순서대로 이어 담는다(고객사 사용 솔루션 · 사용자 담당 솔루션)
let openCheckDrop = null;
export function checkDropdown(anchor, options, value, onChange) {
  if (openCheckDrop) { const same = openCheckDrop.anchor === anchor; openCheckDrop.close(); if (same) return; }
  const cur = new Set(String(value || '').split(',').map((s) => s.trim()).filter(Boolean));
  const boxes = options.map(([code]) => h('input', { type: 'checkbox', checked: cur.has(code), value: code,
    onchange: () => onChange(boxes.filter((x) => x.checked).map((x) => x.value).join(',') || null) }));
  const r = anchor.getBoundingClientRect();
  const box = h('div', { style: `position:fixed;top:${r.bottom + 2}px;left:${r.left}px;min-width:${Math.max(r.width, 180)}px;z-index:1000;`
    + 'background:#fff;border:1px solid var(--ss-bd, #D0D7E2);box-shadow:0 6px 18px rgba(0,0,0,.15);padding:4px 0' },
  ...boxes.map((cb, i) => h('label', { style: 'display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap' },
    cb, options[i][1])));
  document.body.appendChild(box);
  const outside = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    box.remove(); openCheckDrop = null;
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', esc);
    window.removeEventListener('scroll', close, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true); // 표를 스크롤하면 닫는다(목록이 칸에서 떨어지지 않게)
  }, 0);
  openCheckDrop = { anchor, close };
}

// 편집 그리드 키보드 이동(2026-11-04 사용자 요청) — 표(.ss-grid · .grid) 안 입력 칸에서
//   Tab / Shift+Tab: 다음 · 앞 입력 칸(체크박스 · 버튼은 건너뛴다, 줄 끝이면 다음 줄로)
//   ← →: 글자 맨 앞 · 맨 끝에서 옆 칸으로 / ↑ ↓: 위 · 아래 줄의 같은 자리 칸으로(여러 줄 글은 첫 줄 · 끝 줄에서만, 선택 상자는 ↑ ↓ 로 값을 고른다)
const GRID_EDIT = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])';
let gridKeysOn = false;
export function enableGridKeys() {
  if (gridKeysOn) return;
  gridKeysOn = true;
  const visible = (el) => el.offsetParent !== null;
  const cellsOf = (root) => [...root.querySelectorAll(GRID_EDIT)].filter((x) => x.closest('td') && visible(x));
  const go = (to) => {
    to.focus();
    if (to.tagName === 'INPUT' && typeof to.select === 'function') to.select();
    else if (to.tagName === 'TEXTAREA') { const n = to.value.length; to.setSelectionRange(n, n); }
  };
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const el = e.target;
    if (!(el instanceof Element) || !el.matches(GRID_EDIT)) return;
    const td = el.closest('td');
    const table = td && td.closest('table.ss-grid, table.grid');
    if (!table) return;
    const k = e.key;
    if (k === 'Tab') {
      const all = cellsOf(table.tBodies[0] || table);
      const i = all.indexOf(el);
      const to = all[i + (e.shiftKey ? -1 : 1)];
      if (i < 0 || !to) return; // 표 끝 — 브라우저 기본 이동
      e.preventDefault();
      go(to);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k) || e.shiftKey) return;
    const sel = el.tagName === 'SELECT';
    if (sel && (k === 'ArrowUp' || k === 'ArrowDown')) return;
    const text = !sel && typeof el.selectionStart === 'number';
    if (text) {
      const v = el.value || '';
      let s = el.selectionStart, en = el.selectionEnd;
      // 칸으로 옮겨 오면 글자 전체가 골라진다 — 전체 선택이면 바로 옆 · 위아래로 옮긴다(일부만 고른 중이면 그대로)
      if (s !== en) { if (s === 0 && en === v.length) { s = k === 'ArrowLeft' || k === 'ArrowUp' ? 0 : v.length; en = s; } else return; }
      if (k === 'ArrowLeft' && s > 0) return;
      if (k === 'ArrowRight' && en < v.length) return;
      if (el.tagName === 'TEXTAREA' && k === 'ArrowUp' && v.slice(0, s).includes('\n')) return;
      if (el.tagName === 'TEXTAREA' && k === 'ArrowDown' && v.slice(en).includes('\n')) return;
    }
    const tr = td.parentElement;
    let to = null;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const row = cellsOf(tr);
      to = row[row.indexOf(el) + (k === 'ArrowLeft' ? -1 : 1)] || null;
    } else {
      // 같은 자리(칸 가운데 가로 위치)에 입력 칸이 있는 위 · 아래 줄 — 합친 칸(rowspan)이 있어도 맞는다
      const rows = [...(tr.parentElement ? tr.parentElement.rows : [])];
      const x = td.getBoundingClientRect().left + td.getBoundingClientRect().width / 2;
      const step = k === 'ArrowUp' ? -1 : 1;
      for (let i = rows.indexOf(tr) + step; i >= 0 && i < rows.length && !to; i += step) {
        const c = [...rows[i].cells].find((cell) => { const r = cell.getBoundingClientRect(); return x >= r.left && x <= r.right; });
        to = c ? cellsOf(c)[0] || null : null;
      }
    }
    if (!to) return;
    e.preventDefault();
    go(to);
  });
}
