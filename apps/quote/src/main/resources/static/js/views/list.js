// 견적 목록 — SingleSuite L1 조회형 (툴바 + 명세바 + 그리드 상자). toray 적용 화면 기준.
//   툴바 좌: Search (입력하면 바로 걸린다) → 필터(상세 검색) · 상태 — 상자 버튼
//   툴바 우: 신규  — 이 화면에 원래 있던 액션은 "새 견적" 하나뿐이다
//   건수: 툴바 아래 상태별 건수 줄 (전체 n  작성중 n …)
//   기간 선택기는 두지 않는다 — 목록 API 에 기간 조건이 없다
import { api } from '../api.js';
import { h, won, toast, clear, debounce } from '../ui.js';

const STATUS = { DRAFT: '작성중', SENT: '발송', WON: '수주', LOST: '실주' };
const STATUS_OPTS = [['', '전체'], ...Object.entries(STATUS)];
const PAGE_SIZE = 100; // API 최대치. 넘칠 때만 아래에 페이지 이동이 나온다

// 'YYYY-MM-DD' → 'YYYY/MM/DD' (SingleSuite 날짜 표기)
const ymd = (d) => (d ? String(d).slice(0, 10).replace(/-/g, '/') : '');

// 견적번호처럼 보이면 견적번호로, 아니면 고객사명으로 찾는다
const looksLikeQuoteNo = (s) => /^(qt|s)?\d/i.test(s);

const icon = {
  search: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  filter: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8v7l-4 2v-9z"/></svg>',
  status: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="10" width="4" height="11"/><rect x="10" y="4" width="4" height="17"/><rect x="17" y="13" width="4" height="8"/></svg>',
};

