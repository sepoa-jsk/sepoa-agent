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
    dc: { mode: 'TARGET', value: 0 },   // 실측 견적서는 "최종 얼마"로 떨어뜨리는 방식
    roundUnit: 100000,                  // 십만단위 절사(실측 공통)
    hasLaborPlan: false,
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
    st.roundUnit = d.round_unit ?? 100000;
    st.hasLaborPlan = !!d.template.has_labor_plan;
    // SUMMARY 는 계산 전용 블록이라 입력 카드를 만들지 않는다
    st.blocks = d.blocks.filter((b) => b.block_code !== 'SUMMARY').map((b) => ({
      ...b,
      items: (b.items || []).map((it) => ({ ...it, proposed_price: it.base_price || 0 })),
      labor: (b.labor || []).map((l) => ({ ...l, proposed_price: l.base_price || 0, month_alloc: l.month_alloc || {} })),
    }));
    if (d.unregistered?.length) {
      toast(`가격마스터 미등록 모듈 ${d.unregistered.length}건 — 기준단가가 비어 있습니다: ${d.unregistered.join(', ')}`, 'err');
    }
    st.conds = (d.conditions || []).map((t) => ({ text: t }));
    st.info.purpose = st.info.purpose || `${store.solutionName(d.template.solution)} 구축 견적`;
    renderSetup();
    renderBody();
  }

  // ── 계산 ──
  const els = {};
  // 서버 엔진(lib/quote-engine.calcQuoteBlocks)과 같은 순서로 계산한다.
  //   블록소계 합 → 특별DC → 절사(십만단위) → VAT. 일시불/월(recurring) 분리.
  function recalc() {
    let onetime = 0, monthly = 0;
    const laborErrors = [];
    for (const b of st.blocks) {
      let sub = 0;
      for (const it of b.items || []) { it.amount = Math.round(num(it.proposed_price) * num(it.qty)); sub += it.amount; }
      for (const l of b.labor || []) {
        l.amount = Math.round(num(l.proposed_price) * num(l.mm));
        sub += l.amount;
        const alloc = l.month_alloc || {};
        const keys = Object.keys(alloc);
        if (keys.length) {
          const s = keys.reduce((a, k) => a + num(alloc[k]), 0);
          if (Math.abs(s - num(l.mm)) > 0.001) laborErrors.push(`${l.role_label || l.role_code}: 배분 ${s} ≠ 공수 ${num(l.mm)}MM`);
        }
      }
      b._sub = sub;
      if (b.recurring) monthly += sub; else onetime += sub;
      if (b._subEl) b._subEl.textContent = won(sub);
      if (b._rows) b._rows.forEach((fn) => fn());
    }
    const dcAmt = computeDc(onetime);
    const afterDc = onetime - dcAmt;
    const unit = num(st.roundUnit);
    const finalOnetime = unit > 0 ? Math.floor(afterDc / unit) * unit : Math.round(afterDc);
    const vat = Math.round(finalOnetime * 0.1);

    st._calc = { onetime, monthly, dcAmt, final: finalOnetime, vat, grand: finalOnetime + vat, laborErrors };
    const set = (el, v) => { if (el) el.textContent = v; };
    set(els.build, won(onetime));
    set(els.dc, dcAmt ? '-' + won(dcAmt) : '0');
    set(els.trunc, afterDc - finalOnetime ? '-' + won(afterDc - finalOnetime) : '0');
    set(els.final, won(finalOnetime));
    set(els.vat, won(vat));
    set(els.grand, won(finalOnetime) + '원');
    set(els.monthly, monthly ? won(monthly) + '원' : '-');
    if (els.monthlyRow) els.monthlyRow.style.display = monthly ? '' : 'none';
    if (els.laborWarn) {
      els.laborWarn.textContent = laborErrors.length ? '인력투입계획 확인: ' + laborErrors.join(' / ') : '';
      els.laborWarn.style.display = laborErrors.length ? '' : 'none';
    }
  }
  // 특별DC — 서버의 computeDiscount 와 동일 규칙
  function computeDc(base) {
    const v = num(st.dc.value);
    if (!v) return 0;
    if (st.dc.mode === 'RATE') return Math.round(base * v / 100);
    if (st.dc.mode === 'AMOUNT') return Math.round(v);
    if (st.dc.mode === 'TARGET') return Math.max(0, base - Math.round(v));
    return 0;
  }

  function renderBody() {
    clear(bodyWrap);
    // 헤더 정보
    const inp = (key, opt = {}) => h('input', { class: 'input', type: opt.type || 'text', value: st.info[key], style: opt.style || '', onchange: (e) => { st.info[key] = e.target.value; } });
    // 부가세는 실측 견적서 전부 '별도' 표기 — 선택지를 두지 않는다(PLAN_PHASE5_REV §6)
    const vatLbl = h('div', { class: 'input', style: 'display:flex;align-items:center;background:var(--bg);color:var(--text-2)' }, '별도 (10%)');
    bodyWrap.appendChild(h('div', { class: 'panel', style: 'margin-bottom:14px' },
      h('div', { class: 'panel-body', style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px' },
        field('고객사명', inp('customer_name')), field('견적용도', inp('purpose')), field('담당자', inp('customer_contact')),
        field('견적일자', inp('quote_date', { type: 'date' })), field('견적유효일', inp('valid_until', { type: 'date' })), field('결제조건', inp('pay_terms')),
        field('연락처', inp('phone')), field('이메일', inp('email')), field('부가세', vatLbl))));

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
        h('button', { class: 'btn btn-sm', style: 'margin-top:8px', onclick: () => { st.conds.push({ text: '' }); const r = condRow(st.conds[st.conds.length - 1]); list.appendChild(r); } }, '+ 조건 추가'))));
    bodyWrap.appendChild(condWrap);
    recalc();
  }

  function condRow(c) {
    const row = h('div', { style: 'display:flex;gap:6px;margin-bottom:6px' },
      h('input', { class: 'input', style: 'flex:1', value: c.text, oninput: (e) => { c.text = e.target.value; } }),
      h('button', { class: 'btn btn-sm btn-danger', onclick: () => { const i = st.conds.indexOf(c); if (i >= 0) { st.conds.splice(i, 1); row.remove(); } } }, '×'));
    return row;
  }

  // 한 블록에 모듈 표와 인건비 표가 함께 올 수 있다(SaaS·PCloud 셋업은 MM 산정).
  function blockCard(b) {
    b._rows = [];
    b._subEl = h('strong', { class: 'num' });
    const card = h('div', { class: 'panel', style: 'margin-bottom:12px' },
      h('div', { class: 'panel-head', style: 'display:flex;align-items:center;gap:8px' },
        h('strong', {}, b.name),
        b.recurring ? h('span', { class: 'badge badge-yellow' }, '월정액') : null,
        h('span', { class: 'num', style: 'margin-left:auto' }, '소계 ', b._subEl)));

    const table = (isLabor) => {
      const rows = isLabor ? b.labor : b.items;
      const tb = h('tbody');
      rows.forEach((r) => tb.appendChild(rowEl(b, r, isLabor)));
      const addBtn = h('button', { class: 'btn btn-sm', style: 'margin:8px 0 0', onclick: () => {
        const nr = isLabor
          ? { role_code: 'DEV', role_label: '', role_name: '', grade: '', task: '', mm: 1, base_price: null, proposed_price: 0, amount: 0, month_alloc: {} }
          : { item_code: '', category: '', name: '항목', spec: '', qty: 1, base_price: null, proposed_price: 0, amount: 0 };
        rows.push(nr); tb.appendChild(rowEl(b, nr, isLabor)); recalc();
      } }, isLabor ? '+ 인력 추가' : '+ 항목 추가');
      // 엑셀 붙여넣기 — "모듈코드[TAB]수량" 행을 그대로 붙여 넣어 일괄 편입
      const pasteBtn = isLabor ? null : h('button', { class: 'btn btn-sm', style: 'margin:8px 0 0 6px', onclick: () => pasteInto(b, rows, tb) }, '엑셀 붙여넣기');

      return h('div', {},
        (isLabor && b.items.length) ? h('div', { class: 'page-sub', style: 'padding:10px 14px 0' }, '산정 근거(공수)') : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid master-grid' },
          h('thead', {}, h('tr', {},
            h('th', {}, isLabor ? '역할(등급)' : '구분/모듈'), h('th', {}, isLabor ? '세부내역' : '세부기능'),
            h('th', { class: 'num' }, isLabor ? '공수(MM)' : '수량'),
            h('th', { class: 'num' }, '기준단가'), h('th', { class: 'num' }, '제안단가'),
            h('th', { class: 'num' }, b.recurring ? '제안금액(월)' : '제안금액'),
            st.hasLaborPlan && isLabor ? h('th', {}, '월별 배분(M/M1/M2/M3)') : null,
            h('th', {}, ''))),
          tb)),
        h('div', { style: 'padding:0 14px 12px' }, addBtn, pasteBtn));
    };

    if (b.items) card.appendChild(table(false));
    if (b.labor) card.appendChild(table(true));
    return card;
  }

  // 엑셀에서 복사한 "모듈코드 [TAB|,] 수량" 목록을 블록에 편입한다.
  // 이미 있는 코드는 수량만 갱신, 없는 코드는 새 행으로 추가(기준단가는 마스터에서 조회).
  async function pasteInto(b, rows, tb) {
    const raw = prompt('엑셀에서 복사한 내용을 붙여 넣으세요.\n형식: 모듈코드[탭]수량 (한 줄에 하나)');
    if (!raw) return;
    const parsed = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [code, qty] = line.split(/\t|,|\s{2,}/).map((v) => (v || '').trim());
      return { code, qty: qty === undefined || qty === '' ? 1 : Number(qty) };
    }).filter((p) => p.code && !Number.isNaN(p.qty));
    if (!parsed.length) return toast('인식된 행이 없습니다.', 'err');

    // 신규 코드의 기준단가/명칭을 가격마스터에서 조회
    let master = {};
    try {
      const { items } = await api.pricing(st.applied?.solution, undefined, true);
      master = Object.fromEntries((items || []).map((i) => [i.code, i]));
    } catch { /* 마스터 조회 실패해도 코드/수량은 넣는다 */ }

    let added = 0, updated = 0, unknown = [];
    for (const p of parsed) {
      const exist = rows.find((r) => r.item_code === p.code);
      if (exist) { exist.qty = p.qty; updated++; continue; }
      const m = master[p.code];
      if (!m) unknown.push(p.code);
      const nr = {
        item_code: p.code, category: m?.category || null, name: m?.name || p.code, spec: m?.spec || '',
        qty: p.qty, unit: m?.unit || null,
        base_price: m?.base_price != null ? Number(m.base_price) : null,
        proposed_price: m?.base_price != null ? Number(m.base_price) : 0, amount: 0,
      };
      rows.push(nr); tb.appendChild(rowEl(b, nr, false)); added++;
    }
    recalc();
    toast(`추가 ${added} / 수량갱신 ${updated}${unknown.length ? ` · 마스터 미등록 ${unknown.length}건(${unknown.join(', ')})` : ''}`,
      unknown.length ? 'err' : 'ok');
  }

  function rowEl(b, r, isLabor) {
    const amtCell = h('td', { class: 'num' });
    const qtyKey = isLabor ? 'mm' : 'qty';
    const nameInp = isLabor
      ? h('input', { class: 'input', style: 'width:100%', value: r.role_label || r.role_name || '', oninput: (e) => { r.role_label = e.target.value; } })
      : h('input', { class: 'input', style: 'width:100%', value: r.name || '', oninput: (e) => { r.name = e.target.value; } });
    // 인력투입계획(옵션) — Σ배분 = 공수 여야 하며 recalc 에서 검증한다
    const allocInp = st.hasLaborPlan && isLabor
      ? h('input', {
          class: 'input', style: 'width:160px', placeholder: '0.25,0.25,0.25,0.25',
          value: Object.values(r.month_alloc || {}).join(','),
          oninput: (e) => {
            const parts = e.target.value.split(',').map((v) => v.trim()).filter((v) => v !== '');
            r.month_alloc = {};
            parts.forEach((v, i) => { r.month_alloc[i === 0 ? 'M' : 'M' + i] = Number(v) || 0; });
            recalc();
          },
        })
      : null;
    const specInp = h('input', { class: 'input', style: 'width:100%', value: (isLabor ? r.task : r.spec) || '', oninput: (e) => { if (isLabor) r.task = e.target.value; else r.spec = e.target.value; } });
    const qtyInp = h('input', { class: 'input', type: 'number', step: 'any', style: 'width:70px;text-align:right', value: r[qtyKey], oninput: (e) => { r[qtyKey] = e.target.value; recalc(); } });
    const propInp = h('input', { class: 'input', type: 'number', step: 'any', style: 'width:110px;text-align:right;background:#E8EFF9;color:var(--primary);font-weight:600', value: r.proposed_price, oninput: (e) => { r.proposed_price = e.target.value; recalc(); } });
    const tr = h('tr', {},
      h('td', {}, isLabor
        ? h('div', { style: 'display:flex;flex-direction:column;gap:3px' },
            h('div', {}, h('span', { class: 'tag' }, r.role_code), r.grade ? h('span', { class: 'page-sub', style: 'margin-left:4px' }, r.grade) : null),
            nameInp)
        : (r.item_code
            ? h('div', {}, r.category ? h('div', { class: 'page-sub' }, r.category) : null, h('strong', {}, r.name), h('div', { class: 'page-sub' }, r.item_code))
            : nameInp)),
      h('td', {}, specInp),
      h('td', { class: 'num' }, qtyInp, r.unit ? h('span', { class: 'page-sub' }, ' ' + r.unit) : null),
      h('td', { class: 'num' }, r.base_price != null ? won(r.base_price) : h('span', { class: 'page-sub' }, '-')),
      h('td', { class: 'num' }, propInp),
      amtCell,
      allocInp ? h('td', {}, allocInp) : null,
      h('td', { class: 'center' }, h('button', { class: 'btn btn-sm btn-danger', onclick: () => { const arr = isLabor ? b.labor : b.items; const i = arr.indexOf(r); if (i >= 0) { arr.splice(i, 1); tr.remove(); recalc(); } } }, '×')));
    b._rows.push(() => { amtCell.textContent = won(r.amount); });
    return tr;
  }

  function summaryPanel() {
    els.build = h('strong', { class: 'num' }); els.dc = h('span', { class: 'num' });
    els.trunc = h('span', { class: 'num' }); els.final = h('strong', { class: 'num' });
    els.vat = h('strong', { class: 'num' });
    els.grand = h('strong', { class: 'num', style: 'font-size:18px;color:var(--primary)' });
    els.monthly = h('strong', { class: 'num', style: 'font-size:16px;color:var(--primary)' });
    els.laborWarn = h('div', { style: 'display:none;margin-top:10px;padding:8px;background:#FFF7E0;border:1px solid #e0a800;font-size:12px;line-height:1.5' });

    const dcModeSel = h('select', { class: 'select', style: 'width:100%;height:32px', onchange: (e) => { st.dc.mode = e.target.value; recalc(); } },
      h('option', { value: 'TARGET', selected: st.dc.mode === 'TARGET' }, '최종금액 지정'),
      h('option', { value: 'AMOUNT', selected: st.dc.mode === 'AMOUNT' }, '할인액(원)'),
      h('option', { value: 'RATE', selected: st.dc.mode === 'RATE' }, '할인율(%)'));
    const dcValInp = h('input', { class: 'input', type: 'number', step: 'any', value: st.dc.value, style: 'width:100%;height:32px;text-align:right;box-sizing:border-box', oninput: (e) => { st.dc.value = e.target.value; recalc(); } });
    const roundSel = h('select', { class: 'select', style: 'width:100%;height:32px', onchange: (e) => { st.roundUnit = Number(e.target.value); recalc(); } },
      h('option', { value: '100000' }, '십만단위 절사'),
      h('option', { value: '10000' }, '만단위 절사'),
      h('option', { value: '0' }, '절사 안 함'));
    const line = () => h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:10px 0' });

    els.monthlyRow = h('div', { style: 'display:none' },
      line(), srow('월 사용료 (VAT 별도)', els.monthly),
      h('div', { class: 'page-sub', style: 'font-size:11px' }, '월정액은 특별DC·절사 대상이 아닙니다.'));

    return h('div', { class: 'panel', style: 'position:sticky;top:16px;padding:16px' },
      h('div', { style: 'font-weight:800;margin-bottom:12px' }, '견적 합계'),
      srow('일시불 소계 (블록 합)', els.build),
      h('div', { style: 'margin:10px 0' }, h('div', { style: 'font-size:12px;color:var(--text-2);font-weight:700' }, '특별 DC'),
        h('div', { style: 'display:flex;gap:6px;margin-top:4px' }, h('div', { style: 'flex:1;min-width:0' }, dcModeSel), h('div', { style: 'flex:1;min-width:0' }, dcValInp))),
      srow('DC 금액', els.dc),
      h('div', { style: 'margin:10px 0' }, h('div', { style: 'font-size:12px;color:var(--text-2);font-weight:700' }, '절사'), roundSel),
      srow('절사액', els.trunc), line(),
      srow('최종견적금액 (일시불)', els.final),
      srow('부가세 (별도, 10%)', els.vat), line(),
      srow('총견적가', els.grand),
      els.monthlyRow,
      els.laborWarn,
      h('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px', onclick: save }, '견적 저장'));
  }
  function srow(label, valEl) {
    return h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin:6px 0;font-size:13px' },
      typeof label === 'string' ? h('span', { style: 'color:var(--text-2)' }, label) : label, valEl);
  }

  async function save() {
    if (!st.applied) return toast('먼저 템플릿을 적용하세요.', 'err');
    if (st._calc?.laborErrors?.length && !confirm('인력투입계획 배분 합계가 공수와 맞지 않습니다. 그래도 저장할까요?')) return;

    // 서버는 blocks 구조를 그대로 받아 sq_quote_blocks 로 저장한다(5-C).
    const blocks = st.blocks.map((b) => ({
      block_code: b.block_code, name: b.name, recurring: b.recurring ? 1 : 0,
      items: (b.items || []).map((it) => ({
        item_code: it.item_code || null, category: it.category || null, name: it.name,
        spec: it.spec || null, qty: num(it.qty), unit: it.unit || null,
        base_price: it.base_price, proposed_price: num(it.proposed_price), amount: it.amount,
      })),
      labor: (b.labor || []).map((l) => ({
        role_code: l.role_code, role_name: l.role_name || null, role_label: l.role_label || null,
        grade: l.grade || null, task: l.task || null, mm: num(l.mm),
        base_price: l.base_price, proposed_price: num(l.proposed_price), amount: l.amount,
        month_alloc: l.month_alloc && Object.keys(l.month_alloc).length ? l.month_alloc : null,
      })),
    }));

    const memo = [
      st.info.purpose ? '[견적용도] ' + st.info.purpose : '', '[결제조건] ' + (st.info.pay_terms || '-'),
      '[특별DC] ' + (st.dc.mode === 'RATE' ? `할인율 ${num(st.dc.value)}%` : st.dc.mode === 'AMOUNT' ? `할인액 ${won(st.dc.value)}원` : `최종금액 지정 ${won(st.dc.value)}원`),
      st.info.phone ? '[연락처] ' + st.info.phone : '', st.info.email ? '[이메일] ' + st.info.email : '',
    ].filter(Boolean).join('\n');

    const payload = {
      quote_type: st.applied.quote_type || 'BUILD',
      deployment: st.applied.deployment, template_code: st.applied.code,
      solution: st.applied.solution, brand: st.applied.brand,
      quote_date: st.info.quote_date, valid_until: st.info.valid_until || null,
      customer_name: st.info.customer_name || null, customer_contact: st.info.customer_contact || null, memo,
      discount: num(st.dc.value) > 0 ? { type: st.dc.mode, value: num(st.dc.value) } : { type: null, value: 0 },
      round_unit: num(st.roundUnit),
      conditions: st.conds.filter((c2) => c2.text.trim()).map((c2) => ({ text: c2.text, auto: false, edited: true })),
      blocks,
    };
    try {
      const { quote } = await api.createQuote(payload);
      toast('견적이 저장되었습니다.', 'ok');
      location.hash = `#/quotes/${quote.id}`;
    } catch (err) { toast(err.message, 'err'); }
  }

  function field(label, el) { return h('div', { class: 'field', style: 'display:flex;flex-direction:column;gap:4px' }, h('span', { style: 'font-size:12px;color:var(--text-2);font-weight:700' }, label), el); }
}
