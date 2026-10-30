// STEP③ 구성 — 좌 입력 / 우 실시간 미리보기.
// quote-block.js 의 블록·모듈 편집과 엑셀 붙여넣기를 그대로 이관했다.
// 계산 로직은 바꾸지 않는다: 서버 calcQuoteBlocks 와 같은 순서를 그대로 옮겨 왔다.
//   블록소계 합 → 특별DC → 절사(십만) → VAT. 일시불/월(recurring) 분리.
import { api as http } from '../../../api.js';
import { h, won, toast, openModal, confirmModal, numInput } from '../../../ui.js';
import { pickItems, pickRole, itemRow } from '../pickers.js';

// 블록 정의(sq_blocks) — 블록 추가 목록. 한 번 받아 둔다
let blockDefsCache = null;
async function blockDefs() {
  if (!blockDefsCache) {
    try { blockDefsCache = ((await http.blocks()).blocks || []).sort((a, b) => a.sort - b.sort); } catch { blockDefsCache = []; }
  }
  return blockDefsCache;
}
// 견적 구축형태 → 가격정책 품목 구축형태(품목 선택 팝업의 첫 거르기). 구축형은 공통·일시불이 섞여 있어 전체로 연다
const ITEM_DEP = { SAAS: 'SAAS', PCLOUD: 'PCLOUD' };

const num = (v) => Number(v) || 0;

// ── 계산 (서버 엔진과 동일 순서) ────────────────────────────
export function recalcBlocks(state) {
  let onetime = 0, monthly = 0;
  const laborErrors = [];
  for (const b of state.blocks) {
    let sub = 0;
    // 서버 calcBlock 과 같은 판정: 금액이 되는 인건비는 LABOR 블록뿐이다.
    // 비-LABOR 블록의 인건비 행은 인력투입계획 부록용 공수 배분이고, 금액은 이미
    // 같은 블록의 셋업 품목에 들어 있다(3.7MM × 12,000,000 = 44,400,000).
    // 여기서 합산하면 화면 미리보기만 서버 PDF 보다 커진다.
    const isLabor = b.block_code === 'LABOR';
    for (const it of b.items || []) { it.amount = Math.round(num(it.proposed_price) * num(it.qty)); sub += it.amount; }
    for (const l of b.labor || []) {
      if (isLabor) {
        l.amount = Math.round(num(l.proposed_price) * num(l.mm));
        sub += l.amount;
      }
      // 월별 배분 Σ 검증은 블록 종류와 무관하게 돈다(부록 데이터도 합이 맞아야 한다).
      const alloc = l.month_alloc || {};
      const keys = Object.keys(alloc);
      if (keys.length) {
        const s = keys.reduce((a, k) => a + num(alloc[k]), 0);
        if (Math.abs(s - num(l.mm)) > 0.001) {
          laborErrors.push(`${l.role_label || l.role_code}: 배분 ${s} ≠ 공수 ${num(l.mm)}MM`);
        }
      }
    }
    b._sub = sub;
    if (b.recurring) monthly += sub; else onetime += sub;
  }
  const dc = state.discount || { mode: 'TARGET', value: 0 };
  const dcAmt = computeDc(dc, onetime);
  const afterDc = onetime - dcAmt;
  const unit = num(state.round_unit ?? 100000);
  const final = unit > 0 ? Math.floor(afterDc / unit) * unit : Math.round(afterDc);
  // 월 사용료에도 특별DC 가 별도로 걸린다(실측 하겐다즈 SaaS: 월 300,000 → 100,000).
  // 월 금액은 절사하지 않는다 — 밴드 금액(150,000 등)이 깨진다.
  const mdcAmt = computeDc(state.monthly_discount, monthly);
  const monthlyFinal = monthly - mdcAmt;
  return { onetime, monthly, mdcAmt, monthlyFinal, dcAmt, trunc: afterDc - final, final,
    vat: Math.round(final * 0.1), laborErrors };
}

export function computeDc(dc, base) {
  if (!dc || !dc.mode) return 0;
  const raw = dc.value;
  if (raw === null || raw === undefined || raw === '') return 0;
  const v = num(raw);
  if (dc.mode === 'TARGET') return Math.max(0, base - Math.round(v));
  if (dc.mode === 'RATE') return Math.round(base * v / 100);
  if (dc.mode === 'AMOUNT') return Math.round(v);
  return 0;
}

// 서버로 보낼 blocks 페이로드 (저장·미리보기 공용)
//
// ⚠️ 빈 배열을 보내면 안 된다. 서버 calcBlock 이
//      isLabor = block_code === 'LABOR' || Array.isArray(block.labor)
//    로 판정하므로, items 만 있는 블록에 labor: [] 를 함께 보내면 인건비 블록으로
//    오인해 소계가 0 이 된다. 값이 있는 쪽만 실어 보낸다.
export function toBlocksPayload(state) {
  return state.blocks.map((b) => {
    const out = { block_code: b.block_code, name: b.name, recurring: b.recurring ? 1 : 0 };
    const items = mapItems(b);
    const labor = mapLabor(b);
    if (items.length) out.items = items;
    if (labor.length) out.labor = labor;
    if (!items.length && !labor.length) out.items = [];
    return out;
  });
}

function mapItems(b) {
  return (b.items || []).map((it) => ({
    item_code: it.item_code || null, category: it.category || null, name: it.name,
    spec: it.spec || null, qty: num(it.qty), unit: it.unit || null,
    base_price: it.base_price, proposed_price: num(it.proposed_price), amount: it.amount,
  }));
}