export async function renderList(root) {
  const state = { q: '', customer: '', quoteNo: '', status: '', page: 1 };

  // ── 툴바 좌: Search ──
  const searchInput = h('input', {
    placeholder: 'Search',
    oninput: debounce(() => {
      const v = searchInput.value.trim();
      state.q = v;
      state.page = 1;
      load();
    }, 350),
  });
  const search = h('div', { class: 'ss-search' },
    searchInput,
    h('button', { class: 'ss-search__btn', 'aria-label': '검색', html: icon.search, onclick: () => load() }));

  // ── 필터: 상세 검색 팝오버 (고객사 · 견적번호) ──
  const custInput = h('input', { class: 'ss-input' });
  const noInput = h('input', { class: 'ss-input' });
  const popover = h('div', { class: 'ss-popover', hidden: true },
    h('div', { class: 'ss-popover__head' }, '상세 검색',
      h('button', { class: 'ss-popover__close', 'aria-label': '닫기', html: '&times;', onclick: () => { popover.hidden = true; } })),
    h('div', { class: 'ss-popover__body' },
      h('div', { class: 'ss-popover__actions' },
        h('button', { class: 'ss-btn ss-btn--save', onclick: () => {
          state.customer = custInput.value.trim();
          state.quoteNo = noInput.value.trim();
          state.page = 1;
          popover.hidden = true;
          load();
        } }, '조회'),
        h('button', { class: 'ss-btn ss-btn--default', onclick: () => {
          custInput.value = ''; noInput.value = '';
          state.customer = ''; state.quoteNo = '';
          state.page = 1;
          load();
        } }, '초기화')),
      h('div', { class: 'ss-popover__row' }, h('label', {}, '고객사'), custInput),
      h('div', { class: 'ss-popover__row' }, h('label', {}, '견적번호'), noInput)));
  const filterBtn = h('button', { class: 'ss-tbtn', onclick: (e) => { e.stopPropagation(); statusMenu.hidden = true; popover.hidden = !popover.hidden; } },
    h('span', { class: 'ss-tbtn__ico--filter', html: icon.filter }), ' 필터');

  // ── 상태 드롭다운 ──
  const statusMenu = h('div', { class: 'ss-dropdown__menu', hidden: true });
  const statusBtn = h('button', { class: 'ss-tbtn', onclick: (e) => { e.stopPropagation(); popover.hidden = true; statusMenu.hidden = !statusMenu.hidden; } },
    h('span', { class: 'ss-tbtn__ico--status', html: icon.status }), ' 상태');
  const paintStatusMenu = () => {
    clear(statusMenu);
    for (const [v, label] of STATUS_OPTS) {
      statusMenu.appendChild(h('button', {
        class: 'ss-dropdown__item' + (state.status === v ? ' is-active' : ''),
        onclick: () => { state.status = v; state.page = 1; statusMenu.hidden = true; load(); },
      }, label));
    }
  };
  paintStatusMenu();

  // 팝오버·드롭다운 바깥을 누르면 닫는다
  const outside = (e) => {
    if (!root.isConnected) { document.removeEventListener('click', outside); return; }
    if (!popover.contains(e.target)) popover.hidden = true;
    if (!statusMenu.contains(e.target)) statusMenu.hidden = true;
  };
  document.addEventListener('click', outside);

  root.appendChild(h('div', { class: 'ss-toolbar' },
    search,
    h('div', { class: 'ss-toolbar__tools' },
      h('div', { class: 'ss-dropdown' }, filterBtn, popover),
      h('div', { class: 'ss-dropdown' }, statusBtn, statusMenu)),
    h('div', { class: 'ss-toolbar__spacer' }),
    h('div', { class: 'ss-actions' },
      h('button', { class: 'ss-btn ss-btn--save', onclick: () => { location.hash = '#/quotes/new'; } }, '신규'))));

  // ── 필터칩: 걸려 있는 조건이 있을 때만 ──
  const chips = h('div', { class: 'ss-chips' });
  root.appendChild(chips);

  // ── 상태별 건수 줄: 전체 n  작성중 n … — 누르면 그 상태로 거른다. 이 줄이 건수를 대신한다 ──
  const statusItems = h('div', { class: 'ss-statusbar__items' });
  root.appendChild(h('div', { class: 'ss-statusbar' }, statusItems));

  // ── 그리드 ──
  const tbody = h('tbody');
  root.appendChild(h('div', { class: 'ss-gridwrap ss-gridwrap--fill' },
    h('table', { class: 'ss-grid' },
      h('colgroup', {},
        h('col', { style: 'width:150px' }), h('col', { style: 'width:100px' }), h('col', {}),
        h('col', { style: 'width:130px' }), h('col', { style: 'width:130px' }),
        h('col', { style: 'width:80px' }), h('col', { style: 'width:100px' })),
      h('thead', {}, h('tr', {},
        h('th', {}, '견적번호'), h('th', {}, '견적일자'), h('th', {}, '고객사'),
        h('th', {}, '공급가액'), h('th', {}, '합계금액'),
        h('th', {}, '상태'), h('th', {}, '작성자'))),
      tbody)));

  const pager = h('div', { class: 'ss-pager', hidden: true });
  root.appendChild(pager);

  function paintChips() {
    clear(chips);
    const list = [];
    if (state.q) list.push(['검색어 ' + state.q, () => { state.q = ''; searchInput.value = ''; }]);
    if (state.customer) list.push(['고객사 ' + state.customer, () => { state.customer = ''; custInput.value = ''; }]);
    if (state.quoteNo) list.push(['견적번호 ' + state.quoteNo, () => { state.quoteNo = ''; noInput.value = ''; }]);
    if (state.status) list.push(['상태 ' + STATUS[state.status], () => { state.status = ''; }]);
    chips.hidden = !list.length;
    statusBtn.classList.toggle('is-active', !!state.status);
    filterBtn.classList.toggle('is-active', !!(state.customer || state.quoteNo));
    if (!list.length) return;
    chips.appendChild(h('span', {}, '필터 조건'));
    for (const [label, off] of list) {
      chips.appendChild(h('span', { class: 'ss-chip' }, label,
        h('span', { style: 'cursor:pointer', title: '제거', html: '&times;', onclick: () => { off(); state.page = 1; load(); } })));
    }
    chips.appendChild(h('span', { style: 'cursor:pointer', title: '전체 지우기', html: '&#9003;', onclick: () => {
      state.q = state.customer = state.quoteNo = state.status = '';
      searchInput.value = custInput.value = noInput.value = '';
      state.page = 1;
      load();
    } }));
  }

  const emptyRow = (text) => h('tr', {}, h('td', { colspan: 7, class: 'ss-cell--empty' }, text));

  async function load() {
    paintChips();
    paintStatusMenu();
    clear(tbody).appendChild(emptyRow('불러오는 중...'));
    try {
      const cond = {};
      // Search 칸과 상세 검색이 같은 조건을 쓰면 상세 검색이 이긴다
      if (state.q) cond[looksLikeQuoteNo(state.q) ? 'quote_no' : 'customer'] = state.q;
      if (state.customer) cond.customer = state.customer;
      if (state.quoteNo) cond.quote_no = state.quoteNo;
      const params = { ...cond, page: state.page, size: PAGE_SIZE };
      if (state.status) params.status = state.status;
      paintStatusCounts(cond);
      const { quotes, total } = await api.listQuotes(params);
      clear(tbody);
      if (!quotes.length) tbody.appendChild(emptyRow('조회된 견적이 없습니다.'));
      for (const q of quotes) {
        const open = () => { location.hash = `#/quotes/${q.id}`; };
        tbody.appendChild(h('tr', { class: 'is-clickable', onclick: open },
          h('td', { class: 'ss-cell--link' }, h('a', { href: `#/quotes/${q.id}` }, q.quote_no)),
          h('td', { class: 'ss-cell--date' }, ymd(q.quote_date)),
          h('td', { class: 'ss-cell--left' }, q.customer_name || '-'),
          h('td', { class: 'ss-cell--amount' }, won(q.supply_amount)),
          h('td', { class: 'ss-cell--amount' }, won(q.total_amount)),
          h('td', { class: 'ss-cell--emphasis' }, STATUS[q.status] || q.status),
          h('td', {}, q.created_by_name || '-')));
      }
      paintPager(total);
    } catch (err) {
      clear(tbody).appendChild(emptyRow(err.message));
      toast(err.message, 'err');
    }
  }

  // 상태별 건수 — 목록 API 가 상태별 집계를 주지 않으므로 상태마다 size=1 로 total 만 받는다.
  // 검색 조건은 같이 걸고 상태 조건만 바꾼다. 늦게 온 응답이 새 조건을 덮지 않게 차례 번호를 둔다
  let countSeq = 0;
  async function paintStatusCounts(cond) {
    const seq = ++countSeq;
    const totals = await Promise.all(STATUS_OPTS.map(([v]) =>
      api.listQuotes({ ...cond, ...(v ? { status: v } : {}), page: 1, size: 1 }).then((r) => r.total, () => '-')));
    if (seq !== countSeq) return;
    clear(statusItems);
    STATUS_OPTS.forEach(([v, label], i) => {
      statusItems.appendChild(h('button', {
        class: 'ss-statusbar__item' + (state.status === v ? ' is-active' : ''),
        onclick: () => { state.status = v; state.page = 1; load(); },
      }, label + ' ', h('b', {}, String(totals[i]))));
    });
  }

  function paintPager(total) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    pager.hidden = pages <= 1;
    if (pager.hidden) return;
    clear(pager).append(
      h('button', { class: 'ss-btn ss-btn--default', disabled: state.page <= 1, onclick: () => { state.page--; load(); } }, '이전'),
      h('span', {}, `${state.page} / ${pages}`),
      h('button', { class: 'ss-btn ss-btn--default', disabled: state.page >= pages, onclick: () => { state.page++; load(); } }, '다음'));
  }

  load();
}
