import { api } from '../api.js';
import { h, won, fmtDate, statusBadge, toast, loading, clear, debounce } from '../ui.js';

const STATUS_OPTS = [['', '전체 상태'], ['DRAFT', '작성중'], ['SENT', '발송'], ['WON', '수주'], ['LOST', '실주']];

export async function renderList(root) {
  const state = { status: '', customer: '', page: 1, size: 20 };

  const statusSel = h('select', { class: 'select', onchange: () => { state.status = statusSel.value; state.page = 1; load(); } },
    ...STATUS_OPTS.map(([v, l]) => h('option', { value: v }, l)));
  const custInput = h('input', { class: 'input', placeholder: '고객사명 검색', oninput: debounce(() => { state.customer = custInput.value.trim(); state.page = 1; load(); }, 350) });

  const tbody = h('tbody');
  const pager = h('div', { class: 'filterbar', style: 'justify-content:flex-end;margin-top:12px' });

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '견적 목록'),
      h('div', { class: 'page-sub' }, '작성한 견적을 조회하고 상태를 관리합니다.')
    ),
    h('div', { class: 'page-actions' },
      h('a', { class: 'btn btn-primary', href: '#/quotes/new' }, '＋ 새 견적')
    )
  ));

  root.appendChild(h('div', { class: 'filterbar' },
    h('div', { class: 'field' }, h('label', {}, '상태'), statusSel),
    h('div', { class: 'field' }, h('label', {}, '고객사'), custInput)
  ));

  const panel = h('div', { class: 'panel' },
    h('div', { class: 'table-wrap' },
      h('table', { class: 'grid' },
        h('thead', {}, h('tr', {},
          h('th', {}, '견적번호'), h('th', {}, '견적일'), h('th', {}, '고객사'),
          h('th', { class: 'num' }, '공급가액'), h('th', { class: 'num' }, '합계금액'),
          h('th', { class: 'center' }, '상태'), h('th', {}, '작성자')
        )),
        tbody
      )
    )
  );
  root.appendChild(panel);
  root.appendChild(pager);

  async function load() {
    clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 7 }, loading())));
    try {
      const params = { page: state.page, size: state.size };
      if (state.status) params.status = state.status;
      if (state.customer) params.customer = state.customer;
      const { quotes, total } = await api.listQuotes(params);
      clear(tbody);
      if (quotes.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: 7 }, h('div', { class: 'empty' }, '견적이 없습니다. 새 견적을 작성해보세요.'))));
      } else {
        for (const q of quotes) {
          const tr = h('tr', { class: 'clickable', onclick: () => { location.hash = `#/quotes/${q.id}`; } },
            h('td', { class: 'nowrap' }, h('strong', {}, q.quote_no)),
            h('td', { class: 'nowrap' }, fmtDate(q.quote_date)),
            h('td', {}, q.customer_name || '-'),
            h('td', { class: 'num' }, won(q.supply_amount)),
            h('td', { class: 'num' }, h('strong', {}, won(q.total_amount))),
            h('td', { class: 'center' }, statusBadge(q.status)),
            h('td', { class: 'nowrap' }, q.created_by_name || '-')
          );
          tbody.appendChild(tr);
        }
      }
      renderPager(total);
    } catch (err) {
      clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 7 }, h('div', { class: 'empty' }, err.message))));
      toast(err.message, 'err');
    }
  }

  function renderPager(total) {
    clear(pager);
    const pages = Math.max(1, Math.ceil(total / state.size));
    pager.appendChild(h('span', { class: 'page-sub', style: 'margin-right:auto' }, `총 ${total}건`));
    pager.appendChild(h('button', { class: 'btn btn-sm', disabled: state.page <= 1, onclick: () => { state.page--; load(); } }, '이전'));
    pager.appendChild(h('span', { class: 'page-sub', style: 'padding:0 8px' }, `${state.page} / ${pages}`));
    pager.appendChild(h('button', { class: 'btn btn-sm', disabled: state.page >= pages, onclick: () => { state.page++; load(); } }, '다음'));
  }

  load();
}