// 비-LABOR 블록(SETUP 등)의 labor 행은 **인력투입계획 부록용 공수 배분**이다.
// 금액은 이미 같은 블록의 items 에 들어 있으므로(예: 3.7MM × 12,000,000 = 44,400,000),
// 단가·금액을 함께 실어 보내면 이중 계상의 씨앗이 된다. mm 과 month_alloc 만 보낸다.
function mapLabor(b) {
  const isLabor = b.block_code === 'LABOR';
  return (b.labor || []).map((l) => {
    const out = {
      role_code: l.role_code, role_name: l.role_name || null, role_label: l.role_label || null,
      grade: l.grade || null, task: l.task || null, mm: num(l.mm),
      month_alloc: l.month_alloc && Object.keys(l.month_alloc).length ? l.month_alloc : null,
    };
    if (isLabor) {
      out.base_price = l.base_price;
      out.proposed_price = num(l.proposed_price);
      out.amount = l.amount;
    }
    return out;
  });
}

// 견적조건 블록을 넣었는가 — conds_on(true/false)이 정해져 있으면 그것, 아니면 문장이 있으면 넣은 것
export function condsOn(state) {
  return state.conds_on == null ? (state.conds || []).length > 0 : !!state.conds_on;
}

export function previewHeader(state) {
  const b = state.basic;
  return {
    quote_type: state.type.quote_type, deployment: state.type.deployment,
    template_code: state.type.template_code, solution: state.applied?.solution,
    brand: state.applied?.brand,
    customer_name: b.customer_name, customer_contact: b.customer_contact,
    quote_date: b.quote_date, valid_until: b.valid_until,
    // 메모 구성은 구 화면(quote-block.js)과 동일하게 유지한다 — 저장된 견적의 조회 표시가 달라지면 안 된다.
    memo: [
      b.purpose ? '[견적용도] ' + b.purpose : '',
      '[결제조건] ' + (b.pay_terms || '-'),
      '[특별DC] ' + dcMemo(state.discount),
      b.phone ? '[연락처] ' + b.phone : '',
      b.email ? '[이메일] ' + b.email : '',
    ].filter(Boolean).join('\n'),
    // 견적조건 — 넣으면 문장 목록, 뺐으면 빈 목록(견적서에 견적조건 칸이 없다).
    // 정해지지 않은 옛 견적(conds_on 없음 · 문장 없음)은 보내지 않는다 — 서버가 템플릿 문구를 쓴다
    conditions: condsOn(state) ? (state.conds || []).filter((c) => c.text && c.text.trim())
      .map((c) => ({ text: c.text, auto: false, edited: true }))
      : state.conds_on === false ? [] : undefined,
    // 견적별 결제 방안(V6) — 없으면 보내지 않는다(템플릿 설정 · 기본 문구)
    pay_plan: state.pay_plan || undefined,
  };
}

function dcMemo(dc) {
  if (!dc || dc.value === null || dc.value === undefined || dc.value === '') return '미적용';
  const v = num(dc.value);
  if (dc.mode === 'RATE') return `할인율 ${v}%`;
  if (dc.mode === 'AMOUNT') return `할인액 ${won(v)}원`;
  return `최종금액 지정 ${won(v)}원`;
}

export function discountPayload(state) {
  return dcPayload(state.discount);
}

// 월 특별DC. 미입력(null)이면 보내지 않는다. value 0 은 유효한 값이다(무상제공).
export function monthlyDiscountPayload(state) {
  return dcPayload(state.monthly_discount);
}

function dcPayload(dc) {
  if (!dc || !dc.mode) return null;
  if (dc.value === null || dc.value === undefined || dc.value === '') return null;
  return { type: dc.mode, value: num(dc.value) };
}

// ── 템플릿 적용 ─────────────────────────────────────────────
// apply-template 응답 → 위저드 상태 조각. 제안단가는 기준단가로 시작한다(템플릿 불러오기 창도 같이 쓴다).
export function appliedPatch(d) {
  const blocks = d.blocks.filter((b) => b.block_code !== 'SUMMARY').map((b) => ({
    ...b,
    items: (b.items || []).map((it) => ({ ...it, proposed_price: it.base_price || 0 })),
    labor: (b.labor || []).map((l) => ({ ...l, proposed_price: l.base_price || 0, month_alloc: l.month_alloc || {} })),
  }));
  return {
    blocks, applied: d.template, laborYear: d.labor_year,
    round_unit: d.round_unit ?? 100000,
    hasLaborPlan: !!d.template.has_labor_plan,
    conds: (d.conditions || []).map((t) => ({ text: t })),
    conds_on: (d.conditions || []).length > 0, // 템플릿에 견적조건 세트가 없으면 뺀 채로 시작
  };
}

async function applyTemplate(state, wiz) {
  const d = await http.applyTemplate(state.type.template_code);
  wiz.patch(appliedPatch(d));
  if (d.unregistered && d.unregistered.length) {
    toast(`가격마스터 미등록 모듈 ${d.unregistered.length}건 — 기준단가가 비어 있습니다: ${d.unregistered.join(', ')}`, 'err');
  }
}

// 미리보기 창 — 견적 작성 위쪽 [미리보기] 버튼. 지금 화면의 값(저장 전 포함)으로 PDF 와 같은 견적서를 그린다.
export async function openPreview(wiz) {
  const s = wiz.get();
  if (!s.blocks || !s.blocks.length) return toast('템플릿을 불러오거나 3단계(구성)에서 견적 구성을 만든 뒤 미리볼 수 있습니다.', 'err');
  recalcBlocks(s); // 행 금액(amount)을 채운다 — 서버는 보낸 금액을 그대로 합산한다
  const frame = h('iframe', { style: 'width:100%;height:72vh;border:1px solid #E7EAF0;background:#fff' });
  const info = h('span', { style: 'margin-right:auto;font-size:12px;color:var(--text-3)' }, '그리는 중...');
  const printBtn = h('button', { class: 'btn', disabled: true, onclick: () => frame.contentWindow.print() }, '인쇄 · PDF 저장');
  const m = openModal({
    title: `견적서 미리보기${s.quoteNo ? ' — ' + s.quoteNo : ''}`,
    body: frame,
    footer: [info, printBtn, h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '닫기')],
  });
  const box = m.back.querySelector('.modal');
  box.style.width = '880px';
  box.querySelector('.modal-body').style.padding = '12px';
  try {
    const r = await http.previewQuote({
      blocks: toBlocksPayload(s), header: { ...previewHeader(s), quote_no: s.quoteNo || undefined },
      discount: discountPayload(s), monthly_discount: monthlyDiscountPayload(s),
      round_unit: num(s.round_unit ?? 100000),
    });
    frame.srcdoc = r.html;
    info.textContent = `일시 ${won(r.calc.onetime_total)}원${r.calc.monthly_total ? ' / 월 ' + won(r.calc.monthly_total) + '원' : ''}`;
    printBtn.disabled = false;
  } catch (err) {
    info.textContent = '';
    frame.replaceWith(h('div', { class: 'ss-cell--empty', style: 'padding:24px' }, err.message));
  }
}

