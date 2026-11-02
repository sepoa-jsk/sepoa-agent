// 템플릿 불러오기 창 — 견적 작성 1단계 [템플릿 불러오기] 로 연다. 견적서 불러오기 창(quote-picker.js)과 같은 구조(2026-10-30 사용자 요청).
// 왼쪽: 고른 솔루션 · 구축형태의 템플릿 목록(코드 · 이름 검색) / 오른쪽: 고른 템플릿에 들어 있는 내용.
// 오른쪽은 템플릿 내용만 — 블록별 구분 · 모듈 · 세부기능 · 인원·건수 · 수량 · 단위, 인력, 결제 방안 포함 여부, 견적조건.
// 금액은 보이지 않는다(2026-10-30 사용자 요청) — 단가 · 금액은 템플릿으로 시작한 뒤 3단계(구성)에서 가격정책으로 채운다.
// [이 템플릿으로 시작] 을 누르면 onStart(tpl) — 상태 반영은 1단계(step2-type.js)가 한다.
// [미리보기] — 고른 템플릿을 견적서 완성본(기본값 · 가격정책 기준단가)으로 큰 창에 그린다(2026-10-31 사용자 요청).
import { api as http } from '../../../api.js';
import { h, clear, won, openModal, previewControls } from '../../../ui.js';
import { appliedPatch, bandLine, bandUnitOf, recalcBlocks, toBlocksPayload } from './step3-config.js';

// 템플릿 종류(서버가 내용으로 정한다) — 구조만: 블록 틀만 있고 모듈 · 인력은 비어 있다 / 데이터 포함: 기본 모듈 · 인력까지 채워져 있다
export const KIND_LABEL = { STRUCT: '구조만', DATA: '데이터 포함' };
export const kindBadge = (kind) => h('span', { class: 'badge ' + (kind === 'STRUCT' ? 'badge-yellow' : 'badge-blue'), style: 'font-size:11px' }, KIND_LABEL[kind] || '');

const applyCache = {}; // code → apply-template 응답

