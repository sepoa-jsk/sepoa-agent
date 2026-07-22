import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, loading, clear, openModal } from '../ui.js';

// 세포아 견적서 양식 — 솔루션 + 시스템구축(인건비) 2섹션. 유지보수는 다음 단계.
// 모듈 단가=sq_modules.base_price, 인력 기준단가=협회노임단가 매핑(labor_standards),
// 네고율=sq_nego_rates. 저장 시 코드가 sq_price_items 에 없어 서버가 manual 라인으로
// 클라 단가/금액을 그대로 스냅샷 저장(supply/discount/vat/total 만 서버 재산출).
const COMPANY = { legal: '㈜세포아소프트', ceo: '이 희 림' };
const COMPANIES = [['ENT', '대기업'], ['PUBLIC', '공공기관'], ['FINANCE', '금융'], ['MID', '중견기업'], ['SMALL', '중소기업']];
const ONSITES = [['ONSITE', '상주'], ['REMOTE', '비상주']];

// 견적조건 기본 템플릿 (설정에 없을 때 폴백). {laborRate}{moduleRate}{onsiteLabel}{companyLabel} 치환.
const DEFAULT_COND_TEMPLATES = [
  { text: '프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.', auto: false },
  { text: '개발단가는 한국SW산업협회 노임 단가 기준 {laborRate}%를 적용하였습니다.', auto: true },
  { text: '동일서버 내 Company 추가시 License는 솔루션 공급가의 25%가 적용됩니다.(서버 분리시 50%)', auto: false },
  { text: '솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.', auto: false },
  { text: '본 프로젝트는 {onsiteLabel} 제안합니다. 업무 협의, 통합테스트 등 필요시에는 방문 진행합니다.', auto: true },
  { text: 'PKI툴킷은 서버 이중화 구성시 2식이 필요합니다.', auto: false },
];

// 협회 기준단가 (lib/labor-standard.js 와 동일: 중간 반올림 없이 합계만 반올림).
function calcStandardRate(std) {
  const avgRaw = Number(std.daily_rate) * Number(std.work_days || 20.5);
  const overhead = avgRaw * Number(std.overhead_rate || 1.1);
  const tech = (avgRaw + overhead) * Number(std.tech_rate || 0.2);
  return Math.round(avgRaw + overhead + tech);
}

