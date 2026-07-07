import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, loading, clear, debounce } from '../ui.js';

// 섹션 모델: { solution, deployment, companyClass, months, items(가격정책), selected:Map(code->{qty,override}) , refs }
export async function renderEditor(root, { mode, id }) {
  const master = await store.getMaster();

  const model = {
    id: null,
    quote_date: new Date().toISOString().slice(0, 10),
    valid_until: '',
    customer_name: '',
    customer_contact: '',
    memo: '',
    status: 'DRAFT',
    discount: { type: '', value: 0 },
    sections: [],
  };

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, mode === 'edit' ? '견적 수정' : '새 견적 작성'),
      h('div', { class: 'page-sub' }, '솔루션·배포형태별로 섹션을 추가하고 항목을 선택하면 실시간으로 금액이 계산됩니다.')
    )
  ));

  const sectionsWrap = h('div', {});
  const addBtn = h('button', { class: 'add-section', onclick: () => addSection() }, '＋ 솔루션 추가');

  // 우측 요약 패널
  const custName = h('input', { class: 'input', placeholder: '고객사명', value: '', oninput: (e) => { model.customer_name = e.target.value; } });
  const custContact = h('input', { class: 'input', placeholder: '담당자', oninput: (e) => { model.customer_contact = e.target.value; } });
  const quoteDate = h('input', { class: 'input', type: 'date', value: model.quote_date, oninput: (e) => { model.quote_date = e.target.value; } });
  const validUntil = h('input', { class: 'input', type: 'date', oninput: (e) => { model.valid_until = e.target.value; } });
  const discType = h('select', { class: 'select', onchange: () => { model.discount.type = discType.value; recalc(); } },
    h('option', { value: '' }, '할인 없음'), h('option', { value: 'AMOUNT' }, '금액(원)'), h('option', { value: 'RATE' }, '비율(%)'));
  const discValue = h('input', { class: 'input', type: 'number', min: '0', value: '0', oninput: (e) => { model.discount.value = Number(e.target.value) || 0; recalc(); } });
  const memo = h('textarea', { class: 'textarea', rows: 3, placeholder: '비고 / 특이사항', oninput: (e) => { model.memo = e.target.value; } });

  const sumSupply = h('span', {}, '0');
  const sumDiscount = h('span', {}, '0');
  const sumVat = h('span', {}, '0');
  const sumTotal = h('span', {}, '0');
  const saveBtn = h('button', { class: 'btn btn-navy btn-block', onclick: save }, mode === 'edit' ? '수정 저장' : '견적 저장');

  const summary = h('div', { class: 'panel summary' },
    h('div', { class: 'panel-head' }, '견적 정보'),
    h('div', { class: 'panel-body' },
      field('고객사', custName), field('담당자', custContact),
      h('div', { style: 'display:flex;gap:10px' }, h('div', { style: 'flex:1' }, field('견적일', quoteDate)), h('div', { style: 'flex:1' }, field('유효기간', validUntil))),
      h('div', { style: 'display:flex;gap:10px' }, h('div', { style: 'flex:1' }, field('할인', discType)), h('div', { style: 'flex:1' }, field('할인값', discValue))),
      field('비고', memo),
      h('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' }),
      h('div', { class: 'summary-row' }, h('span', { class: 'lbl' }, '공급가액'), h('span', {}, sumSupply)),
      h('div', { class: 'summary-row' }, h('span', { class: 'lbl' }, '할인'), h('span', {}, sumDiscount)),
      h('div', { class: 'summary-row' }, h('span', { class: 'lbl' }, '부가세 (10%)'), h('span', {}, sumVat)),
      h('div', { class: 'summary-row total' }, h('span', {}, '합계'), h('span', {}, sumTotal)),
      h('div', { style: 'margin-top:16px;display:flex;flex-direction:column;gap:8px' },
        saveBtn,
        h('a', { class: 'btn btn-block', href: '#/quotes' }, '취소')
      )
    )
  );

  root.appendChild(h('div', { class: 'editor-grid' },
    h('div', {}, sectionsWrap, addBtn),
    summary
  ));

  function field(label, input) {
    return h('div', { class: 'field', style: 'margin-bottom:12px' }, h('label', {}, label), input);
  }

  // ── 섹션 추가 ──
  function addSection(preset) {
    const sec = {
      solution: preset?.solution || master.solutions[0].code,
      deployment: preset?.deployment || '',
      companyClass: preset?.companyClass || '',
      months: preset?.months || 1,
      items: [],
      selected: new Map(preset?.selected || []),
      refs: {},
    };
    model.sections.push(sec);
    renderSection(sec);
    if (sec.deployment) loadItems(sec);
  }

  function deploymentsForSolution() {
    // 마스터에 combo가 없어도 전 배포형태 노출 (품목 없으면 안내)
    return master.deployments;
  }

  function renderSection(sec) {
    const solSel = h('select', { class: 'select', onchange: () => { sec.solution = solSel.value; sec.deployment = ''; sec.companyClass = ''; refreshHead(); clearItems(sec); } },
      ...master.solutions.map((s) => h('option', { value: s.code, selected: s.code === sec.solution }, s.name)));
    const depSel = h('select', { class: 'select', onchange: () => { sec.deployment = depSel.value; sec.companyClass = ''; sec.selected.clear(); refreshHead(); loadItems(sec); } });
    const ccSel = h('select', { class: 'select', onchange: () => { sec.companyClass = ccSel.value; recalc(); } });
    const monthsInput = h('input', { class: 'input', type: 'number', min: '1', value: sec.months, style: 'width:80px', oninput: (e) => { sec.months = Math.max(1, Number(e.target.value) || 1); recalc(); } });
    const removeBtn = h('button', { class: 'btn btn-danger btn-sm', onclick: () => removeSection(sec) }, '섹션 삭제');

    const tbody = h('tbody');
    const subtotalCell = h('strong', {}, '0');

    sec.refs = { solSel, depSel, ccSel, monthsInput, tbody, subtotalCell, card: null };

    const head = h('div', { class: 'section-head' },
      h('div', { class: 'field' }, h('label', {}, '솔루션'), solSel),
      h('div', { class: 'field' }, h('label', {}, '배포형태'), depSel),
      h('div', { class: 'field' }, h('label', {}, '기업구분'), ccSel),
      h('div', { class: 'field' }, h('label', {}, '계약개월'), monthsInput),
      h('div', { class: 'grow' }),
      removeBtn
    );

    const table = h('div', { class: 'table-wrap' },
      h('table', { class: 'grid' },
        h('thead', {}, h('tr', {},
          h('th', { style: 'width:34px' }, ''), h('th', {}, '구분'), h('th', {}, '품목 / 규격'),
          h('th', { class: 'center' }, '단위'), h('th', { class: 'center' }, '수량'),
          h('th', { class: 'num' }, '단가'), h('th', { class: 'num' }, '금액'), h('th', {}, '비고')
        )),
        tbody
      )
    );

    const foot = h('div', { style: 'display:flex;justify-content:flex-end;gap:16px;padding:10px 14px;border-top:1px solid var(--line);background:#f7f9fc' },
      h('span', { class: 'lbl', style: 'color:var(--text-sub)' }, '섹션 소계'),
      h('span', { class: 'num', style: 'min-width:120px;text-align:right;color:var(--navy)' }, subtotalCell)
    );

    const card = h('div', { class: 'section-card' }, head, table, foot);
    sec.refs.card = card;
    sectionsWrap.appendChild(card);
    refreshHead();

    function refreshHead() {
      clear(depSel).append(
        h('option', { value: '' }, '배포형태 선택'),
        ...deploymentsForSolution().map((d) => h('option', { value: d.code, selected: d.code === sec.deployment }, d.name))
      );
      const ccs = store.companyClasses(sec.solution, sec.deployment);
      clear(ccSel).append(
        h('option', { value: '' }, ccs.length ? '기업구분 선택' : '해당 없음'),
        ...ccs.map((c) => h('option', { value: c.key, selected: c.key === sec.companyClass }, c.label))
      );
      ccSel.disabled = ccs.length === 0;
    }
  }

  function clearItems(sec) { sec.items = []; sec.selected.clear(); clear(sec.refs.tbody); recalc(); }

  async function loadItems(sec) {
    if (!sec.deployment) { clear(sec.refs.tbody); return; }
    clear(sec.refs.tbody).appendChild(h('tr', {}, h('td', { colspan: 8 }, loading('가격정책 불러오는 중...'))));
    try {
      const { items } = await api.pricing(sec.solution, sec.deployment);
      sec.items = items;
      renderItems(sec);
      // 필수 항목 자동 선택
      for (const it of items) {
        if (it.required && !sec.selected.has(it.code)) sec.selected.set(it.code, { qty: Number(it.qty_default) || 1, override: null });
      }
      renderItems(sec);
      recalc();
    } catch (err) {
      clear(sec.refs.tbody).appendChild(h('tr', {}, h('td', { colspan: 8 }, h('div', { class: 'empty' }, err.message))));
    }
  }

  function renderItems(sec) {
    const tb = clear(sec.refs.tbody);
    if (sec.items.length === 0) {
      tb.appendChild(h('tr', {}, h('td', { colspan: 8 }, h('div', { class: 'empty' }, '해당 조합의 가격정책 항목이 없습니다.'))));
      return;
    }
    for (const it of sec.items) {
      const picked = sec.selected.get(it.code);
      const isSel = !!picked;
      const chk = h('input', { type: 'checkbox', class: 'chk', checked: isSel, onchange: () => {
        if (chk.checked) sec.selected.set(it.code, { qty: Number(it.qty_default) || 1, override: null });
        else sec.selected.delete(it.code);
        renderItems(sec); recalc();
      } });
      const qtyInput = h('input', { class: 'qty-input', type: 'number', min: '0', step: '0.01', value: picked ? picked.qty : (Number(it.qty_default) || 1), disabled: !isSel,
        oninput: (e) => { const p = sec.selected.get(it.code); if (p) { p.qty = Number(e.target.value) || 0; recalc(); } } });

      // 단가 셀: need_negotiation이면 override 입력, 아니면 계산값 표시
      const priceCell = h('td', { class: 'num', dataset: { role: 'price', code: it.code } }, '-');
      const amountCell = h('td', { class: 'num', dataset: { role: 'amount', code: it.code } }, '-');

      const tr = h('tr', { dataset: { code: it.code } },
        h('td', { class: 'center' }, chk),
        h('td', {}, h('span', { class: 'tag' }, it.category || '-')),
        h('td', {}, h('div', {}, h('strong', {}, it.name)), it.spec ? h('div', { class: 'page-sub' }, it.spec) : null),
        h('td', { class: 'center nowrap' }, it.unit || '-'),
        h('td', { class: 'center' }, qtyInput),
        priceCell,
        amountCell,
        h('td', {}, it.note ? h('span', { class: 'page-sub' }, it.note) : '')
      );
      tb.appendChild(tr);
    }
  }

  function removeSection(sec) {
    const i = model.sections.indexOf(sec);
    if (i >= 0) { model.sections.splice(i, 1); sec.refs.card.remove(); recalc(); }
  }

  // ── 실시간 계산 ──
  function buildPayload() {
    const sections = model.sections
      .filter((s) => s.deployment && s.selected.size > 0)
      .map((s) => ({
        solution: s.solution,
        deployment: s.deployment,
        companyClass: s.companyClass || null,
        months: s.months,
        items: [...s.selected.entries()].map(([code, v]) => {
          const o = { code, qty: v.qty };
          if (v.override != null && v.override !== '') o.unit_price = Number(v.override);
          return o;
        }),
      }));
    return { sections, discount: model.discount.type ? model.discount : null };
  }

  const recalc = debounce(async () => {
    const payload = buildPayload();
    if (payload.sections.length === 0) {
      setTotals({ supply_amount: 0, discount_amount: 0, vat_amount: 0, total_amount: 0 });
      model.sections.forEach((s) => { if (s.refs.subtotalCell) s.refs.subtotalCell.textContent = '0'; });
      return;
    }
    try {
      const res = await api.calculate(payload);
      // 결과를 섹션/코드 기준으로 매핑
      let ri = 0;
      for (const s of model.sections) {
        if (!(s.deployment && s.selected.size > 0)) { if (s.refs.subtotalCell) s.refs.subtotalCell.textContent = '0'; continue; }
        const rsec = res.sections[ri++];
        const byCode = new Map(rsec.items.map((l) => [l.code, l]));
        for (const l of rsec.items) applyLine(s, l);
        // 미선택/미매핑 행 초기화는 renderItems가 담당
        s.refs.subtotalCell.textContent = won(rsec.subtotal);
      }
      setTotals(res);
    } catch (err) {
      toast(err.message, 'err');
    }
  }, 250);

  function applyLine(sec, line) {
    const tr = sec.refs.tbody.querySelector(`tr[data-code="${line.code}"]`);
    if (!tr) return;
    const priceCell = tr.querySelector('[data-role="price"]');
    const amountCell = tr.querySelector('[data-role="amount"]');
    if (line.need_negotiation) {
      tr.classList.add('item-row-negotiate');
      const cur = sec.selected.get(line.code);
      const input = h('input', { class: 'price-input', type: 'number', placeholder: '별도협의 단가', value: cur?.override ?? '',
        oninput: (e) => { const p = sec.selected.get(line.code); if (p) { p.override = e.target.value; recalc(); } } });
      clear(priceCell).appendChild(input);
      amountCell.textContent = won(line.amount);
    } else {
      tr.classList.remove('item-row-negotiate');
      clear(priceCell).appendChild(document.createTextNode(won(line.unit_price)));
      if (line.band_label) priceCell.appendChild(h('div', { class: 'page-sub' }, line.band_label));
      amountCell.textContent = won(line.amount);
    }
  }

  function setTotals(t) {
    sumSupply.textContent = won(t.supply_amount);
    sumDiscount.textContent = t.discount_amount ? '-' + won(t.discount_amount) : '0';
    sumVat.textContent = won(t.vat_amount);
    sumTotal.textContent = won(t.total_amount) + '원';
  }

  // ── 저장 ──
  async function save() {
    const payload = buildPayload();
    if (payload.sections.length === 0) return toast('선택된 항목이 없습니다.', 'err');
    payload.quote_date = model.quote_date;
    payload.valid_until = model.valid_until || null;
    payload.customer_name = model.customer_name || null;
    payload.customer_contact = model.customer_contact || null;
    payload.memo = model.memo || null;
    payload.status = model.status;
    saveBtn.disabled = true;
    try {
      const res = mode === 'edit'
        ? await api.updateQuote(model.id, payload)
        : await api.createQuote(payload);
      toast('저장되었습니다.', 'ok');
      location.hash = `#/quotes/${res.quote.id}`;
    } catch (err) {
      toast(err.message, 'err');
      saveBtn.disabled = false;
    }
  }

  // ── 초기화 ──
  if (mode === 'edit') {
    try {
      const { quote } = await api.getQuote(id);
      model.id = quote.id;
      model.quote_date = String(quote.quote_date).slice(0, 10);
      model.valid_until = quote.valid_until ? String(quote.valid_until).slice(0, 10) : '';
      model.customer_name = quote.customer_name || '';
      model.customer_contact = quote.customer_contact || '';
      model.memo = quote.memo || '';
      model.status = quote.status;
      model.discount = { type: quote.discount_type || '', value: Number(quote.discount_value) || 0 };
      custName.value = model.customer_name; custContact.value = model.customer_contact;
      quoteDate.value = model.quote_date; validUntil.value = model.valid_until;
      discType.value = model.discount.type; discValue.value = model.discount.value;
      memo.value = model.memo;
      for (const s of quote.sections) {
        const selected = (s.items || []).map((it) => [it.item_code, { qty: Number(it.qty) || 1, override: it.item_code ? null : it.unit_price }]);
        addSection({ solution: s.solution, deployment: s.deployment, companyClass: s.company_class || '', months: s.contract_months || 1, selected });
      }
    } catch (err) {
      toast('견적을 불러오지 못했습니다: ' + err.message, 'err');
    }
  } else {
    addSection();
  }
}
