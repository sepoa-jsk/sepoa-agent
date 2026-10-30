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

export function confirmModal({ title, message, okLabel = '확인', danger = false }) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const ok = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, okLabel);
    const cancel = h('button', { class: 'btn' }, '취소');
    ok.onclick = () => { back.remove(); resolve(true); };
    cancel.onclick = () => { back.remove(); resolve(false); };
    back.onclick = (e) => { if (e.target === back) { back.remove(); resolve(false); } };
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
  back.onclick = (e) => { if (e.target === back) back.remove(); };
  const modal = h('div', { class: 'modal' },
    h('div', { class: 'modal-head' }, title),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, ...footer) : null
  );
  back.appendChild(modal);
  document.body.appendChild(back);
  return { close: () => back.remove(), back };
}

// 견적서 미리보기 창 조절 — [−] 배율 [+] 로 글자 · 표를 키우고 줄이고(50~200%, 배율을 누르면 100%),
// [창 크게] 로 창을 화면 가득 넓힌다. 배율은 이 브라우저에 기억한다. 창 아래 줄(footer)에 넣는다.
const ZOOM_KEY = 'quote2:preview-zoom';
export function previewControls(frame, box) {
  let zoom = 1;
  try { zoom = Number(localStorage.getItem(ZOOM_KEY)) || 1; } catch { /* 기억 못 해도 된다 */ }
  const pct = h('button', { class: 'btn', title: '눌러서 100%', style: 'min-width:58px' });
  const apply = () => {
    pct.textContent = Math.round(zoom * 100) + '%';
    const doc = frame.contentDocument;
    if (doc && doc.documentElement) doc.documentElement.style.zoom = String(zoom);
  };
  const set = (z) => {
    zoom = Math.min(2, Math.max(0.5, Math.round(z * 10) / 10));
    try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* 무시 */ }
    apply();
  };
  frame.addEventListener('load', apply); // 내용을 다시 그리면(srcdoc) 배율을 다시 건다
  pct.onclick = () => set(1);
  // 창 크기 — 높이를 쥔 것이 iframe 자신(height)이거나 감싼 상자(flex)다
  const tall = frame.style.height ? frame : frame.parentElement;
  const orig = { width: box.style.width, height: tall.style.height };
  let wide = false;
  const wideBtn = h('button', { class: 'btn' }, '창 크게');
  wideBtn.onclick = () => {
    wide = !wide;
    box.style.width = wide ? '96vw' : orig.width;
    box.style.maxWidth = wide ? '96vw' : '';
    tall.style.height = wide ? 'calc(100vh - 190px)' : orig.height; // 머리 · 아래 줄이 화면 안에 남게
    wideBtn.textContent = wide ? '창 작게' : '창 크게';
  };
  apply();
  return h('span', { style: 'display:inline-flex;gap:4px;align-items:center;margin-right:auto' },
    h('button', { class: 'btn', title: '축소', onclick: () => set(zoom - 0.1) }, '−'), pct,
    h('button', { class: 'btn', title: '확대', onclick: () => set(zoom + 0.1) }, '+'), wideBtn);
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
  return h('input', {
    ...attrs, type: 'text', inputMode: 'decimal', value: show(cur),
    onfocus: (e) => { if (!e.target.readOnly) e.target.value = cur; },
    onblur: (e) => { e.target.value = show(cur); },
    oninput: (e) => {
      const t = cleanNum(e.target.value);
      if (t !== e.target.value) e.target.value = t;
      cur = t;
      onRaw(t);
    },
  });
}
