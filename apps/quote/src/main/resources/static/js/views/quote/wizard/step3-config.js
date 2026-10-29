// STEP③ 구성 — 좌 입력 / 우 실시간 미리보기.
// quote-block.js 의 블록·모듈 편집과 엑셀 붙여넣기를 그대로 이관했다.
// 계산 로직은 바꾸지 않는다: 서버 calcQuoteBlocks 와 같은 순서를 그대로 옮겨 왔다.
//   블록소계 합 → 특별DC → 절사(십만) → VAT. 일시불/월(recurring) 분리.
import { api as http } from '../../../api.js';
import { h, won, toast } from '../../../ui.js';

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
    conditions: (state.conds || []).filter((c) => c.text && c.text.trim())
      .map((c) => ({ text: c.text, auto: false, edited: true })),
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
  };
}

async function applyTemplate(state, wiz) {
  const d = await http.applyTemplate(state.type.template_code);
  wiz.patch(appliedPatch(d));
  if (d.unregistered && d.unregistered.length) {
    toast(`가격마스터 미등록 모듈 ${d.unregistered.length}건 — 기준단가가 비어 있습니다: ${d.unregistered.join(', ')}`, 'err');
  }
}

// 미리보기 갱신 — STEP⑤ 에서도 쓴다
export function makePreview(frameId, stateId) {
  let timer = null;
  async function run(wiz) {
    const s = wiz.get();
    const badge = document.getElementById(stateId);
    try {
      const r = await http.previewQuote({
        blocks: toBlocksPayload(s), header: previewHeader(s),
        discount: discountPayload(s), monthly_discount: monthlyDiscountPayload(s),
        round_unit: num(s.round_unit ?? 100000),
      });
      const f = document.getElementById(frameId);
      if (f) {
        // 견적서는 A4(약 800px) 폭으로 짜여 있다 — 좁은 미리보기 칸에서는 줄바꿈되지 않게 통째로 줄여 보인다
        f.onload = () => {
          const body = f.contentDocument && f.contentDocument.body;
          if (body) body.style.zoom = String(Math.min(1, (f.clientWidth - 16) / 800));
        };
        f.srcdoc = r.html;
      }
      if (badge) {
        badge.textContent = `일시 ${won(r.calc.onetime_total)}${r.calc.monthly_total ? ' / 월 ' + won(r.calc.monthly_total) : ''}`;
        badge.className = 'badge badge-blue';
      }
      return r;
    } catch (err) {
      if (badge) { badge.textContent = '미리보기 실패'; badge.className = 'badge badge-red'; }
      return null;
    }
  }
  return {
    now: run,
    schedule(wiz) {
      const badge = document.getElementById(stateId);
      if (badge) { badge.textContent = '갱신 중'; badge.className = 'badge badge-yellow'; }
      clearTimeout(timer);
      timer = setTimeout(() => run(wiz), 300); // 디바운스 300ms
    },
  };
}