const num = (v) => Number(v) || 0;
const pctOf = (rate) => num(rate) * 100;
const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(dateStr, days) {
  const d = new Date((dateStr || todayStr()) + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const S = {
  hdr: 'border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin-bottom:14px',
  hdrTitle: 'background:var(--accent);color:#fff;padding:10px 16px;font-weight:800;letter-spacing:2px;display:flex;justify-content:space-between;align-items:center',
  hdrGrid: 'display:grid;grid-template-columns:110px 1fr 110px 1fr;gap:0',
  hcell: 'padding:8px 12px;border-top:1px solid var(--line);border-right:1px solid var(--line);font-size:13px;display:flex;align-items:center;gap:8px',
  hkey: 'background:var(--bg);color:var(--text-sub);font-weight:700;font-size:12px',
  card: 'display:flex;gap:14px;flex-wrap:wrap;padding:14px 16px;background:var(--panel);border:0.5px solid var(--line);border-radius:var(--radius);margin-bottom:14px',
  field: 'display:flex;flex-direction:column;gap:4px',
  flabel: 'font-size:12px;color:var(--text-sub);font-weight:700',
  thead: 'background:var(--bg)',
  blockHead: 'display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px;border-bottom:1px solid var(--line)',
  rateEdit: 'height:26px;text-align:right;background:#E8EFF9;color:var(--accent);font-weight:600;width:56px',
  priceEdit: 'height:28px;text-align:right;background:#E8EFF9;color:var(--accent);font-weight:600;width:110px',
  qtyEdit: 'height:28px;text-align:right;width:60px',
  specEdit: 'height:28px;width:100%;min-width:130px',
  read: 'color:var(--text-sub)',
  hint: 'font-size:10px;color:#aaa',
  del: 'background:none;border:none;color:var(--red);cursor:pointer;font-size:15px;line-height:1',
  gubun: 'color:var(--text-sub);font-weight:700;font-size:12px;white-space:nowrap',
};

export async function renderEditor(root, { mode, id }) {
  const master = await store.getMaster();
  const solutions = master.solutions || [];
  const deployments = master.deployments || [];

  const cond = { solution: 'PROCURE', deployment: 'ONPREM', company: 'ENT', onsite: 'ONSITE' };
  const info = {
    customer_name: '', customer_contact: '', purpose: '', quote_date: todayStr(), valid_until: addDays(todayStr(), 30),
    pay_terms: '고객사 결제조건', vat_mode: 'EXCLUDED', // EXCLUDED(별도) / INCLUDED(포함)
    phone: '', email: '',
  };
  // 특별DC: mode RATE(%) | AMOUNT(원) | FINAL(최종금액 직접)
  const dc = { mode: 'RATE', value: 0 };
  let savedConditions = null; // 편집(edit) 시 저장된 견적조건

  if (mode === 'edit' && id) {
    try {
      const { quote } = await api.getQuote(id);
      info.customer_name = quote.customer_name || '';
      info.customer_contact = quote.customer_contact || '';
      info.quote_date = (quote.quote_date || todayStr()).slice(0, 10);
      info.valid_until = quote.valid_until ? String(quote.valid_until).slice(0, 10) : addDays(info.quote_date, 30);
      if (Array.isArray(quote.conditions)) savedConditions = quote.conditions;
      const s0 = quote.sections && quote.sections[0];
      if (s0) { cond.solution = s0.solution || cond.solution; cond.deployment = s0.deployment || cond.deployment; cond.company = s0.company_class || cond.company; }
    } catch { /* 새 견적 */ }
  }

  // 견적조건 템플릿 (설정에서). 없으면 기본값 폴백.
  let condTemplates = DEFAULT_COND_TEMPLATES;
  try {
    const { settings } = await api.getSettings();
    if (settings && settings.quote_condition_templates) {
      const p = JSON.parse(settings.quote_condition_templates);
      if (Array.isArray(p) && p.length) condTemplates = p;
    }
  } catch { /* 설정 없으면 기본값 */ }

  // 마스터
  let modulesAll = [], laborAll = [], negoRates = [];
  const stdIndex = {};
  let negoModule = 0, negoLabor = 0;
  let modRows = [], laborRows = []; // modRows: {m|bundle, spec, qty, applyRate|unitPrice}
  let condRows = [];                // 견적조건: {raw, text, auto, edited}

  const quoteYear = () => Number((info.quote_date || '').slice(0, 4)) || new Date().getFullYear();
  const findNego = (target) => {
    const r = negoRates.find((x) => x.target === target && x.company_key === cond.company && x.onsite_key === cond.onsite);
    return r ? num(r.rate) : 0;
  };
  function laborBaseRate(role) {
    const code = role.standard_role_code;
    if (code) { const std = stdIndex[quoteYear() + ':' + code]; if (std) return calcStandardRate(std); }
    return num(role.base_price);
  }

  // 재계산 refs
  let solSubEl, laborSubEl, mmSumEl, mSolEl, mLaborEl, mmMirror, totalEl, dcAmtEl, finalEl, supplyEl, vatEl, grandEl, vatLabelEl, quoteNoEl, validInp, grandTopEl;

  // ── 헤더(Quotation) ──
  const purposeInp = txt(info.purpose, (v) => { info.purpose = v; });
  const payInp = txt(info.pay_terms, (v) => { info.pay_terms = v; });
  const dateInp = txt(info.quote_date, (v) => {
    info.quote_date = v; info.valid_until = addDays(v, 30); validInp.value = info.valid_until;
    if (quoteNoEl) quoteNoEl.textContent = quoteNoPreview();
    recalc();
  }, 'date');
  validInp = txt(info.valid_until, (v) => { info.valid_until = v; }, 'date');
  const custInp = txt(info.customer_name, (v) => { info.customer_name = v; if (rcvEl) rcvEl.textContent = (v || '고객사') + ' 귀중'; });
  const vatSel = sel([['EXCLUDED', '별도'], ['INCLUDED', '포함']], info.vat_mode, (v) => { info.vat_mode = v; recalc(); });
  let rcvEl;

  const hdr = h('div', { style: S.hdr },
    h('div', { style: S.hdrTitle }, h('span', {}, 'Q U O T A T I O N'),
      (grandTopEl = h('span', { style: 'font-size:14px' }, ''))),
    h('div', { style: S.hdrGrid },
      hc('수신', (rcvEl = h('span', { style: 'font-weight:700' }, '고객사 귀중')), true),
      hc('견적번호', (quoteNoEl = h('span', { style: 'font-family:ui-monospace,Consolas,monospace;color:var(--text-sub)' }, ''))),
      hc('고객사명', custInp, true), hc('견적용도', purposeInp),
      hc('견적일자', dateInp, true), hc('결제조건', payInp),
      hc('견적유효일', validInp, true), hc('부가세', h('div', { style: 'display:flex;align-items:center;gap:6px' }, vatSel, h('span', { style: S.hint }, '별도/포함 전환'))),
      hc('담당자', txt(info.customer_contact, (v) => { info.customer_contact = v; }), true),
      hc('연락처/이메일', h('div', { style: 'display:flex;gap:6px' },
        txt(info.phone, (v) => { info.phone = v; }), txt(info.email, (v) => { info.email = v; }))),
      hc('공급자', h('span', {}, `${COMPANY.legal}  ·  대표이사 ${COMPANY.ceo}`), true),
      hc('', h('span', {}, '')),
    )
  );
  root.appendChild(hdr);
  quoteNoEl.textContent = quoteNoPreview();
  rcvEl.textContent = (info.customer_name || '고객사') + ' 귀중';

  // ── 조건 ──
  root.appendChild(h('div', { style: S.card },
    field('솔루션', sel(solutions.map((s) => [s.code, s.name || s.code]), cond.solution, (v) => { cond.solution = v; load(); })),
    field('구축형태', sel(deployments.map((d) => [d.code, d.name || d.code]), cond.deployment, (v) => { cond.deployment = v; load(); })),
    field('기업구분', sel(COMPANIES, cond.company, (v) => { cond.company = v; load(); })),
    field('상주여부', sel(ONSITES, cond.onsite, (v) => { cond.onsite = v; load(); }))
  ));

  // ── 본문 + 요약 ──
  const bodyWrap = h('div', { style: 'flex:1;min-width:600px;display:flex;flex-direction:column;gap:16px' });
  const asideWrap = h('aside', { style: 'width:300px;flex:none' });
  root.appendChild(h('div', { style: 'display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap' }, bodyWrap, asideWrap));

  // ── 견적조건 (합계 아래, 전체 폭) ──
  const condWrap = h('div', { style: 'margin-top:16px' });
  root.appendChild(condWrap);

  // ── 계산 ──
  function recalc() {
    let solSub = 0, laborSub = 0, mmSum = 0;
    modRows.forEach((r) => {
      const up = r.bundle ? Math.round(num(r.unitPrice)) : num(r.m.base_price) * (num(r.applyRate) / 100);
      const amt = Math.round(up * num(r.qty));
      r.amount = amt; solSub += amt;
      if (r.propCell) r.propCell.textContent = won(Math.round(up));
      if (r.amountCell) r.amountCell.textContent = won(amt);
    });
    laborRows.forEach((r) => {
      const base = laborBaseRate(r.role); r.base = base;
      const up = base * (num(r.applyRate) / 100);
      const amt = Math.round(up * num(r.qty));
      r.amount = amt; laborSub += amt; mmSum += num(r.qty);
      if (r.baseCell) r.baseCell.textContent = won(base);
      if (r.propCell) r.propCell.textContent = won(Math.round(up));
      if (r.amountCell) r.amountCell.textContent = won(amt);
    });
    setTxt(solSubEl, won(solSub)); setTxt(mSolEl, won(solSub));
    setTxt(laborSubEl, won(laborSub)); setTxt(mLaborEl, won(laborSub));
    setTxt(mmSumEl, num(mmSum).toFixed(1) + ' M/M'); setTxt(mmMirror, num(mmSum).toFixed(1) + ' M/M');

    const total = solSub + laborSub;          // 서버 supply(=Σamount)
    const final = computeFinal(total);        // 특별DC 적용 후 최종견적금액
    const dcAmt = total - final;
    let supply, vat, grand;
    if (info.vat_mode === 'INCLUDED') { grand = final; supply = Math.round(final / 1.1); vat = final - supply; }
    else { supply = final; vat = Math.round(final * 0.1); grand = final + vat; }
    setTxt(totalEl, won(total));
    setTxt(dcAmtEl, dcAmt ? '-' + won(dcAmt) : '0');
    setTxt(finalEl, won(final));
    setTxt(supplyEl, won(supply)); setTxt(vatEl, won(vat)); setTxt(grandEl, won(grand));
    setTxt(grandTopEl, '총견적가 ' + won(grand) + '원');
    setTxt(vatLabelEl, info.vat_mode === 'INCLUDED' ? '부가세 (포함)' : '부가세 (별도, 10%)');
  }
  function computeFinal(total) {
    if (dc.mode === 'RATE') return total - Math.round(total * num(dc.value) / 100);
    if (dc.mode === 'AMOUNT') return total - Math.round(num(dc.value));
    if (dc.mode === 'FINAL') return Math.round(num(dc.value)); // 최종금액 직접입력
    return total;
  }

  async function load() {
    clear(bodyWrap).appendChild(loading()); clear(asideWrap);
    if (cond.deployment !== 'ONPREM') {
      clear(bodyWrap).appendChild(h('div', { class: 'panel' }, h('div', { style: 'padding:24px' },
        h('div', { class: 'empty' }, 'SaaS 견적은 준비 중입니다. 온프레미스(ONPREM)를 선택하세요.'))));
      return;
    }
    let mods, labs, stds, negos;
    try {
      [mods, labs, stds, negos] = await Promise.all([
        api.masterList('modules', cond.solution), api.masterList('labor_roles'),
        api.masterList('labor_standards'), api.masterList('nego_rates'),
      ]);
    } catch (err) {
      clear(bodyWrap).appendChild(h('div', { class: 'panel' }, h('div', { style: 'padding:24px' },
        h('div', { class: 'empty' }, '데이터 로드 실패: ' + err.message)))); return;
    }
    modulesAll = (mods.rows || []).filter((m) => m.active);
    laborAll = (labs.rows || []).filter((m) => m.active);
    negoRates = negos.rows || [];
    for (const k of Object.keys(stdIndex)) delete stdIndex[k];
    (stds.rows || []).forEach((r) => { stdIndex[r.year + ':' + r.role_code] = r; });
    negoModule = findNego('MODULE'); negoLabor = findNego('LABOR');

    modRows = modulesAll.map((m) => ({ m, spec: m.note || '', qty: 1, applyRate: pctOf(negoModule) }));
    laborRows = laborAll.map((role) => ({ role, spec: '', qty: num(role.std_mm) || 1, applyRate: pctOf(negoLabor) }));

    clear(bodyWrap);
    bodyWrap.appendChild(moduleSection());
    bodyWrap.appendChild(laborSection());
    clear(asideWrap).appendChild(summaryPanel());
    recalc();
    refreshAutoConditions(); // 네고율/상주 변경 → auto·미수정 줄만 재치환
    renderConditions();
  }

  // ── 견적조건 ──
  function condCtx() {
    return {
      laborRate: Math.round(pctOf(negoLabor)),
      moduleRate: Math.round(pctOf(negoModule)),
      onsiteLabel: cond.onsite === 'ONSITE' ? '상주로' : '부분상주로',
      companyLabel: (COMPANIES.find(([c]) => c === cond.company) || [, ''])[1],
    };
  }
  function subst(text, ctx) {
    return String(text)
      .replace(/\{laborRate\}/g, ctx.laborRate)
      .replace(/\{moduleRate\}/g, ctx.moduleRate)
      .replace(/\{onsiteLabel\}/g, ctx.onsiteLabel)
      .replace(/\{companyLabel\}/g, ctx.companyLabel);
  }
  function initConditions() {
    if (savedConditions && savedConditions.length) {
      condRows = savedConditions.map((c) => ({ raw: c.text, text: c.text, auto: !!c.auto, edited: !!c.edited }));
    } else {
      condRows = condTemplates.map((t) => ({ raw: t.text, text: t.text, auto: !!t.auto, edited: false }));
    }
  }
  function refreshAutoConditions() {
    const ctx = condCtx();
    condRows.forEach((r) => { if (r.auto && !r.edited) r.text = subst(r.raw, ctx); });
  }
  function renderConditions() {
    clear(condWrap);
    const list = h('div', {});
    condRows.forEach((r) => list.appendChild(condRow(r)));
    condWrap.appendChild(h('div', { class: 'panel' },
      h('div', { style: S.blockHead },
        h('div', {}, h('strong', {}, '▣ 견적조건'),
          h('span', { class: 'page-sub', style: 'margin-left:8px' }, '자동(파랑) 문구는 네고율·상주여부에 따라 갱신됩니다. 직접 수정한 줄은 고정됩니다.')),
        h('span', {})),
      h('div', { style: 'padding:12px 14px' }, list,
        h('button', { class: 'add-section', style: 'margin-top:8px', onclick: () => { condRows.push({ raw: '', text: '', auto: false, edited: true }); renderConditions(); } }, '＋ 조건 추가'))));
  }
  function condRow(r) {
    const inp = h('input', { class: 'input', style: 'flex:1', value: r.text,
      oninput: (e) => { r.text = e.target.value; r.edited = true; } });
    return h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' },
      h('span', { style: 'color:var(--text-sub);width:16px' }, '-.'), inp,
      (r.auto && !r.edited) ? h('span', { class: 'badge badge-blue', title: '자동 갱신 문구' }, '자동') : null,
      h('button', { style: S.del, title: '삭제', onclick: () => { const i = condRows.indexOf(r); if (i >= 0) condRows.splice(i, 1); renderConditions(); } }, '×'));
  }

  // ── ▣ 솔루션 견적 ──
  function moduleSection() {
    const tb = h('tbody');
    modRows.forEach((r) => tb.appendChild(moduleRow(r)));
    solSubEl = h('strong', {});
    return h('div', { class: 'panel' },
      blockHead('▣ 솔루션 견적', `기준 네고율 ${pctOf(negoModule).toFixed(0)}%`, solSubEl),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid master-grid' },
        theadRow(['구분', '모듈', '세부기능', '수량(식)', '기준단가', '제안단가', '제안금액', '']), tb)),
      h('div', { style: 'padding:0 14px 14px;display:flex;gap:8px' },
        h('button', { class: 'add-section', style: 'flex:1', onclick: addModule }, '＋ 모듈 추가'),
        h('button', { class: 'add-section', style: 'flex:1', onclick: addBundle }, '＋ 묶음(1식) 추가')));
  }
  function moduleRow(r) {
    const amountCell = h('td', { class: 'num' }); const propCell = h('td', { class: 'num' });
    r.amountCell = amountCell;
    if (r.bundle) {
      // 묶음: 이름/단가 직접입력, 네고율 없음(1식 고정가)
      const priceInp = h('input', { class: 'input', type: 'number', step: 'any', style: S.priceEdit, value: r.unitPrice, oninput: (e) => { r.unitPrice = e.target.value; recalc(); } });
      r.propCell = null; // 제안단가 = 입력칸 자체
      return h('tr', {},
        h('td', {}, h('span', { style: S.gubun }, '묶음')),
        h('td', {}, h('input', { class: 'input', style: S.specEdit, value: r.name, oninput: (e) => { r.name = e.target.value; } })),
        h('td', {}, specInput(r)),
        h('td', { class: 'num' }, qtyInput(r, '1')),
        h('td', { class: 'num' }, h('span', { style: S.read }, '1식')),
        h('td', { class: 'num' }, priceInp),
        amountCell,
        h('td', { class: 'center' }, h('button', { style: S.del, title: '삭제', onclick: () => removeRow(modRows, r, moduleSection) }, '×')));
    }
    r.propCell = propCell;
    return h('tr', {},
      h('td', {}, h('span', { style: S.gubun }, '솔루션')),
      h('td', {}, h('strong', {}, r.m.name), r.m.required ? h('span', { class: 'badge badge-blue', style: 'margin-left:6px' }, '필수') : null),
      h('td', {}, specInput(r)),
      h('td', { class: 'num' }, qtyInput(r, '1')),
      h('td', { class: 'num' }, won(r.m.base_price)),
      propWithNego(r, propCell, negoModule),
      amountCell,
      h('td', { class: 'center' }, r.m.required ? h('span', { style: S.read, title: '필수 모듈' }, '🔒')
        : h('button', { style: S.del, title: '삭제', onclick: () => removeRow(modRows, r, moduleSection) }, '×')));
  }

  // ── ▣ 시스템 구축 견적(인건비) ──
  function laborSection() {
    const tb = h('tbody');
    laborRows.forEach((r) => tb.appendChild(laborRow(r)));
    laborSubEl = h('strong', {}); mmSumEl = h('span', { class: 'page-sub' });
    return h('div', { class: 'panel' },
      h('div', { style: S.blockHead },
        h('div', {}, h('strong', {}, '▣ 시스템 구축 견적 (인건비)'),
          h('span', { class: 'page-sub', style: 'margin-left:8px' }, `기준 네고율 ${pctOf(negoLabor).toFixed(0)}% · 공수합 `), mmSumEl),
        h('div', { class: 'num' }, '소계 ', laborSubEl)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid master-grid' },
        theadRow(['구분', '역할(등급)', '세부내역', '공수(MM)', '기준단가', '제안단가', '제안금액', '']), tb)),
      h('div', { style: 'padding:0 14px 14px' },
        h('button', { class: 'add-section', onclick: addLabor }, '＋ 인력 추가')));
  }
  function laborRow(r) {
    const amountCell = h('td', { class: 'num' }); const propCell = h('td', { class: 'num' }); const baseCell = h('td', { class: 'num' });
    r.amountCell = amountCell; r.propCell = propCell; r.baseCell = baseCell;
    return h('tr', {},
      h('td', {}, h('span', { style: S.gubun }, '인력')),
      h('td', {}, h('strong', {}, r.role.name)),
      h('td', {}, specInput(r)),
      h('td', { class: 'num' }, qtyInput(r, '0.01')),
      baseCell,
      propWithNego(r, propCell, negoLabor),
      amountCell,
      h('td', { class: 'center' }, h('button', { style: S.del, title: '삭제', onclick: () => removeRow(laborRows, r, laborSection) }, '×')));
  }

  // 제안단가 셀 = 적용네고율 입력(파랑) + 제안단가 텍스트 + 기준네고율 참고
  function propWithNego(r, propCell, baseNego) {
    const rateInp = h('input', { class: 'input', type: 'number', step: 'any', style: S.rateEdit, value: r.applyRate, oninput: (e) => { r.applyRate = e.target.value; recalc(); } });
    return h('td', { class: 'num' },
      h('div', { style: 'display:flex;gap:3px;justify-content:flex-end;align-items:center' }, rateInp, h('span', { style: S.hint }, '%')),
      propCell,
      h('div', { style: S.hint }, '기준 ' + pctOf(baseNego).toFixed(0) + '%'));
  }
  function specInput(r) { return h('input', { class: 'input', style: S.specEdit, value: r.spec, oninput: (e) => { r.spec = e.target.value; } }); }
  function qtyInput(r, step) { return h('input', { class: 'input', type: 'number', step, style: S.qtyEdit, value: r.qty, oninput: (e) => { r.qty = e.target.value; recalc(); } }); }

  function removeRow(arr, r, sectionFn) { const i = arr.indexOf(r); if (i >= 0) arr.splice(i, 1); rerenderSection(sectionFn); }
  function rerenderSection(sectionFn) {
    const idx = sectionFn === moduleSection ? 0 : 1;
    bodyWrap.replaceChild(sectionFn(), bodyWrap.children[idx]);
    recalc();
  }
  function addModule() {
    const avail = modulesAll.filter((m) => !modRows.some((r) => !r.bundle && r.m.id === m.id));
    pickModal('모듈 추가', avail.map((m) => [`${m.name} (${won(m.base_price)})`, m]), (m) => {
      modRows.push({ m, spec: m.note || '', qty: 1, applyRate: pctOf(negoModule) }); rerenderSection(moduleSection);
    });
  }
  function addBundle() {
    modRows.push({ bundle: true, name: '묶음 항목 (1식)', spec: '', qty: 1, unitPrice: 0 });
    rerenderSection(moduleSection);
  }
  function addLabor() {
    const avail = laborAll.filter((role) => !laborRows.some((r) => r.role.id === role.id));
    pickModal('인력 추가', avail.map((role) => [`${role.name} (기준 ${won(laborBaseRate(role))})`, role]), (role) => {
      laborRows.push({ role, spec: '', qty: num(role.std_mm) || 1, applyRate: pctOf(negoLabor) }); rerenderSection(laborSection);
    });
  }
  function pickModal(title, items, onPick) {
    if (items.length === 0) return toast('추가할 항목이 없습니다 (모두 담김).', 'err');
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow:auto' },
      ...items.map(([label, obj]) => h('button', { class: 'btn', style: 'text-align:left', onclick: () => { modal.close(); onPick(obj); } }, label)));
    const modal = openModal({ title, body: list, footer: [h('button', { class: 'btn', onclick: () => modal.close() }, '닫기')] });
  }

  // ── 합계 요약 ──
  function summaryPanel() {
    mSolEl = h('span', { class: 'num' }); mLaborEl = h('span', { class: 'num' }); mmMirror = h('span', { class: 'page-sub' });
    totalEl = h('strong', { class: 'num' }); dcAmtEl = h('span', { class: 'num' });
    finalEl = h('strong', { class: 'num' }); supplyEl = h('span', { class: 'num' });
    vatEl = h('strong', { class: 'num' }); vatLabelEl = h('span', { style: 'color:var(--text-sub)' }, '부가세 (별도, 10%)');
    grandEl = h('strong', { class: 'num', style: 'font-size:18px;color:var(--accent)' });

    const dcModeSel = sel([['RATE', '할인율(%)'], ['AMOUNT', '할인액(원)'], ['FINAL', '최종금액 직접']], dc.mode, (v) => { dc.mode = v; recalc(); });
    const dcValInp = h('input', { class: 'input', type: 'number', step: 'any', value: dc.value, style: 'height:32px;text-align:right', oninput: (e) => { dc.value = e.target.value; recalc(); } });
    const saveBtn = h('button', { class: 'btn btn-primary', style: 'width:100%;margin-top:14px', onclick: save }, mode === 'edit' ? '견적 수정 저장' : '견적 저장');
    const line = () => h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:10px 0' });

    return h('div', { class: 'panel', style: 'position:sticky;top:16px;padding:16px' },
      h('div', { style: 'font-weight:800;margin-bottom:12px' }, '견적 합계'),
      srow('솔루션 소계', mSolEl),
      srow(h('span', {}, '인건비 소계 ', h('span', { class: 'page-sub' }, '('), mmMirror, h('span', { class: 'page-sub' }, ')')), mLaborEl),
      line(), srow('Total', totalEl),
      h('div', { style: 'margin:10px 0' }, h('div', { style: S.flabel }, '특별 DC'),
        h('div', { style: 'display:flex;gap:6px;margin-top:4px' }, dcModeSel, dcValInp)),
      srow('DC 금액', dcAmtEl),
      srow('최종견적금액', finalEl),
      line(),
      srow('공급가액', supplyEl), srow(vatLabelEl, vatEl),
      line(), srow('총견적가', grandEl), saveBtn);
  }
  function srow(label, valEl) {
    return h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin:6px 0;font-size:13px' },
      typeof label === 'string' ? h('span', { style: 'color:var(--text-sub)' }, label) : label, valEl);
  }

  async function save() {
    if (cond.deployment !== 'ONPREM') return toast('온프레미스 견적만 저장할 수 있습니다.', 'err');
    const sections = [];
    // amount 는 단가를 반올림하지 않은 raw 로 계산(절사 없음). unit_price 만 표시용 반올림.
    if (modRows.length) sections.push(sectionPayload('솔루션', modRows.map((r) => {
      const base = r.bundle ? num(r.unitPrice) : num(r.m.base_price);
      const rawUp = r.bundle ? num(r.unitPrice) : num(r.m.base_price) * (num(r.applyRate) / 100);
      return { code: r.bundle ? null : r.m.code, category: r.bundle ? '묶음' : '솔루션', name: r.bundle ? (r.name || '묶음 항목') : r.m.name,
        spec: r.spec || null, qty: num(r.qty), base_price: Math.round(base), unit_price: Math.round(rawUp), amount: Math.round(rawUp * num(r.qty)),
        note: r.bundle ? '1식' : `네고율 ${num(r.applyRate)}%` };
    })));
    if (laborRows.length) sections.push(sectionPayload('시스템구축', laborRows.map((r) => {
      const base = laborBaseRate(r.role); const rawUp = base * (num(r.applyRate) / 100);
      return { code: r.role.code, category: '시스템구축', name: r.role.name, spec: r.spec || null, qty: num(r.qty),
        base_price: Math.round(base), unit_price: Math.round(rawUp), amount: Math.round(rawUp * num(r.qty)),
        note: `협회기준 ${won(base)} · 네고율 ${num(r.applyRate)}%` };
    })));
    if (!sections.length || sections.every((s) => s.items.length === 0)) return toast('담긴 항목이 없습니다.', 'err');

    // 서버는 supply(=Σamount)에서 discount 를 빼고 VAT 를 항상 더한다.
    // 부가세 별도: supply-disc = 최종 → total = 최종+VAT (= 총견적가).
    // 부가세 포함: supply-disc = 최종/1.1 → total ≈ 최종 (총견적가).
    const total = sections.reduce((s, sec) => s + sec.items.reduce((a, i) => a + i.amount, 0), 0);
    const final = computeFinal(total);
    const targetSupply = info.vat_mode === 'INCLUDED' ? Math.round(final / 1.1) : final;
    const discountValue = Math.max(0, total - targetSupply);
    const discount = discountValue > 0 ? { type: 'AMOUNT', value: discountValue } : { type: null, value: 0 };

    const memo = [
      info.purpose ? '[견적용도] ' + info.purpose : '',
      '[결제조건] ' + (info.pay_terms || '-'),
      '[부가세] ' + (info.vat_mode === 'INCLUDED' ? '포함' : '별도'),
      '[상주] ' + (ONSITES.find(([c]) => c === cond.onsite) || [, '상주'])[1],
      '[특별DC] ' + dcLabel(),
      info.phone ? '[연락처] ' + info.phone : '',
      info.email ? '[이메일] ' + info.email : '',
    ].filter(Boolean).join('\n');

    const payload = {
      customer_name: info.customer_name || null, customer_contact: info.customer_contact || null, memo: memo || null,
      quote_date: info.quote_date, valid_until: info.valid_until || null,
      discount, sections,
      conditions: condRows.map((r) => ({ text: r.text, auto: r.auto, edited: r.edited })),
    };
    try {
      const res = mode === 'edit' ? await api.updateQuote(id, payload) : await api.createQuote(payload);
      toast('저장되었습니다.', 'ok'); location.hash = '#/quotes/' + res.quote.id;
    } catch (err) { toast(err.message, 'err'); }
  }
  function dcLabel() {
    if (dc.mode === 'RATE') return '할인율 ' + num(dc.value) + '%';
    if (dc.mode === 'AMOUNT') return '할인액 ' + won(dc.value) + '원';
    return '최종금액 직접 ' + won(dc.value) + '원';
  }
  function sectionPayload(tag, items) {
    return { solution: cond.solution, deployment: cond.deployment, companyClass: cond.company, months: 1, items };
  }

  // ── 헬퍼 ──
  function setTxt(el, v) { if (el) el.textContent = v; }
  function quoteNoPreview() { return 'QT' + (info.quote_date || '').replace(/-/g, '') + '_(저장 시 채번)'; }
  function sel(options, value, onchange) {
    return h('select', { class: 'select', onchange: (e) => onchange(e.target.value) },
      ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  }
  function txt(value, oninput, type) {
    return h('input', { class: 'input', type: type || 'text', value: value || '', oninput: (e) => oninput(e.target.value), style: 'height:28px' });
  }
  function field(label, input) { return h('div', { style: S.field }, h('span', { style: S.flabel }, label), input); }
  function hc(key, val, first) {
    return [h('div', { style: S.hcell + ';' + S.hkey + (first ? ';border-left:0' : '') }, key), h('div', { style: S.hcell }, val)];
  }
  function theadRow(headers) {
    return h('thead', {}, h('tr', { style: S.thead },
      ...headers.map((hd) => h('th', { class: /단가|금액|수량|공수/.test(hd) ? 'num' : '' }, hd))));
  }
  function blockHead(title, note, subEl) {
    return h('div', { style: S.blockHead },
      h('div', {}, h('strong', {}, title), h('span', { class: 'page-sub', style: 'margin-left:8px' }, note)),
      h('div', { class: 'num' }, '소계 ', subEl));
  }

  initConditions();
  await load();
}