export async function renderStep3(root, state, wiz) {
  root.replaceChildren();

  // 두 가지로 쓴다 — ① 템플릿을 불러와 고치기 ② 직접 작성(블록 · 품목 · 인력을 모두 손으로). 어느 쪽이든 모든 칸을 고칠 수 있다
  if (!state.type.template_code && !state.type.manual) {
    root.appendChild(h('div', { class: 'banner wrn' },
      h('div', {}, h('b', {}, 'STEP② 에서 템플릿을 고르거나 [직접 작성] 을 선택하세요.'), ' 위쪽 [템플릿 불러오기] 로 바로 불러와도 됩니다.')));
    return;
  }
  if (!state.blocks.length && state.type.template_code) {
    root.appendChild(h('div', { class: 'empty' }, '템플릿을 적용하는 중…'));
    try { await applyTemplate(state, wiz); }
    catch (err) { root.replaceChildren(h('div', { class: 'empty' }, err.message)); return; }
    root.replaceChildren();
  }

  // 입력이 전체 폭을 쓴다 — 견적서 미리보기는 위쪽 [미리보기] 버튼으로 연다
  const left = h('div', { style: 'min-width:0' });
  root.appendChild(left);
  const preview = { schedule() {} }; // 예전 오른쪽 미리보기 갱신 자리 — 지금은 창으로 연다

  const els = {};
  function syncTotals(c) {
    const set = (k, v) => { if (els[k]) els[k].textContent = v; };
    set('one', won(c.onetime)); set('dc', c.dcAmt ? '-' + won(c.dcAmt) : '0');
    set('tr', c.trunc ? '-' + won(c.trunc) : '0'); set('fin', won(c.final));
    set('vat', won(c.vat)); set('mon', c.monthly ? won(c.monthly) : '-');
    set('mdc', c.mdcAmt ? '-' + won(c.mdcAmt) : '0');
    set('monFin', c.monthly ? won(c.monthlyFinal) : '-');
    paintPayPlan(c); // 금액이 바뀌면 결제 방안 금액도 따라 바뀐다
    if (els.warn) {
      els.warn.textContent = c.laborErrors.length ? '인력투입계획 확인: ' + c.laborErrors.join(' / ') : '';
      els.warn.style.display = c.laborErrors.length ? '' : 'none';
    }
  }
  function touched() { wiz.patch({}); syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz); }

  // ── 블록 그리드 ─────────────────────────────────────────────
  // 견적서 표와 같은 칸 구성으로 칸마다 따로 입력한다(SingleSuite 편집 그리드 — 선택 칸 · 행추가 · 행삭제 · 소계 행).
  //   품목: 구분 · 모듈 · 세부기능 · 수량 · 단위 · 기준단가 · 제안단가 · 제안금액 · 품목코드
  //   인력: 역할(표시명) · 직무(노임단가 팝업) · 등급 · 업무 · 공수 · 기준단가 · 제안단가 · 제안금액
  // 고르는 값(품목 · 직무)은 팝업에서 고르고, 고른 뒤에도 모든 칸을 고칠 수 있다.
  const ITEM_COLS = [['선택', 44], ['구분', 160], ['모듈', 180], ['세부기능', 360], ['수량', 76], ['단위', 72],
    ['기준단가 (원)', 122], ['제안단가 (원)', 122], ['제안금액 (원)', 130], ['품목코드', 140]];
  const LABOR_COLS = [['선택', 44], ['역할', 140], ['직무 (노임단가)', 190], ['등급', 90], ['업무', 340], ['공수 (MM)', 76],
    ['기준단가 (원)', 122], ['제안단가 (원)', 122], ['제안금액 (원)', 130]];

  function rowEl(b, r, isLabor, picked) {
    const amtCell = h('td', { class: 'ss-cell--amount' }, num(r.qty) === 0 && !isLabor ? '' : won(r.amount || 0));
    const upd = () => {
      const c = recalcBlocks(wiz.get());
      amtCell.textContent = num(r.qty) === 0 && !isLabor ? '' : won(r.amount || 0);
      const sub = document.getElementById('sub-' + b.block_code);
      if (sub) sub.textContent = won(b._sub || 0);
      wiz.patch({}); syncTotals(c); preview.schedule(wiz);
    };
    const td = (el) => h('td', { class: 'ss-cell--input' }, el);
    // 글자는 왼쪽(단위 · 등급만 가운데), 숫자는 오른쪽. 금액은 3자리 콤마로 입력한다(다른 편집 그리드와 같은 numInput)
    const txt = (key, ph = '', align = 'left') => td(h('input', { class: 'ss-cellinput', value: r[key] ?? '', placeholder: ph,
      style: `text-align:${align}`, oninput: (e) => { r[key] = e.target.value; touched(); } }));
    const numIn = (key, style = '') => td(h('input', { class: 'ss-cellinput', type: 'number', step: 'any', value: r[key] ?? '',
      style: 'text-align:right;' + style, oninput: (e) => { r[key] = e.target.value === '' ? null : e.target.value; upd(); } }));
    const money = (key, style = '') => td(numInput(r[key], (v) => { r[key] = v === '' ? null : v; upd(); },
      { class: 'ss-cellinput', style: 'text-align:right;' + style }));
    // 세부기능 · 업무는 여러 줄 — 줄 수만큼 칸이 늘어난다
    const specKey = isLabor ? 'task' : 'spec';
    const spec = h('textarea', { class: 'ss-cellinput', style: 'height:auto;resize:vertical;line-height:1.45;padding:4px 6px;text-align:left',
      oninput: (e) => { r[specKey] = e.target.value; e.target.rows = lines(e.target.value); touched(); } });
    spec.value = r[specKey] || '';
    spec.rows = lines(spec.value);
    const sel = h('td', {}, h('input', { type: 'checkbox', 'aria-label': '선택', checked: picked.has(r),
      onchange: (e) => { if (e.target.checked) picked.add(r); else picked.delete(r); } }));
    const proposed = money('proposed_price', 'background:var(--primary-weak);color:var(--primary);font-weight:600');
    if (isLabor) {
      const roleBtn = h('button', { class: 'ss-cellinput', style: 'text-align:left;cursor:pointer', title: '노임단가에서 직무 선택' },
        r.role_code ? `${r.role_name || r.role_code} ▾` : '직무 선택 ▾');
      roleBtn.addEventListener('click', async () => {
        const x = await pickRole();
        if (!x) return;
        r.role_code = x.role_code; r.role_name = x.role_name;
        if (!r.role_label) r.role_label = x.role_name;
        if (!r.grade) r.grade = x.grade || '';
        r.base_price = x.apply_price != null ? Number(x.apply_price) : null;
        if (!num(r.proposed_price)) r.proposed_price = r.base_price || 0;
        repaintLeft();
      });
      return h('tr', {}, sel, txt('role_label', '예) PM, 개발#1'), td(roleBtn), txt('grade', '', 'center'), td(spec),
        numIn('mm'), money('base_price'), proposed, amtCell);
    }
    return h('tr', {}, sel, txt('category'), txt('name'), td(spec), numIn('qty'), txt('unit', '', 'center'),
      money('base_price'), proposed, amtCell, h('td', { class: 'ss-cell--link', style: 'font-size:11px' }, r.item_code || ''));
  }

  function lines(v) { return Math.min(8, Math.max(1, String(v || '').split('\n').length)); }

  async function pasteInto(b, rows, repaint) {
    const raw = prompt('엑셀에서 복사한 내용을 붙여 넣으세요.\n형식: 모듈코드[탭]수량 (한 줄에 하나)');
    if (!raw) return;
    const parsed = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [code, qty] = l.split(/\t|,|\s{2,}/).map((v) => (v || '').trim());
      return { code, qty: qty === undefined || qty === '' ? 1 : Number(qty) };
    }).filter((p) => p.code && !Number.isNaN(p.qty));
    if (!parsed.length) return toast('인식된 행이 없습니다.', 'err');
    let master = {};
    try {
      const { items } = await http.pricing(wiz.get().applied && wiz.get().applied.solution, undefined, true);
      master = Object.fromEntries((items || []).map((i) => [i.code, i]));
    } catch { /* 마스터 조회 실패해도 코드/수량은 넣는다 */ }
    let added = 0, updated = 0; const unknown = [];
    for (const p of parsed) {
      const ex = rows.find((r) => r.item_code === p.code);
      if (ex) { ex.qty = p.qty; updated++; continue; }
      const m = master[p.code];
      if (!m) unknown.push(p.code);
      rows.push({
        item_code: p.code, category: (m && m.category) || null, name: (m && m.name) || p.code,
        spec: (m && m.spec) || '', qty: p.qty, unit: (m && m.unit) || null,
        base_price: m && m.base_price != null ? Number(m.base_price) : null,
        proposed_price: m && m.base_price != null ? Number(m.base_price) : 0, amount: 0,
      });
      added++;
    }
    repaint();
    toast(`추가 ${added} / 수량갱신 ${updated}${unknown.length ? ` · 마스터 미등록 ${unknown.length}건(${unknown.join(', ')})` : ''}`,
      unknown.length ? 'err' : 'ok');
  }

  function blockCard(b, repaint) {
    const isLabor = b.block_code === 'LABOR';
    const rows = isLabor ? b.labor : b.items;
    const picked = new Set();
    const cols = isLabor ? LABOR_COLS : ITEM_COLS;
    const gbtn = (label, onclick, cls = 'ss-btn--gridrow') => h('button', { class: 'ss-btn ' + cls, onclick }, label);

    const addRow = () => {
      rows.push(isLabor
        ? { role_code: '', role_name: '', role_label: '', grade: '', task: '', mm: 1, base_price: null, proposed_price: 0, amount: 0, month_alloc: {} }
        : { item_code: '', category: rows.length ? rows[rows.length - 1].category || '' : '', name: '', spec: '', unit: '', qty: 1, base_price: null, proposed_price: 0, amount: 0 });
      repaint();
    };
    // 고르는 값은 팝업에서 — 품목은 가격정책 품목, 인력은 노임단가 직무
    const pickRows = async () => {
      const s0 = wiz.get();
      if (isLabor) {
        const x = await pickRole();
        if (!x) return;
        const base = x.apply_price != null ? Number(x.apply_price) : null;
        rows.push({ role_code: x.role_code, role_name: x.role_name, role_label: x.role_name, grade: x.grade || '', task: '', mm: 1,
          base_price: base, proposed_price: base || 0, amount: 0, month_alloc: {} });
      } else {
        const list = await pickItems({ solution: s0.applied && s0.applied.solution, deployment: ITEM_DEP[s0.type.deployment] || '' });
        if (!list.length) return;
        list.forEach((i) => rows.push(itemRow(i)));
        toast(`${list.length}개 품목을 넣었습니다.`, 'ok');
      }
      repaint();
    };
    const delRows = () => {
      if (!picked.size) return toast('삭제할 행을 선택하세요.', 'err');
      for (const r of picked) { const i = rows.indexOf(r); if (i >= 0) rows.splice(i, 1); }
      repaint();
    };
    const dropBlock = async () => {
      const n = (b.items || []).length + (b.labor || []).length;
      if (n && !(await confirmModal({ title: '블록 빼기', danger: true, okLabel: '빼기', message: `'${b.name}' 블록과 행 ${n}개를 견적에서 뺍니다.` }))) return;
      const blocks = wiz.get().blocks;
      const i = blocks.indexOf(b); if (i >= 0) blocks.splice(i, 1);
      repaint();
    };

    // 블록 순서 — 견적서에 찍히는 순서
    const all = wiz.get().blocks;
    const at = all.indexOf(b);
    const move = (d) => {
      const j = at + d;
      if (j < 0 || j >= all.length) return;
      [all[at], all[j]] = [all[j], all[at]];
      repaint();
      document.getElementById('blk-' + b.block_code)?.scrollIntoView({ block: 'nearest' });
    };
    const head = h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
      h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${at + 1}. ${b.name}`),
      b.recurring ? h('span', { class: 'badge badge-yellow' }, '월정액') : null,
      h('button', { class: 'ss-btn ss-btn--gridrow', style: 'margin-left:8px', disabled: at <= 0, title: '위로', onclick: () => move(-1) }, '▲ 위로'),
      h('button', { class: 'ss-btn ss-btn--gridrow', disabled: at >= all.length - 1, title: '아래로', onclick: () => move(1) }, '▼ 아래로'),
      h('div', { class: 'ss-detailbar__spacer' }),
      gbtn('행추가', addRow), gbtn(isLabor ? '직무 선택' : '품목 선택', pickRows),
      isLabor ? null : gbtn('엑셀 붙여넣기', () => pasteInto(b, rows, repaint)),
      gbtn('행삭제', delRows), gbtn('블록 빼기', dropBlock, 'ss-btn--delete'));

    const tbody = h('tbody');
    rows.forEach((r) => tbody.appendChild(rowEl(b, r, isLabor, picked)));
    if (!rows.length) tbody.appendChild(h('tr', {}, h('td', { colspan: cols.length, class: 'ss-cell--empty' },
      isLabor ? '[직무 선택] 으로 노임단가 직무를 넣거나 [행추가] 로 직접 입력하세요.' : '[품목 선택] 으로 가격정책 품목을 넣거나 [행추가] 로 직접 입력하세요.')));
    // 소계 행 — 견적서와 같은 자리
    const amtIdx = cols.findIndex(([t]) => t.startsWith('제안금액'));
    tbody.appendChild(h('tr', { style: 'background:#F4F9E3;font-weight:600' },
      h('td', { colspan: amtIdx, style: 'text-align:center' }, `${b.name} 소계${b.recurring ? ' (월)' : ''}`),
      h('td', { class: 'ss-cell--amount', id: 'sub-' + b.block_code }, won(b._sub || 0)),
      ...(cols.length - amtIdx - 1 > 0 ? [h('td', { colspan: cols.length - amtIdx - 1 })] : [])));

    const width = cols.reduce((a, [, w]) => a + w, 0);
    const table = h('table', { class: 'ss-grid ss-grid--sized', style: `width:${width}px;min-width:100%` },
      h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
      h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
      tbody);

    const card = h('div', { class: 'card', id: 'blk-' + b.block_code, style: 'margin-bottom:12px;padding:10px 12px;scroll-margin-top:12px' }, head,
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' }, table));
    // 셋업비용 등 비-LABOR 블록의 인력 행은 금액이 아니라 인력투입계획 부록용 공수 배분 — 4단계(인건비)에서 고친다
    if (!isLabor && b.labor && b.labor.length) {
      card.appendChild(h('div', { class: 'banner inf', style: 'margin-top:8px' },
        h('div', {}, `인력투입계획 부록용 공수 배분 ${b.labor.length}건이 있습니다. 공수는 다음 단계(인건비)에서 입력합니다.`)));
    }
    return card;
  }

  // 합계 — 두 줄 그리드(일시불 · 월 사용료). 계산 순서는 견적서와 같다: 소계 → 특별 DC → 절사(일시불만) → 부가세 별도.
  // 특별 DC 는 방식(최종금액 지정 · 할인액 · 할인율) + 값. 값을 비우면 DC 없음.
  function summaryCard(c) {
    const s0 = wiz.get();
    const dc = s0.discount || { mode: 'TARGET', value: null };
    const mdc = s0.monthly_discount || { mode: 'TARGET', value: null };
    const recalc = () => syncTotals(recalcBlocks(wiz.get()));
    const dcCell = (obj, key) => {
      const sel = h('select', { class: 'ss-cellinput', style: 'width:118px', onchange: (e) => { obj.mode = e.target.value; wiz.patch({ [key]: obj }); recalc(); } },
        ...[['TARGET', '최종금액 지정'], ['AMOUNT', '할인액'], ['RATE', '할인율 (%)']].map(([v, l]) => h('option', { value: v, selected: obj.mode === v }, l)));
      const val = numInput(obj.value ?? '', (v) => { obj.value = v === '' ? null : v; wiz.patch({ [key]: obj }); recalc(); },
        { class: 'ss-cellinput', style: 'flex:1;text-align:right', placeholder: '비우면 DC 없음' });
      return h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:4px' }, sel, val));
    };
    const ru = String(num(s0.round_unit ?? 100000));
    const roundSel = h('select', { class: 'ss-cellinput', style: 'width:96px', onchange: (e) => { wiz.patch({ round_unit: num(e.target.value) }); recalc(); } },
      ...[['100000', '십만단위'], ['10000', '만단위'], ['0', '절사 없음']].map(([v, l]) => h('option', { value: v, selected: ru === v }, l)));
    const amt = (key, strong) => (els[key] = h('span', { style: strong ? 'font-weight:700' : '' }));
    const td = (el, cls = 'ss-cell--amount') => h('td', { class: cls }, el);
    const cols = [['구분', 110], ['소계 (원)', 140], ['특별 DC', 290], ['DC 금액 (원)', 130], ['절사', 190], ['최종 금액 (원)', 150], ['부가세 10% (원)', 130]];
    const hasMonthly = c.monthly || wiz.get().blocks.some((b) => b.recurring);
    const tbody = h('tbody', {},
      h('tr', {}, h('td', { style: 'text-align:center;font-weight:600' }, '일시불'), td(amt('one')), dcCell(dc, 'discount'), td(amt('dc')),
        h('td', { class: 'ss-cell--input' }, h('div', { style: 'display:flex;gap:6px;align-items:center;justify-content:flex-end' }, roundSel, amt('tr'))),
        td(amt('fin', true)), td(amt('vat'))),
      hasMonthly ? h('tr', {}, h('td', { style: 'text-align:center;font-weight:600' }, '월 사용료'), td(amt('mon')), dcCell(mdc, 'monthly_discount'), td(amt('mdc')),
        h('td', { style: 'text-align:center;color:var(--text-3)' }, '절사 안 함'), td(amt('monFin', true)), h('td', { style: 'text-align:center;color:var(--text-3)' }, '별도')) : null);
    els.warn = h('div', { style: 'display:none;margin-top:8px;padding:8px;background:var(--warn-bg);border:1px solid #FFE380;font-size:12px' });
    const card = h('div', { class: 'card', style: 'margin-bottom:12px;padding:10px 12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 합계'),
        h('span', { class: 'ss-detailbar__note' }, '소계 → 특별 DC → 절사 → 부가세 별도')),
      h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
        h('table', { class: 'ss-grid ss-grid--sized', style: `width:${cols.reduce((x, [, w]) => x + w, 0)}px;min-width:100%` },
          h('colgroup', {}, ...cols.map(([, w]) => h('col', { style: `width:${w}px` }))),
          h('thead', {}, h('tr', {}, ...cols.map(([t]) => h('th', {}, t)))),
          tbody)),
      els.warn);
    syncTotals(c);
    return card;
  }

  // 견적 구성 줄 — 3단계 맨 위. 지금 블록 순서(번호 · 이름 · 소계)를 한눈에 보이고, 블록을 더한다.
  // 블록 순서가 견적서에 찍히는 순서다. 순서 바꾸기는 각 블록 머리의 ▲ ▼ (또는 이 줄의 칩을 누르면 그 블록으로 간다).
  function blockBar() {
    const blocks = wiz.get().blocks;
    const sel = h('select', { class: 'ss-select', style: 'width:220px' });
    const btn = h('button', { class: 'ss-btn ss-btn--save' }, '블록 추가');
    blockDefs().then((defs) => {
      const have = new Set(blocks.map((x) => x.block_code));
      const opts = defs.filter((d) => d.code !== 'SUMMARY' && !have.has(d.code)).map((d) => [d.code, `${d.name}${d.recurring ? ' (월)' : ''}`]);
      if (!payOn()) opts.push(['__PAY', '결제 방안']); // 뺀 결제 방안을 다시 넣는다
      if (!condsOn(wiz.get())) opts.push(['__COND', '견적조건']); // 뺀 견적조건을 다시 넣는다
      sel.replaceChildren(...(opts.length ? opts.map(([v, l]) => h('option', { value: v }, l))
        : [h('option', { value: '' }, '더할 블록이 없습니다')]));
      btn.disabled = !opts.length;
    });
    btn.addEventListener('click', async () => {
      if (sel.value === '__PAY' || sel.value === '__COND') {
        if (sel.value === '__PAY') setPay({ enabled: true });
        else wiz.patch({ conds_on: true });
        repaintLeft();
        document.getElementById(sel.value === '__PAY' ? 'blk-PAY' : 'blk-CONDS')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const d = (await blockDefs()).find((x) => x.code === sel.value);
      if (!d) return;
      // 새 블록은 맨 아래에 붙인다 — 자리는 ▲ ▼ 로 옮긴다
      wiz.get().blocks.push({ block_code: d.code, name: d.name, recurring: !!d.recurring, ...(d.code === 'LABOR' ? { labor: [] } : { items: [] }) });
      repaintLeft();
      document.getElementById('blk-' + d.code)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const chip = (label, id) => h('button', {
      class: 'ss-chip', style: 'cursor:pointer;border:1px solid #DCE3EC;background:#F8FAFC',
      title: '이 블록으로 가기', onclick: () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }, label);
    const chips = blocks.map((x, i) => chip(`${i + 1}. ${x.name}`, 'blk-' + x.block_code));
    if (payOn()) chips.push(chip(`${blocks.length + 1}. 결제 방안`, 'blk-PAY'));
    if (condsOn(wiz.get())) chips.push(chip(`${blocks.length + (payOn() ? 2 : 1)}. 견적조건`, 'blk-CONDS'));
    return h('div', { class: 'card', style: 'margin-bottom:12px;padding:10px 12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0;flex-wrap:wrap;gap:8px' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, '▣ 견적 구성'),
        h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, ...chips),
        blocks.length ? null : h('span', { class: 'ss-detailbar__note' }, '견적서에 넣을 블록(셋업비용 · 솔루션 견적 · 서비스 이용료 · 개발인건비 등)을 먼저 추가하세요.'),
        h('div', { class: 'ss-detailbar__spacer' }), sel, btn));
  }

  function repaintLeft() {
    const c = recalcBlocks(wiz.get());
    left.replaceChildren();
    left.appendChild(blockBar());
    for (const b of wiz.get().blocks) left.appendChild(blockCard(b, repaintLeft));
    // 견적서 순서대로 번호 — 블록들 다음 결제 방안(넣는 경우), 그다음 견적조건
    const n = wiz.get().blocks.length;
    const payNo = payOn() ? n + 1 : null;
    const condNo = condsOn(wiz.get()) ? n + (payOn() ? 2 : 1) : null;
    // 옵션(서버이중화 · 계열사 추가 등 규칙 마스터 연동) 안내 칸은 뺐다 — 기능이 생기면 그때 넣는다
    // 견적서와 같은 순서 — 결제 방안 다음에 견적조건
    if (payNo) left.appendChild(payPlanCard(payNo)); else els.payPlan = null;
    if (condNo) left.appendChild(condCard(condNo));
    left.appendChild(summaryCard(c));
    wiz.patch({});
    preview.schedule(wiz);
  }

  // 견적조건 — 템플릿 조건셋으로 채워지고, 여기서 문구를 고치거나 줄을 더한다.
  // 견적서 하단 "▣ 견적조건" 블록이 이 배열을 그대로 싣는다.
  function condCard(no) {
    const conds = wiz.get().conds || [];
    const list = h('div', {});
    const touch = () => { wiz.patch({ conds }); preview.schedule(wiz); };
    const rowOf = (c) => {
      const row = h('div', { style: 'display:flex;gap:6px;margin-bottom:6px' },
        h('input', { class: 'input', style: 'flex:1', value: c.text || '',
          oninput: (e) => { c.text = e.target.value; touch(); } }));
      const del = h('button', { class: 'btn btn-sm btn-danger' }, '×');
      del.addEventListener('click', () => {
        const i = conds.indexOf(c); if (i >= 0) conds.splice(i, 1);
        row.remove(); touch();
      });
      row.appendChild(del);
      return row;
    };
    conds.forEach((c) => list.appendChild(rowOf(c)));
    const add = h('button', { class: 'ss-btn ss-btn--gridrow' }, '행추가');
    add.addEventListener('click', () => {
      const c = { text: '' }; conds.push(c); list.appendChild(rowOf(c)); touch();
    });
    return h('div', { class: 'card', id: 'blk-CONDS', style: 'margin-bottom:12px;padding:10px 12px;scroll-margin-top:12px' },
      h('div', { class: 'ss-detailbar', style: 'margin-top:0' },
        h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${no}. 견적조건`),
        h('span', { class: 'ss-detailbar__note' }, '견적서 하단에 그대로 인쇄됩니다'),
        h('div', { class: 'ss-detailbar__spacer' }), add,
        // 빼도 문장은 남겨 둔다 — 블록 추가에서 다시 넣으면 그대로 돌아온다
        h('button', { class: 'ss-btn ss-btn--gridrow', onclick: () => { wiz.patch({ conds_on: false }); repaintLeft(); } }, '블록 빼기')),
      h('div', { style: 'margin-top:8px' }, list));
  }

  // ── 결제 방안 ───────────────────────────────────────────────
  // 견적마다 고친다(state.pay_plan = { enabled, ratio, rows }).
  //   enabled — 견적서에 넣을지. 없으면 템플릿 설정(has_pay_plan)을 따른다 — 직접 작성 견적도 켤 수 있다
  //   ratio   — 셋업비용 계약체결 시 비율(%), 나머지는 구축완료 후. 바꾸면 기본 문구를 다시 만든다
  //   rows    — 직접 고친 표. null 이면 금액 · 비율로 기본 문구(서버 QuoteHtml.payPlanRows 와 같은 문구)
  const PAY_COLS = [['선택', 44], ['구분', 150], ['지급시점', 220], ['비용', 360], ['내역', 420]];
  const payState = () => wiz.get().pay_plan || {};
  const payOn = () => {
    const pp = payState();
    return 'enabled' in pp ? !!pp.enabled : !!(wiz.get().applied && wiz.get().applied.has_pay_plan);
  };
  const setPay = (part) => { wiz.patch({ pay_plan: { ...payState(), ...part } }); };

  function payPlanDefault(one, mon, ratio) {
    const r = ratio > 0 && ratio <= 100 ? Number(ratio) : 50;
    const first = Math.round(one * r / 100);
    const rows = [];
    if (one === 0) rows.push(['서비스\n셋업비용', '1. 무상제공', '1. 셋업비용 : 무상제공', '-']);
    else if (r >= 100) {
      rows.push(['서비스\n셋업비용', '1. 일시불\n  -. 계약체결 후 100%', `1. 일시불 비용 : ₩${won(one)}원`,
        '-. 서비스계약 체결 후 7일 이내 세금계산서 발행\n-. 결제조건 : 계약체결 후 100%']);
    } else {
      rows.push(['서비스\n셋업비용', `1. 일시불\n  -. 계약체결 후 ${r}%\n  -. 구축완료 후 ${100 - r}%`,
        `1. 일시불 비용 : ₩${won(one)}원\n   계약체결 후 ${r}% : ₩${won(first)}원\n   구축완료 후 ${100 - r}% : ₩${won(one - first)}원`,
        `-. 서비스계약 체결 후 7일 이내 세금계산서 발행\n-. 검수완료 후 7일 이내 세금계산서 발행\n-. 결제조건 : 계약체결 후 ${r}% / 구축완료 후 ${100 - r}%`]);
    }
    rows.push(['서비스\n월 사용료', '1. 매월 말', `1. 서비스 사용료 : ₩${won(mon)}원/매월`, '-. 서비스 착수 후 월별로 세금계산서 발행']);
    return rows;
  }
  const shownPayRows = (c) => {
    const pp = payState();
    return Array.isArray(pp.rows) && pp.rows.length ? pp.rows : payPlanDefault(c.final, c.monthlyFinal, pp.ratio ?? 50);
  };

  // 결제 방안을 넣는 견적에서만 그린다(repaintLeft). 빼면 맨 위 [블록 추가] 목록에 '결제 방안' 이 나온다
  function payPlanCard(no) {
    const pp = payState();
    const picked = new Set();
    const gbtn = (label, onclick) => h('button', { class: 'ss-btn ss-btn--gridrow', onclick }, label);
    // 처음 고치는 순간 지금 보이는 기본 문구를 견적에 옮겨 담는다 — 그 뒤로는 금액이 바뀌어도 그대로 둔다
    const materialize = () => {
      const c = recalcBlocks(wiz.get());
      if (!(Array.isArray(payState().rows) && payState().rows.length)) setPay({ rows: shownPayRows(c).map((r) => [...r]) });
      return payState().rows;
    };
    const ratio = h('input', { class: 'ss-input', type: 'number', min: 1, max: 100, step: 1, style: 'width:70px;text-align:right', value: pp.ratio ?? 50,
      onchange: (e) => {
        const v = Number(e.target.value);
        if (!(v > 0 && v <= 100)) { e.target.value = payState().ratio ?? 50; return toast('비율은 1~100 사이로 넣으세요.', 'err'); }
        setPay({ ratio: v, rows: null }); // 비율로 기본 문구를 다시 만든다
        repaintLeft();
        toast(`계약체결 ${v}% / 구축완료 ${100 - v}% 로 다시 만들었습니다.`, 'ok');
      } });
    const bar = h('div', { class: 'ss-detailbar', style: 'margin-top:0;flex-wrap:wrap' },
      h('span', { style: 'font-size:14px;font-weight:600;color:var(--ss-ink-1)' }, `▣ ${no}. 결제 방안`),
      h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;margin-left:12px' }, '계약체결 시', ratio, '%'),
      h('div', { class: 'ss-detailbar__spacer' }),
      ...([
        gbtn('행추가', () => { const rows = materialize(); rows.push(['', '', '', '']); setPay({ rows }); repaintLeft(); }),
        gbtn('행삭제', () => {
          if (!picked.size) return toast('삭제할 행을 선택하세요.', 'err');
          const rows = materialize().filter((_, i) => !picked.has(i));
          setPay({ rows }); repaintLeft();
        }),
        gbtn('기본값으로', () => { setPay({ rows: null }); repaintLeft(); toast('금액과 비율로 기본 문구를 다시 만들었습니다.', 'ok'); }),
        // 빼면 견적서에서 결제 방안 표가 빠진다. 다시 넣을 때는 맨 위 [블록 추가] 에서 '결제 방안'
        h('button', { class: 'ss-btn ss-btn--delete', onclick: () => { setPay({ enabled: false }); repaintLeft(); toast('결제 방안을 뺐습니다. 맨 위 [블록 추가] 에서 다시 넣을 수 있습니다.', 'ok'); } }, '블록 빼기'),
      ]));
    const card = h('div', { class: 'card', id: 'blk-PAY', style: 'margin-bottom:12px;padding:10px 12px;scroll-margin-top:12px' }, bar);
    const tbody = h('tbody');
    els.payPlan = { tbody, picked };
    paintPayPlan(recalcBlocks(wiz.get()));
    card.appendChild(h('div', { class: 'ss-gridwrap', style: 'margin-top:8px;overflow:auto' },
      h('table', { class: 'ss-grid ss-grid--sized', style: `width:${PAY_COLS.reduce((x, [, w]) => x + w, 0)}px;min-width:100%` },
        h('colgroup', {}, ...PAY_COLS.map(([, w]) => h('col', { style: `width:${w}px` }))),
        h('thead', {}, h('tr', {}, ...PAY_COLS.map(([t]) => h('th', {}, t)))),
        tbody)));
    card.appendChild(els.payNote = h('div', { class: 'ss-detailbar__note', style: 'margin-top:6px' }));
    paintPayNote();
    return card;
  }

  function paintPayNote() {
    if (!els.payNote) return;
    els.payNote.textContent = Array.isArray(payState().rows) && payState().rows.length
      ? '직접 고친 내용입니다 — 금액이 바뀌어도 그대로 둡니다. [기본값으로] 를 누르면 지금 금액 · 비율로 다시 만듭니다.'
      : '기본 문구입니다 — 금액 · 비율을 따라 바뀝니다. 칸을 고치면 그 뒤로는 고친 내용을 씁니다.';
  }

  function paintPayPlan(c) {
    const ref = els.payPlan;
    if (!ref) return;
    const custom = Array.isArray(payState().rows) && payState().rows.length;
    // 직접 고친 표는 금액이 바뀌어도 다시 그리지 않는다(입력 중인 칸이 날아가지 않게)
    if (custom && ref.tbody.childElementCount) return;
    const rows = shownPayRows(c);
    ref.tbody.replaceChildren(...rows.map((r, i) => h('tr', {},
      h('td', {}, h('input', { type: 'checkbox', 'aria-label': '선택', checked: ref.picked.has(i),
        onchange: (e) => { if (e.target.checked) ref.picked.add(i); else ref.picked.delete(i); } })),
      ...r.map((v, j) => {
        const ta = h('textarea', { class: 'ss-cellinput', rows: lines(v),
          style: 'height:auto;resize:vertical;line-height:1.5;padding:4px 6px;text-align:' + (j === 0 ? 'center' : 'left'),
          oninput: (e) => {
            const rowsNow = materialize2();
            rowsNow[i][j] = e.target.value;
            e.target.rows = lines(e.target.value);
            setPay({ rows: rowsNow });
            paintPayNote();
          } });
        ta.value = v;
        return h('td', { class: 'ss-cell--input' }, ta);
      }))));
  }
  // 칸 입력용 — 기본 문구를 견적에 옮겨 담고 그 배열을 돌려준다
  function materialize2() {
    const pp = payState();
    if (Array.isArray(pp.rows) && pp.rows.length) return pp.rows.map((r) => [...r]);
    return shownPayRows(recalcBlocks(wiz.get())).map((r) => [...r]);
  }

  repaintLeft();
}
