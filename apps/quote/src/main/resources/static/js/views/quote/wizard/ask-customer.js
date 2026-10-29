// 수신처 입력 창 — 템플릿 불러오기로 1단계를 건너뛰면 수신처(고객사명)가 비어 있을 수 있다.
// 임시저장 · 발행 때 수신처가 없으면 이 창을 띄워 그 자리에서 받는다(1단계로 돌아가지 않아도 된다).
// 고객사 마스터에 있는 이름은 목록에서 고를 수 있고, 고르면 담당자도 채운다.
import { api as http } from '../../../api.js';
import { h, openModal } from '../../../ui.js';

// 결과: { customer_name, customer_contact } 또는 취소하면 null
export function askCustomer(basic) {
  return new Promise((resolve) => {
    let customers = [];
    const list = h('datalist', { id: 'ask-customer-list' });
    const name = h('input', { class: 'ss-input', style: 'width:100%', list: 'ask-customer-list', value: basic.customer_name || '',
      placeholder: '예) 솔브레인', oninput: () => {
        const c = customers.find((x) => x.name === name.value.trim());
        if (c && c.contact_name && !contact.value) contact.value = c.contact_name;
        err.textContent = '';
      } });
    const contact = h('input', { class: 'ss-input', style: 'width:100%', value: basic.customer_contact || '', placeholder: '예) 김OO 책임' });
    const err = h('div', { style: 'color:var(--ss-emphasis);font-size:12px;min-height:16px' });
    const field = (label, ctrl, req) => h('div', { class: 'ss-field', style: 'margin-bottom:10px' },
      h('label', {}, label, req ? h('span', { class: 'req' }, ' *') : null), ctrl);

    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const ok = () => {
      if (!name.value.trim()) { err.textContent = '수신처(고객사명)를 입력하세요.'; name.focus(); return; }
      finish({ customer_name: name.value.trim(), customer_contact: contact.value.trim() });
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    contact.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });

    const m = openModal({
      title: '수신처 입력',
      body: h('div', {},
        h('div', { style: 'font-size:12px;color:var(--ss-ink-3);margin-bottom:10px' }, '견적서의 수신처가 비어 있습니다. 입력하면 바로 이어서 저장합니다.'),
        field('수신처 (고객사명)', name, true), field('담당자', contact), err, list),
      footer: [h('button', { class: 'btn', onclick: () => finish(null) }, '취소'), h('button', { class: 'btn btn-primary', onclick: ok }, '확인')],
    });
    // 바깥을 눌러 닫아도 취소로 끝낸다
    m.back.addEventListener('click', (e) => { if (e.target === m.back) finish(null); });
    setTimeout(() => name.focus(), 0);

    http.masterList('customers').then((r) => {
      customers = (r.rows || []).filter((c) => c.active !== 0);
      list.replaceChildren(...customers.map((c) => h('option', { value: c.name })));
    }).catch(() => { /* 마스터가 없어도 직접 입력하면 된다 */ });
  });
}
