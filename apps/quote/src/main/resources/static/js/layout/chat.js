// AI 도우미(2026-11-04 사용자 요청) — 오른쪽 아래 떠 있는 아이콘. 누르면 대화창이 열린다.
// 대화는 서버 POST /api/chat(Claude CLI). 대화 내용은 이 화면에만 두고 저장하지 않는다(새로고침하면 지워진다)
import { api } from '../api.js';
import { h } from '../ui.js';

const ICON_CHAT = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const ICON_CLOSE = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.6"/></svg>';

let mounted = false;

// 답변의 마크다운 일부만 그린다 — **굵게** · `코드` · '- ' / '1. ' 목록 · '#' 제목. 글자는 먼저 이스케이프한다(답변 속 HTML 은 글자로)
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
function md(text) {
  const out = [];
  let list = null; // 'ul' | 'ol'
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(text).split(/\r?\n/)) {
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const hd = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    close();
    if (hd) out.push(`<div class="q2-chat__h">${inline(hd[1])}</div>`);
    else if (line.trim()) out.push(`<div>${inline(line)}</div>`);
    else out.push('<div class="q2-chat__gap"></div>');
  }
  close();
  return out.join('');
}

export function mountChat(host) {
  if (mounted) return;
  mounted = true;
  const messages = []; // { role: 'user' | 'assistant', text }
  let busy = false;

  const list = h('div', { class: 'q2-chat__list' });
  const input = h('textarea', { class: 'q2-chat__input', rows: 2, placeholder: '질문을 입력하세요', 'aria-label': '질문' });
  const send = h('button', { class: 'ss-btn ss-btn--save q2-chat__send' }, '보내기');
  const panel = h('div', { class: 'q2-chat__panel hidden', role: 'dialog', 'aria-label': 'AI 도우미' },
    h('div', { class: 'q2-chat__head' }, h('span', {}, 'AI 도우미'),
      h('button', { class: 'q2-chat__close', title: '닫기', 'aria-label': '닫기', html: ICON_CLOSE, onclick: () => toggle(false) })),
    list,
    h('div', { class: 'q2-chat__foot' }, input, send));
  const fab = h('button', { class: 'q2-chat__fab', title: 'AI 도우미', 'aria-label': 'AI 도우미', html: ICON_CHAT, onclick: () => toggle() });
  host.append(panel, fab);

  function toggle(open = panel.classList.contains('hidden')) {
    panel.classList.toggle('hidden', !open);
    fab.classList.toggle('is-open', open);
    if (open) input.focus();
  }

  function bubble(role, text) {
    const el = h('div', { class: `q2-chat__msg q2-chat__msg--${role}` }, text);
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    return el;
  }

  async function ask() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    messages.push({ role: 'user', text });
    bubble('user', text);
    const wait = bubble('assistant', '답변을 작성하고 있습니다…');
    wait.classList.add('is-wait');
    try {
      // 지금 화면의 견적(상세 · 수정) — 서버가 그 견적을 자세히 붙여 묻는다
      const cur = (location.hash.match(/^#\/quotes\/(\d+)/) || [])[1];
      const r = await api.chat(messages, cur ? { quote_id: Number(cur) } : null);
      messages.push({ role: 'assistant', text: r.reply });
      wait.innerHTML = md(r.reply);
      wait.classList.remove('is-wait');
      wait.classList.add('is-md');
    } catch (err) {
      messages.pop(); // 실패한 질문은 대화에서 뺀다 — 다시 보내면 새로 묻는다
      wait.textContent = err.message || '답변을 받지 못했습니다.';
      wait.classList.replace('is-wait', 'is-err');
    } finally {
      busy = false;
      send.disabled = false;
      list.scrollTop = list.scrollHeight;
      input.focus();
    }
  }

  send.addEventListener('click', ask);
  // Enter 보내기 · Shift+Enter 줄바꿈(한글 조합 중 Enter 는 무시)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(); }
  });
}
