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

export function loading(text = '불러오는 중...') {
  return h('div', { class: 'empty' }, h('span', { class: 'spinner' }), h('div', { style: 'margin-top:10px' }, text));
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