export async function renderStep3(root, state, wiz) {
  root.replaceChildren();

  if (!state.type.template_code) {
    root.appendChild(h('div', { class: 'banner wrn' },
      h('div', {}, h('b', {}, 'STEP② 에서 템플릿을 먼저 선택하세요.'))));
    return;
  }
  if (!state.blocks.length) {
    root.appendChild(h('div', { class: 'empty' }, '템플릿을 적용하는 중…'));
    try { await applyTemplate(state, wiz); }
    catch (err) { root.replaceChildren(h('div', { class: 'empty' }, err.message)); return; }
    root.replaceChildren();
  }

  const layout = h('div', { style: 'display:grid;grid-template-columns:1fr 440px;gap:14px;align-items:start' });
  const left = h('div', { style: 'min-width:0' });
  const right = h('div', { style: 'position:sticky;top:0' });
  layout.appendChild(left); layout.appendChild(right);
  root.appendChild(layout);

  right.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '미리보기'),
      h('span', { class: 'sub' }, 'PDF 와 같은 렌더러'), h('span', { class: 'sp' }),
      h('span', { class: 'badge badge-gray', id: 'pv-state' }, '대기')),
    h('div', { class: 'card-b', style: 'padding:0' },
      h('iframe', { id: 'pv-frame', style: 'width:100%;height:640px;border:0;background:#fff' }))));
  const preview = makePreview('pv-frame', 'pv-state');

  const els = {};
  function syncTotals(c) {
    const set = (k, v) => { if (els[k]) els[k].textContent = v; };
    set('one', won(c.onetime)); set('dc', c.dcAmt ? '-' + won(c.dcAmt) : '0');
    set('tr', c.trunc ? '-' + won(c.trunc) : '0'); set('fin', won(c.final));
    set('vat', won(c.vat)); set('mon', c.monthly ? won(c.monthly) : '-');
    set('mdc', c.mdcAmt ? '-' + won(c.mdcAmt) : '0');
    set('monFin', c.monthly ? won(c.monthlyFinal) : '-');
    if (els.warn) {
      els.warn.textContent = c.laborErrors.length ? '인력투입계획 확인: ' + c.laborErrors.join(' / ') : '';
      els.warn.style.display = c.laborErrors.length ? '' : 'none';
    }
  }
  function touched() { wiz.patch({}); syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz); }

  function rowEl(b, r, isLabor, repaint) {
    const amtCell = h('td', { class: 'num' }, num(r.qty) === 0 && !isLabor ? '-' : won(r.amount || 0));
    const qtyKey = isLabor ? 'mm' : 'qty';
    const nameInp = h('input', {
      class: 'input', style: 'width:100%',
      value: (isLabor ? (r.role_label || r.role_name) : r.name) || '',
      oninput: (e) => { if (isLabor) r.role_label = e.target.value; else r.name = e.target.value; touched(); },
    });
    const specInp = h('input', {
      class: 'input', style: 'width:100%', value: (isLabor ? r.task : r.spec) || '',
      oninput: (e) => { if (isLabor) r.task = e.target.value; else r.spec = e.target.value; touched(); },
    });
    const upd = () => {
      const c = recalcBlocks(wiz.get());
      amtCell.textContent = num(r.qty) === 0 && !isLabor ? '-' : won(r.amount || 0);
      const sub = document.getElementById('sub-' + b.block_code);
      if (sub) sub.textContent = won(b._sub || 0);
      wiz.patch({}); syncTotals(c); preview.schedule(wiz);
    };
    const qtyInp = h('input', {
      class: 'input', type: 'number', step: 'any', style: 'width:76px;text-align:right', value: r[qtyKey],
      oninput: (e) => { r[qtyKey] = e.target.value; upd(); },
    });
    const propInp = h('input', {
      class: 'input', type: 'number', step: 'any',
      style: 'width:118px;text-align:right;background:var(--primary-weak);color:var(--primary);font-weight:600',
      value: r.proposed_price,
      oninput: (e) => { r.proposed_price = e.target.value; upd(); },
    });
    const del = h('button', { class: 'btn btn-sm btn-danger' }, '×');
    del.addEventListener('click', () => {
      const arr = isLabor ? b.labor : b.items;
      const i = arr.indexOf(r); if (i >= 0) arr.splice(i, 1);
      repaint();
    });
    return h('tr', {},
      h('td', {}, isLabor
        ? h('div', {}, h('span', { class: 'tag' }, r.role_code),
            r.grade ? h('span', { class: 'sub', style: 'margin-left:4px;color:var(--text-3)' }, r.grade) : null, nameInp)
        : (r.item_code
            ? h('div', {}, r.category ? h('div', { class: 'sub', style: 'color:var(--text-3)' }, r.category) : null,
                h('strong', {}, r.name), h('div', { class: 'sub', style: 'color:var(--text-3)' }, r.item_code))
            : nameInp)),
      h('td', {}, specInp),
      h('td', { class: 'num' }, qtyInp, r.unit ? h('span', { class: 'sub' }, ' ' + r.unit) : null),
      h('td', { class: 'num' }, r.base_price != null ? won(r.base_price) : h('span', { class: 'sub' }, '-')),
      h('td', { class: 'num' }, propInp),
      amtCell,
      h('td', { class: 'ctr' }, del));
  }

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
    const card = h('div', { class: 'card', style: 'margin-bottom:12px' });
    card.appendChild(h('div', { class: 'card-h' }, h('h2', {}, b.name),
      b.recurring ? h('span', { class: 'badge badge-yellow' }, '월정액') : null,
      h('span', { class: 'sp' }), h('span', { class: 'sub' }, '소계 '),
      h('span', { class: 'num', id: 'sub-' + b.block_code, style: 'font-weight:600' }, won(b._sub || 0))));

    const mkTable = (isLabor) => {
      const rows = isLabor ? b.labor : b.items;
      if (!rows) return null;
      const tb = h('tbody');
      rows.forEach((r) => tb.appendChild(rowEl(b, r, isLabor, repaint)));
      const add = h('button', { class: 'btn btn-sm', style: 'margin:8px 0 0 14px' }, isLabor ? '+ 인력 추가' : '+ 항목 추가');
      add.addEventListener('click', () => {
        rows.push(isLabor
          ? { role_code: 'DEV', role_label: '', grade: '', task: '', mm: 1, base_price: null, proposed_price: 0, amount: 0, month_alloc: {} }
          : { item_code: '', category: '', name: '항목', spec: '', qty: 1, base_price: null, proposed_price: 0, amount: 0 });
        repaint();
      });
      const paste = isLabor ? null : h('button', { class: 'btn btn-sm', style: 'margin:8px 0 0 6px' }, '엑셀 붙여넣기');
      if (paste) paste.addEventListener('click', () => pasteInto(b, rows, repaint));
      return h('div', {},
        (isLabor && b.items && b.items.length)
          ? h('div', { class: 'sub', style: 'padding:10px 14px 0;color:var(--text-3)' }, '산정 근거(공수)') : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid' },
          h('thead', {}, h('tr', {},
            h('th', {}, isLabor ? '역할(등급)' : '구분/모듈'), h('th', {}, '세부내역'),
            h('th', { class: 'num' }, isLabor ? '공수 (MM)' : '수량'),
            h('th', { class: 'num' }, '기준단가 (원)'), h('th', { class: 'num' }, '제안단가 (원)'),
            h('th', { class: 'num' }, b.recurring ? '제안금액 (원/월)' : '제안금액 (원)'), h('th', {}, ''))),
          tb)),
        h('div', { style: 'padding:0 0 12px' }, add, paste));
    };
    if (b.items) card.appendChild(mkTable(false));
    // 인건비 표는 LABOR 블록에만 둔다. 비-LABOR 블록의 인건비 행은 금액이 아니라
    // 공수 배분이므로 STEP④ 에서 mm·월별배분만 편집한다.
    if (b.labor && b.block_code === 'LABOR') card.appendChild(mkTable(true));
    else if (b.labor && b.labor.length) {
      card.appendChild(h('div', { class: 'banner inf', style: 'margin:0 14px 12px' },
        h('div', {}, `인력투입계획 부록용 공수 배분 ${b.labor.length}건이 있습니다. 공수는 다음 단계(인건비)에서 입력합니다.`)));
    }
    return card;
  }

  function summaryCard(c) {
    const dc = wiz.get().discount || { mode: 'TARGET', value: 0 };
    els.one = h('span', { class: 'num' }, won(c.onetime));
    els.dc = h('span', { class: 'num' }); els.tr = h('span', { class: 'num' });
    els.fin = h('span', { class: 'num', style: 'font-weight:700' });
    els.vat = h('span', { class: 'num' }); els.mon = h('span', { class: 'num' });
    els.warn = h('div', { style: 'display:none;margin-top:10px;padding:8px;background:var(--warn-bg);border:1px solid #FFE380;font-size:12px' });
    const modeSel = h('select', { class: 'select', style: 'width:100%' },
      h('option', { value: 'TARGET', selected: dc.mode === 'TARGET' }, '최종금액 지정'),
      h('option', { value: 'AMOUNT', selected: dc.mode === 'AMOUNT' }, '할인액 (원)'),
      h('option', { value: 'RATE', selected: dc.mode === 'RATE' }, '할인율 (%)'));
    modeSel.addEventListener('change', (e) => { dc.mode = e.target.value; wiz.patch({ discount: dc }); syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz); });
    const valInp = h('input', {
      class: 'input', type: 'number', step: 'any', style: 'width:100%;text-align:right', value: dc.value == null ? 0 : dc.value,
      oninput: (e) => { dc.value = e.target.value; wiz.patch({ discount: dc }); syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz); },
    });
    // 절사 단위 — 실측은 전부 십만단위지만 구 화면과 동일하게 선택 가능해야 한다.
    const ru = String(num(wiz.get().round_unit ?? 100000));
    const roundSel = h('select', { class: 'select', style: 'width:100%' },
      h('option', { value: '100000', selected: ru === '100000' }, '십만단위 절사'),
      h('option', { value: '10000', selected: ru === '10000' }, '만단위 절사'),
      h('option', { value: '0', selected: ru === '0' }, '절사 안 함'));
    roundSel.addEventListener('change', (e) => {
      wiz.patch({ round_unit: num(e.target.value) });
      syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz);
    });

    // 월 특별DC — 일시불과 별도로 건다. 월 금액이 있는 견적(SaaS·PCloud)에서만 노출한다.
    const mdc = wiz.get().monthly_discount || { mode: 'TARGET', value: null };
    els.mdc = h('span', { class: 'num' }); els.monFin = h('span', { class: 'num', style: 'font-weight:700' });
    const mModeSel = h('select', { class: 'select', style: 'width:100%' },
      h('option', { value: 'TARGET', selected: mdc.mode === 'TARGET' }, '최종금액 지정'),
      h('option', { value: 'AMOUNT', selected: mdc.mode === 'AMOUNT' }, '할인액 (원)'),
      h('option', { value: 'RATE', selected: mdc.mode === 'RATE' }, '할인율 (%)'));
    const mValInp = h('input', {
      class: 'input', type: 'number', step: 'any', style: 'width:100%;text-align:right',
      placeholder: '미입력 = DC 없음', value: mdc.value == null ? '' : mdc.value,
    });
    const mTouch = () => { wiz.patch({ monthly_discount: mdc }); syncTotals(recalcBlocks(wiz.get())); preview.schedule(wiz); };
    mModeSel.addEventListener('change', (e) => { mdc.mode = e.target.value; mTouch(); });
    mValInp.addEventListener('input', (e) => { mdc.value = e.target.value === '' ? null : e.target.value; mTouch(); });

    const row = (k, v) => h('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;font-size:12.5px' }, h('span', { style: 'color:var(--text-2)' }, k), v);
    const monthlyRows = c.monthly
      ? [h('div', { style: 'border-top:1px solid var(--line-2);margin-top:10px;padding-top:8px' }),
        row('월 사용료 소계 (원)', els.mon),
        h('div', { class: 'fld', style: 'margin-top:8px' }, h('label', {}, '월 특별 DC'),
          h('div', { style: 'display:flex;gap:6px' }, mModeSel, mValInp)),
        row('월 DC 금액 (원)', els.mdc),
        row('월 사용료 (특별DC 적용, 원)', els.monFin)]
      : [row('월 사용료 (원)', els.mon)];
    const card = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h2', {}, '합계')),
      h('div', { class: 'card-b' },
        row('일시불 소계 (원)', els.one),
        h('div', { class: 'fld', style: 'margin-top:8px' }, h('label', {}, '특별 DC'),
          h('div', { style: 'display:flex;gap:6px' }, modeSel, valInp)),
        h('div', { class: 'fld', style: 'margin-top:8px' }, h('label', {}, '절사 단위'), roundSel),
        row('DC 금액 (원)', els.dc), row('절사액 (원)', els.tr),
        row('최종견적금액 (원)', els.fin), row('부가세 (원, 별도 10%)', els.vat),
        ...monthlyRows, els.warn));
    syncTotals(c);
    return card;
  }

  function repaintLeft() {
    const c = recalcBlocks(wiz.get());
    left.replaceChildren();
    for (const b of wiz.get().blocks) left.appendChild(blockCard(b, repaintLeft));
    left.appendChild(h('div', { class: 'card', style: 'margin-bottom:12px' },
      h('div', { class: 'card-h' }, h('h2', {}, '옵션'), h('span', { class: 'sub' }, '작업 11~13 이후 연동')),
      h('div', { class: 'card-b' },
        h('div', { class: 'banner inf' }, h('div', {},
          h('b', {}, '옵션 라인 자동 생성은 아직 없습니다'),
          '서버이중화·계열사 추가 등은 규칙 마스터(sq_mst_rule)가 들어오는 작업 13 이후 연동됩니다. 지금은 항목을 직접 추가하세요.')))));
    left.appendChild(condCard());
    left.appendChild(summaryCard(c));
    wiz.patch({});
    preview.schedule(wiz);
  }

  // 견적조건 — 템플릿 조건셋으로 채워지고, 여기서 문구를 고치거나 줄을 더한다.
  // 견적서 하단 "▣ 견적조건" 블록이 이 배열을 그대로 싣는다.
  function condCard() {
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
    const add = h('button', { class: 'btn btn-sm' }, '+ 조건 추가');
    add.addEventListener('click', () => {
      const c = { text: '' }; conds.push(c); list.appendChild(rowOf(c)); touch();
    });
    return h('div', { class: 'card', style: 'margin-bottom:12px' },
      h('div', { class: 'card-h' }, h('h2', {}, '견적조건'),
        h('span', { class: 'sub' }, '견적서 하단에 그대로 인쇄됩니다')),
      h('div', { class: 'card-b' }, list, add));
  }

  repaintLeft();
}
