import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, loading, clear } from '../ui.js';

// 템플릿 기반 블록형 견적 작성 (Phase 5-C). 기존 네고 editor 와 별개.
// 흐름: 솔루션→템플릿 선택→적용(apply-template)→블록 카드 자동 생성→
//       공수/제안단가 입력→구축금액/절사/할인/VAT→저장(블록 스냅샷).
const num = (v) => Number(v) || 0;
const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(d, n) { const x = new Date((d || todayStr()) + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }

export async function renderQuoteBlock(root) {
  await store.getMaster();
  const solutions = (store.master && store.master.solutions) || [];

  const st = {
    solution: solutions[0] ? solutions[0].code : 'EXPENSE',
    templates: [], templateCode: null, applied: null,
    blocks: [],
    info: { customer_name: '', customer_contact: '', purpose: '', quote_date: todayStr(), valid_until: addDays(todayStr(), 30), pay_terms: '고객사 결제조건', vat_mode: 'EXCLUDED', phone: '', email: '' },
    dc: { mode: 'RATE', value: 0 },
    conds: [],
  };

  clear(root);
  root.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'page-title' }, '새 견적 (템플릿)'),
      h('div', { class: 'page-sub' }, '솔루션·템플릿을 고르면 블록·기본모듈·인건비가 자동 편입됩니다. 기준단가는 마스터, 제안단가·공수만 입력하세요.'))));

  const setupWrap = h('div', {});
  const bodyWrap = h('div', {});
  root.appendChild(setupWrap); root.appendChild(bodyWrap);

  await loadTemplates();
  renderSetup();

  async function loadTemplates() {
    try { ({ templates: st.templates } = await api.templates(st.solution)); }
    catch { st.templates = []; }
    if (!st.templates.find((t) => t.code === st.templateCode)) st.templateCode = st.templates[0] ? st.templates[0].code : null;
  }

  function renderSetup() {
    clear(setupWrap);
    const solSel = h('select', { class: 'select', onchange: async (e) => { st.solution = e.target.value; await loadTemplates(); renderSetup(); } },
      ...solutions.map((s) => h('option', { value: s.code, selected: s.code === st.solution }, s.name)));
    const tplSel = h('select', { class: 'select', style: 'min-width:220px', onchange: (e) => { st.templateCode = e.target.value; } },
      ...(st.templates.length ? st.templates.map((t) => h('option', { value: t.code, selected: t.code === st.templateCode }, t.name))
        : [h('option', { value: '' }, '(템플릿 없음)')]));
    setupWrap.appendChild(h('div', { class: 'panel', style: 'margin-bottom:14px' },
      h('div', { class: 'panel-body', style: 'display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap' },
        field('솔루션', solSel), field('템플릿', tplSel),
        h('button', { class: 'btn btn-navy', onclick: apply }, st.applied ? '템플릿 다시 적용' : '템플릿 적용'),
        st.applied ? h('span', { class: 'page-sub' }, `적용됨: ${st.applied.name}`) : null)));
  }

  async function apply() {
    if (!st.templateCode) return toast('템플릿을 선택하세요.', 'err');
    if (st.blocks.length && !confirm('현재 입력 내용을 버리고 템플릿을 다시 적용할까요?')) return;
    clear(bodyWrap).appendChild(loading());
    let d;
    try { d = await api.applyTemplate(st.templateCode); }
    catch (err) { clear(bodyWrap).appendChild(h('div', { class: 'empty' }, err.message)); return; }
    st.applied = d.template;
    st.laborYear = d.labor_year;
    st.blocks = d.blocks.map((b) => ({
      ...b,
      items: (b.items || []).map((it) => ({ ...it, proposed_price: it.base_price || 0 })),
      labor: (b.labor || []).map((l) => ({ ...l, proposed_price: l.base_price || 0 })),
    }));
    st.conds = (d.conditions || []).map((t) => ({ text: t }));
    st.info.purpose = st.info.purpose || `${store.solutionName(d.template.solution)} 구축 견적`;
    renderSetup();
    renderBody();
  }

  // ── 계산 ──
  const els = {};
  function recalc() {
    let build = 0;
    for (const b of st.blocks) {
      let sub = 0;
      if (b.block_code === 'LABOR') for (const l of b.labor) { l.amount = Math.round(num(l.proposed_price) * num(l.mm)); sub += l.amount; }
      else for (const it of b.items) { it.amount = Math.round(num(it.proposed_price) * num(it.qty)); sub += it.amount; }
      b._sub = sub; build += sub;
      if (b._subEl) b._subEl.textContent = won(sub);
      if (b._rows) b._rows.forEach((fn) => fn());
    }
    const final = computeFinal(build);
    const dcAmt = build - final;
    let supply, vat, grand;
    if (st.info.vat_mode === 'INCLUDED') { grand = final; supply = Math.round(final / 1.1); vat = final - supply; }
    else { supply = final; vat = Math.round(final * 0.1); grand = final + vat; }
    st._calc = { build, final, dcAmt, supply, vat, grand };
    if (els.build) els.build.textContent = won(build);
    if (els.dc) els.dc.textContent = dcAmt ? '-' + won(dcAmt) : '0';
    if (els.final) els.final.textContent = won(final);
    if (els.supply) els.supply.textContent = won(supply);
    if (els.vat) els.vat.textContent = won(vat);
    if (els.grand) els.grand.textContent = won(grand) + '원';
    if (els.vatLbl) els.vatLbl.textContent = st.info.vat_mode === 'INCLUDED' ? '부가세 (포함)' : '부가세 (별도, 10%)';
  }
  function computeFinal(build) {
    if (st.dc.mode === 'RATE') return build - Math.round(build * num(st.dc.value) / 100);
    if (st.dc.mode === 'AMOUNT') return build - Math.round(num(st.dc.value));
    if (st.dc.mode === 'FINAL') return Math.round(num(st.dc.value));
    return build;
  }

  function renderBody() {
    clear(bodyWrap);
    // 헤더 정보
    const inp = (key, opt = {}) => h('input', { class: 'input', type: opt.type || 'text', value: st.info[key], style: opt.style || '', onchange: (e) => { st.info[key] = e.target.value; } });
    const vatSel = h('select', { class: 'select', onchange: (e) => { st.info.vat_mode = e.target.value; recalc(); } },
      h('option', { value: 'EXCLUDED', selected: st.info.vat_mode === 'EXCLUDED' }, '별도'),
      h('option', { value: 'INCLUDED', selected: st.info.vat_mode === 'INCLUDED' }, '포함'));
    bodyWrap.appendChild(h('div', { class: 'panel', style: 'margin-bottom:14px' },
      h('div', { class: 'panel-body', style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px' },
        field('고객사명', inp('customer_name')), field('견적용도', inp('purpose')), field('담당자', inp('customer_contact')),
        field('견적일자', inp('quote_date', { type: 'date' })), field('견적유효일', inp('valid_until', { type: 'date' })), field('결제조건', inp('pay_terms')),
        field('연락처', inp('phone')), field('이메일', inp('email')), field('부가세', vatSel))));

    const layout = h('div', { style: 'display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap' });
    const main = h('div', { style: 'flex:1;min-width:560px' });
    const aside = h('aside', { style: 'width:300px;flex:none' });
    layout.appendChild(main); layout.appendChild(aside);
    bodyWrap.appendChild(layout);

    for (const b of st.blocks) main.appendChild(blockCard(b));
    aside.appendChild(summaryPanel());

    // 견적조건
    const condWrap = h('div', { style: 'margin-top:16px' });
    const list = h('div', {});
    st.conds.forEach((c) => list.appendChild(condRow(c)));
    condWrap.appendChild(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, '▣ 견적조건'),
      h('div', { style: 'padding:12px 14px' }, list,
        h('button', { class: 'btn btn-sm', style: 'margin-top:8px', onclick: () => { st.conds.push({ text: '' }); const r = condRow(st.conds[st.conds.length - 1]); list.appendChild(r); } }, '＋ 조건 추가'))));
    bodyWrap.appendChild(condWrap);
    recalc();
  }

  function condRow(c) {
    const row = h('div', { style: 'display:flex;gap:6px;margin-bottom:6px' },
      h('input', { class: 'input', style: 'flex:1', value: c.text, oninput: (e) => { c.text = e.target.value; } }),
      h('button', { class: 'btn btn-sm btn-danger', onclick: () => { const i = st.conds.indexOf(c); if (i >= 0) { st.conds.splice(i, 1); row.remove(); } } }, '×'));
    return row;
  }

  function blockCard(b) {
    b._rows = [];
    const tb = h('tbody');
    const isLabor = b.block_code === 'LABOR';
    const rows = isLabor ? b.labor : b.items;
    rows.forEach((r) => tb.appendChild(rowEl(b, r, isLabor)));
    b._subEl = h('strong', { class: 'num' });
    const addBtn = h('button', { class: 'btn btn-sm', style: 'margin:8px 0 0', onclick: () => {
      const nr = isLabor ? { role_code: 'DEV', role_name: '', task: '', mm: 1, base_price: null, proposed_price: 0, amount: 0 }
        : { item_code: '', name: '항목', spec: '', qty: 1, base_price: null, proposed_price: 0, amount: 0 };
      rows.push(nr); tb.appendChild(rowEl(b, nr, isLabor)); recalc();
    } }, isLabor ? '＋ 인력 추가' : '＋ 항목 추가');
    return h('div', { class: 'panel', style: 'margin-bottom:12px' },
      h('div', { class: 'panel-head', style: 'display:flex;align-items:center;gap:8px' },
        h('strong', {}, b.name),
        b.recurring ? h('span', { class: 'badge badge-yellow' }, '월정액') : null,
        h('span', { class: 'num', style: 'margin-left:auto' }, '소계 ', b._subEl)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid master-grid' },
        h('thead', {}, h('tr', {},
          h('th', {}, isLabor ? '역할' : '모듈'), h('th', {}, isLabor ? '세부내역' : '세부기능'),
          h('th', { class: 'num' }, isLabor ? '공수(MM)' : '수량'),
          h('th', { class: 'num' }, '기준단가'), h('th', { class: 'num' }, '제안단가'), h('th', { class: 'num' }, '제안금액'), h('th', {}, ''))),
        tb)),
      h('div', { style: 'padding:0 14px 12px' }, addBtn));
  }

  function rowEl(b, r, isLabor) {
    const amtCell = h('td', { class: 'num' });
    const qtyKey = isLabor ? 'mm' : 'qty';
    const nameInp = isLabor
      ? h('input', { class: 'input', style: 'width:100%', value: r.role_name || '', oninput: (e) => { r.role_name = e.target.value; } })
      : h('input', { class: 'input', style: 'width:100%', value: r.name || '', oninput: (e) => { r.name = e.target.value; } });
    const specInp = h('input', { class: 'input', style: 'width:100%', value: (isLabor ? r.task : r.spec) || '', oninput: (e) => { if (isLabor) r.task = e.target.value; else r.spec = e.target.value; } });
    const qtyInp = h('input', { class: 'input', type: 'number', step: 'any', style: 'width:70px;text-align:right', value: r[qtyKey], oninput: (e) => { r[qtyKey] = e.target.value; recalc(); } });
    const propInp = h('input', { class: 'input', type: 'number', step: 'any', style: 'width:110px;text-align:right;background:#E8EFF9;color:var(--accent);font-weight:600', value: r.proposed_price, oninput: (e) => { r.proposed_price = e.target.value; recalc(); } });
    const tr = h('tr', {},
      h('td', {}, isLabor ? h('span', { class: 'tag' }, r.role_code) : (r.item_code ? h('div', {}, h('strong', {}, r.name), h('div', { class: 'page-sub' }, r.item_code)) : nameInp)),
      h('td', {}, isLabor ? nameInp : specInp),
      h('td', { class: 'num' }, qtyInp),
      h('td', { class: 'num' }, r.base_price != null ? won(r.base_price) : h('span', { class: 'page-sub' }, '-')),
      h('td', { class: 'num' }, propInp),
      amtCell,
      h('td', { class: 'center' }, h('button', { class: 'btn btn-sm btn-danger', onclick: () => { const arr = isLabor ? b.labor : b.items; const i = arr.indexOf(r); if (i >= 0) { arr.splice(i, 1); tr.remove(); recalc(); } } }, '×')));
    b._rows.push(() => { amtCell.textContent = won(r.amount); });
    return tr;
  }

  function summaryPanel() {
    els.build = h('strong', { class: 'num' }); els.dc = h('span', { class: 'num' }); els.final = h('strong', { class: 'num' });
    els.supply = h('span', { class: 'num' }); els.vat = h('strong', { class: 'num' }); els.grand = h('strong', { class: 'num', style: 'font-size:18px;color:var(--accent)' });
    els.vatLbl = h('span', { style: 'color:var(--text-sub)' }, '부가세 (별도, 10%)');
    const dcModeSel = h('select', { class: 'select', style: 'width:100%;height:32px', onchange: (e) => { st.dc.mode = e.target.value; recalc(); } },
      h('option', { value: 'RATE' }, '할인율(%)'), h('option', { value: 'AMOUNT' }, '할인액(원)'), h('option', { value: 'FINAL' }, '최종금액 직접'));
    const dcValInp = h('input', { class: 'input', type: 'number', step: 'any', value: st.dc.value, style: 'width:100%;height:32px;text-align:right;box-sizing:border-box', oninput: (e) => { st.dc.value = e.target.value; recalc(); } });
    const line = () => h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:10px 0' });
    return h('div', { class: 'panel', style: 'position:sticky;top:16px;padding:16px' },
      h('div', { style: 'font-weight:800;margin-bottom:12px' }, '견적 합계'),
      srow('구축금액 (블록 소계 합)', els.build), line(),
      h('div', { style: 'margin:10px 0' }, h('div', { style: 'font-size:12px;color:var(--text-sub);font-weight:700' }, '특별 DC'),
        h('div', { style: 'display:flex;gap:6px;margin-top:4px' }, h('div', { style: 'flex:1;min-width:0' }, dcModeSel), h('div', { style: 'flex:1;min-width:0' }, dcValInp))),
      srow('DC 금액', els.dc), srow('최종견적금액', els.final), line(),
      srow('공급가액', els.supply), srow(els.vatLbl, els.vat), line(),
      srow('총견적가', els.grand),
      h('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px', onclick: save }, '견적 저장'));
  }
  function srow(label, valEl) {
    return h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin:6px 0;font-size:13px' },
      typeof label === 'string' ? h('span', { style: 'color:var(--text-sub)' }, label) : label, valEl);
  }

  async function save() {
    if (!st.applied) return toast('먼저 템플릿을 적용하세요.', 'err');
    const items = [];
    for (const b of st.blocks) {
      if (b.block_code === 'LABOR') continue;
      for (const it of b.items) items.push({ block_code: b.block_code, item_code: it.item_code || null, category: b.name, name: it.name, spec: it.spec || null, qty: num(it.qty), unit: it.unit || null, base_price: it.base_price, proposed_price: num(it.proposed_price), amount: it.amount });
    }
    const laborBlk = st.blocks.find((b) => b.block_code === 'LABOR');
    const labor = laborBlk ? laborBlk.labor.map((l) => ({ role_code: l.role_code, role_name: l.role_name, task: l.task || null, mm: num(l.mm), base_price: l.base_price, proposed_price: num(l.proposed_price), amount: l.amount })) : [];

    const c = st._calc;
    const dcValue = Math.max(0, c.build - (st.info.vat_mode === 'INCLUDED' ? Math.round(c.final / 1.1) : c.final));
    const memo = [
      st.info.purpose ? '[견적용도] ' + st.info.purpose : '', '[결제조건] ' + (st.info.pay_terms || '-'),
      '[부가세] ' + (st.info.vat_mode === 'INCLUDED' ? '포함' : '별도'),
      '[특별DC] ' + (st.dc.mode === 'RATE' ? `할인율 ${num(st.dc.value)}%` : st.dc.mode === 'AMOUNT' ? `할인액 ${won(st.dc.value)}원` : `최종금액 직접 ${won(st.dc.value)}원`),
      st.info.phone ? '[연락처] ' + st.info.phone : '', st.info.email ? '[이메일] ' + st.info.email : '',
    ].filter(Boolean).join('\n');

    const payload = {
      quote_date: st.info.quote_date, valid_until: st.info.valid_until || null,
      customer_name: st.info.customer_name || null, customer_contact: st.info.customer_contact || null, memo,
      discount: dcValue > 0 ? { type: 'AMOUNT', value: dcValue } : { type: null, value: 0 },
      conditions: st.conds.filter((c2) => c2.text.trim()).map((c2) => ({ text: c2.text, auto: false, edited: true })),
      sections: [{ solution: st.applied.solution, deployment: st.applied.deployment, template_code: st.applied.code, brand: st.applied.brand, companyClass: 'ENT', items, labor }],
    };
    try {
      const { quote } = await api.createQuote(payload);
      toast('견적이 저장되었습니다.', 'ok');
      location.hash = `#/quotes/${quote.id}`;
    } catch (err) { toast(err.message, 'err'); }
  }

  function field(label, el) { return h('div', { class: 'field', style: 'display:flex;flex-direction:column;gap:4px' }, h('span', { style: 'font-size:12px;color:var(--text-sub);font-weight:700' }, label), el); }
}