export function openTemplatePicker({ state, list: all, currentCode, title, onStart }) {
  let picked = null;           // 고른 템플릿
  let pickedData = null;       // 고른 템플릿의 apply-template 응답(미리보기용)
  let seq = 0;                 // 늦게 온 응답이 새 선택을 덮지 않게

  const search = h('input', { class: 'ss-input', placeholder: '템플릿 코드 · 이름 검색', style: 'flex:1;min-width:0', oninput: () => paintList() });
  const list = h('div', { style: 'flex:1;overflow:auto;border-top:1px solid #E7EAF0' });
  const info = h('div', { style: 'font-size:12px;color:var(--ss-ink-3);min-height:18px' }, '왼쪽에서 템플릿을 고르세요.');
  const view = h('div', { style: 'flex:1;overflow:auto;border:1px solid #E7EAF0;background:#fff;padding:10px 12px' });
  const okBtn = h('button', { class: 'btn btn-primary', disabled: true }, '이 템플릿으로 시작');
  const previewBtn = h('button', { class: 'btn', disabled: true, onclick: () => { if (pickedData) previewTemplate(pickedData); } }, '미리보기');

  const body = h('div', { style: 'display:grid;grid-template-columns:360px 1fr;gap:12px;height:70vh' },
    h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' },
      h('div', { style: 'display:flex;gap:6px' }, search), list),
    h('div', { style: 'display:flex;flex-direction:column;gap:6px;min-height:0' }, info, view));

  const m = openModal({
    title: title || '템플릿 불러오기',
    body,
    footer: [h('span', { style: 'margin-right:auto;font-size:12px;color:var(--ss-ink-3)' },
      '템플릿의 구성 · 기본 수량 · 인력 · 견적조건으로 시작합니다. 지금 입력한 기본정보(수신처 등)는 그대로 둡니다.'),
    previewBtn, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), okBtn],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '1180px';
  box.querySelector('.modal-body').style.padding = '12px';
  okBtn.onclick = () => { if (picked) { m.close(); onStart(picked); } };

  function paintList() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((t) => !q || t.code.toLowerCase().includes(q) || String(t.name).toLowerCase().includes(q));
    if (!rows.length) { list.appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, '템플릿이 없습니다.')); return; }
    for (const t of rows) {
      const on = picked && picked.code === t.code;
      list.appendChild(h('div', {
        style: `padding:8px 10px;border-bottom:1px solid #EEF1F5;cursor:pointer;${on ? 'background:#EEF4FF;box-shadow:inset 3px 0 0 var(--ss-primary)' : ''}`,
        onclick: () => select(t),
      },
      h('div', { style: 'display:flex;gap:8px;align-items:baseline' },
        h('span', { style: 'color:var(--ss-emphasis);font-size:12px;font-weight:500' }, t.code),
        h('span', { style: 'font-size:11px;color:var(--ss-ink-3)' }, [KIND_LABEL[t.kind], t.code === currentCode ? '지금 적용 중' : ''].filter(Boolean).join(' · '))),
      h('div', { style: 'font-size:13px;color:var(--ss-ink-2);margin-top:2px' }, t.name),
      h('div', { style: 'font-size:11px;color:var(--ss-ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' },
        [(t.block_codes || []).join(' + ') || '블록 미정', t.brand, t.has_labor_plan ? '인력투입계획' : ''].filter(Boolean).join(' · '))));
    }
  }

  async function select(t) {
    const my = ++seq;
    picked = null; pickedData = null; okBtn.disabled = true; previewBtn.disabled = true;
    paintList();
    info.textContent = `${t.name} — 그리는 중...`;
    try {
      const d = applyCache[t.code] || (applyCache[t.code] = await http.applyTemplate(t.code));
      if (my !== seq) return;
      paintContent(d);
      const blocks = appliedPatch(d).blocks;
      const nItems = blocks.reduce((a, b) => a + (b.items || []).length, 0);
      const nLabor = blocks.reduce((a, b) => a + (b.labor || []).length, 0);
      info.textContent = `${t.code} · ${KIND_LABEL[t.kind] || ''} · 블록 ${blocks.length}개 · 모듈 ${nItems}개${nLabor ? ` · 인력 ${nLabor}명` : ''}`;
      picked = t;
      pickedData = d;
      okBtn.disabled = false;
      previewBtn.disabled = false;
      paintList();
    } catch (err) {
      if (my === seq) info.textContent = err.message;
    }
  }

  // 템플릿 내용 — 블록마다 표 하나(견적 작성 3단계와 같은 칸, 금액 칸 없음)
  function paintContent(d) {
    clear(view);
    const s = appliedPatch(d);
    const saas = d.template && d.template.deployment === 'SAAS';
    const table = (cols, rows) => h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((a, [, w]) => a + w, 0)}px;min-width:100%` },
      h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, ...cols.map(([c]) => h('th', {}, c)))),
      h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty', style: 'height:40px' }, '비어 있음 — 견적 작성에서 넣습니다'))])));
    const cell = (v, align = 'left') => h('td', { style: `text-align:${align};white-space:pre-line` }, v == null ? '' : String(v));
    const section = (title, ...kids) => view.appendChild(h('div', { style: 'margin-bottom:14px' },
      h('div', { style: 'font-size:13px;font-weight:600;color:var(--ss-ink-1);margin-bottom:6px' }, title), ...kids));
    s.blocks.forEach((b, i) => {
      const items = b.items || [];
      const labor = b.labor || [];
      const kids = [];
      if (b.block_code !== 'LABOR' || items.length) {
        kids.push(table([['구분', 70], ['모듈', 170], ['세부기능', 300], ['인원·건수', 100], ['수량', 60], ['단위', 70]],
          items.map((it) => h('tr', {},
            cell(it.category, 'center'),
            // 서비스 이용료 행(인원·건수 있음)은 가격정책 용어 — 어느 서비스인지는 1단계에서 고른 것으로 맞춰진다
            cell(saas && it.band ? '서비스 이용료' : it.name),
            cell(it.spec),
            cell(bandLine(it) ? bandLine(it).slice(1, -4) : '', 'center'),
            cell(it.qty, 'right'),
            cell(bandUnitOf(it.band) || it.unit, 'center')))));
      }
      if (labor.length) {
        kids.push(h('div', { style: 'margin-top:6px' }, table([['역할', 120], ['직무', 150], ['등급', 70], ['업무', 300], ['공수 (MM)', 80]],
          labor.map((l) => h('tr', {}, cell(l.role_label), cell(l.role_name), cell(l.grade, 'center'), cell(l.task), cell(l.mm, 'right'))))));
      }
      section(`▣ ${i + 1}. ${b.name}${b.recurring ? ' (월정액)' : ''}`, ...kids);
    });
    if (d.template && d.template.has_pay_plan) {
      section('▣ 결제 방안', h('div', { style: 'font-size:12.5px;color:var(--ss-ink-2)' }, '견적서에 결제 방안 표가 들어갑니다. 비율 · 문구는 3단계(구성)에서 고칩니다.'));
    }
    const conds = (d.conditions || []).filter(Boolean);
    if (conds.length) {
      section('▣ 견적조건', h('ol', { style: 'margin:0;padding-left:20px;font-size:12.5px;color:var(--ss-ink-2);line-height:1.7' },
        ...conds.map((c) => h('li', {}, String(c)))));
    }
  }

  // 견적서 완성본 — 견적 작성 [미리보기] 와 같은 렌더러(POST /api/quotes/preview). 수신처 등은 빈 칸.
  async function previewTemplate(d) {
    const s = appliedPatch(d);
    recalcBlocks(s); // 행 금액(amount)을 채운다 — 서버는 보낸 금액을 그대로 합산한다
    const t = d.template || {};
    const frame = h('iframe', { style: 'width:100%;height:72vh;border:1px solid #E7EAF0;background:#fff' });
    const state = h('span', { style: 'font-size:12px;color:var(--text-3);margin-right:8px' }, '그리는 중...');
    const printBtn = h('button', { class: 'btn', disabled: true, onclick: () => frame.contentWindow.print() }, '인쇄 · PDF 저장');
    const pm = openModal({
      title: `견적서 미리보기 — ${t.name || t.code || ''}${t.code ? ` (${t.code})` : ''}`,
      body: frame,
      footer: [state, printBtn, h('button', { class: 'btn btn-primary', onclick: () => pm.close() }, '닫기')],
    });
    const pbox = pm.back.querySelector('.modal');
    pbox.style.width = '880px';
    pbox.querySelector('.modal-body').style.padding = '12px';
    previewControls(frame, pbox, () => pm.close());
    try {
      const r = await http.previewQuote({
        blocks: toBlocksPayload(s),
        header: { blank: true, template_code: t.code || null, solution: t.solution, brand: t.brand || null,
          deployment: t.deployment, quote_type: t.quote_type || 'BUILD', pay_plan: t.has_pay_plan ? 1 : 0,
          conditions: s.conds_on ? s.conds.map((c) => ({ text: c.text, auto: false, edited: true })) : [] },
        round_unit: s.round_unit,
      });
      frame.srcdoc = r.html;
      const c = r.calc || {};
      state.textContent = `기본값 기준 · 일시불 ${won(c.onetime_total)}원${c.monthly_total ? ` / 월 ${won(c.monthly_total)}원` : ''}`;
      printBtn.disabled = false;
    } catch (err) {
      state.textContent = '';
      frame.replaceWith(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
    }
  }

  paintList();
  // 지금 적용 중인 템플릿(없으면 하나뿐일 때 그것)을 먼저 골라 미리보기를 띄운다
  const first = all.find((t) => t.code === currentCode) || (all.length === 1 ? all[0] : null);
  if (first) select(first);
}
