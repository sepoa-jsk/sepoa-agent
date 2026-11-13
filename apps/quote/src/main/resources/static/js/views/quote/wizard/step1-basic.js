// STEP② 기본정보 (유형 선택 다음) — 시안 #s4 구조.
// 자사 정보는 이 화면에 두지 않는다 — 기준정보 > 자사 정보(sq_settings supplier_*)에서 관리한다(2026-11-03).
import { pickCustomer } from '../pickers.js';
import { store } from '../../../app.js';
import { h, toast, confirmModal } from '../../../ui.js';
import { api as http } from '../../../api.js';
import { syncPurpose } from './step3-config.js';
import { CHANNELS } from '../../customers.js';
import { openQuotePicker } from './quote-picker.js';

// 기업구분 선택지 — 기업구분 마스터의 사용 중인 행(솔루션 · 구축형태마다 행이 있어 key 로 한 번만). 고른 솔루션에 있으면 그 솔루션 것만
function companyOptions(solution) {
  const all = (store.master?.company_classes || store.master?.companyClasses || []).filter((c) => c.active);
  const mine = solution ? all.filter((c) => c.solution === solution) : [];
  const seen = new Map();
  for (const c of [...(mine.length ? mine : all)].sort((a, b) => a.sort - b.sort)) if (!seen.has(c.key)) seen.set(c.key, c.label);
  return [...seen];
}

// 메일 본문에서 고객 정보를 뽑는다 — 보낸 사람 줄(From · 보낸 사람)의 이름 · 이메일, 서명의 전화번호 · 회사명.
// 회신이 겹친 메일이면 첫 메일(맨 위)까지만 본다. 우리 회사(sepoasoft) 주소 · 번호는 고객 것이 아니라 건너뛴다.
export function parseMail(text) {
  const all = String(text || '').replace(/\r/g, '');
  const out = {};
  const fromRe = /^\s*(?:from|보낸\s*사람|발신자?)\s*[:：]\s*(.+)$/im;
  const own = (s) => /sepoasoft/i.test(s);
  const emailRe = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  // 첫 메일 범위 — 첫 보낸 사람 줄 다음부터 두 번째 머리글(원본 메시지 · 보낸 사람 줄 · 'wrote:' · '>' 인용) 앞까지
  let body = all;
  const firstFrom = all.search(fromRe);
  const after = firstFrom >= 0 ? all.indexOf('\n', firstFrom) + 1 || all.length : 0;
  const cut = all.slice(after).search(/^\s*(?:-{2,}\s*(?:original message|원본 메시지)|(?:from|보낸\s*사람)\s*[:：]|>|.*wrote:\s*$)/im);
  if (cut >= 0) body = all.slice(0, after + cut);
  const m = body.match(fromRe);
  if (m && !own(m[1])) {
    const em = m[1].match(emailRe);
    if (em) out.email = em[0];
    const name = m[1].replace(/<[^>]*>/g, '').replace(new RegExp(emailRe.source, 'g'), '').replace(/["'()[\]]/g, '').trim();
    if (name) out.contact = name;
  }
  if (!out.email) {
    const em = (body.match(new RegExp(emailRe.source, 'g')) || []).find((x) => !own(x));
    if (em) out.email = em;
  }
  // 전화 — 휴대폰(010) 먼저, 없으면 일반 번호
  const phones = (body.match(/(?:\+82[-.\s]?)?\(?0?\d{1,2}\)?[-.\s]?\d{3,4}[-.\s]\d{4}/g) || []).map((x) => x.trim());
  const phone = phones.find((x) => /^(?:\+82[-.\s]?)?\(?0?10/.test(x)) || phones[0];
  if (phone) out.phone = phone.replace(/^\+82[-.\s]?0?/, '0');
  // 회사명 — ㈜ · (주) · 주식회사 · Co., Ltd 가 붙은 짧은 줄(우리 회사 제외)
  const co = body.split('\n').flatMap((l) => l.split(/\s[|/·]\s/)).map((l) => l.trim()).find((l) => l.length <= 40 && /㈜|\(주\)|주식회사|co\.,?\s*ltd|corp/i.test(l) && !/세포아|sepoa/i.test(l));
  if (co) out.company = co.replace(/^(?:회사|소속)\s*[:：]\s*/, '');
  return out;
}


// req — 필수 칸(다음 단계로 가려면 꼭 넣어야 하는 값). 라벨 뒤에 빨간 * , 비어 있으면 빨간 테두리
const fld = (label, el, hint, req) => {
  if (req) {
    const box = el.matches('input') ? el : el.querySelector('input');
    const mark = () => box && box.classList.toggle('is-req-empty', !box.value.trim());
    if (box) { mark(); box.addEventListener('input', mark); }
  }
  return h('div', { class: 'fld' },
    h('label', {}, label, req ? h('span', { class: 'req-mark' }, '*') : null), el, hint ? h('div', { class: 'hint' }, hint) : null);
};

export async function renderStep1(root, state, wiz) {
  const b = state.basic;
  const inp = (key, opt = {}) => h('input', {
    id: 'wiz-step2-' + key, // 수신처가 비었을 때 커서를 옮길 곳(focusCustomer)
    class: 'input', type: opt.type || 'text', value: b[key] || '',
    placeholder: opt.ph || '', style: 'width:100%',
    onchange: (e) => {
      const patch = { basic: { [key]: e.target.value } };
      // 견적일자를 바꾸면 유효일을 +30일로 다시 계산한다
      if (key === 'quote_date') patch.basic.valid_until = wiz.addDays(e.target.value, 30);
      wiz.patch(patch);
      if (key === 'quote_date') renderStep1(root, wiz.get(), wiz);
      // 고객명을 바꾸면 견적용도(자동 문구)도 따라 바꾼다
      if (key === 'customer_name' || key === 'end_customer') syncPurpose(wiz).then((ch) => { if (ch) renderStep1(root, wiz.get(), wiz); });
    },
  });
  const ro = (val) => h('input', { class: 'input', style: 'width:100%', value: val || '', readonly: true, disabled: true });

  root.replaceChildren();

  // 새 견적 — 담당자 정보(우리 영업 담당)를 로그인한 사람의 사용자 정보로 한 번 채운다(2026-11-02 사용자 요청 — 고객 정보와 나눔).
  // 연락처는 사용자관리의 핸드폰번호(V19)로 채운다. 지우면 다시 채우지 않는다.
  if (!state.quoteId && !wiz.readOnly && !b.rep_filled && store.profile) {
    const p = store.profile;
    wiz.patch({ basic: { rep_filled: true,
      rep_name: b.rep_name || [p.name, p.position].filter(Boolean).join(' '),
      rep_email: b.rep_email || p.email || '',
      rep_phone: b.rep_phone || p.phone || '' } }); // 핸드폰번호(V19, 사용자관리) — 2026-11-03
    return renderStep1(root, wiz.get(), wiz);
  }
  // 견적용도 — 비어 있으면 고객명 + 솔루션 + 구축 견적 (서비스명) 으로 채운다
  if (await syncPurpose(wiz)) return renderStep1(root, wiz.get(), wiz);

  // 근거 메일 — 붙여넣으면 고객 정보를 뽑아 빈 칸에만 채운다(이미 넣은 값은 둔다). 링크는 저장만 한다(메일 시스템에서 읽어 오지 못한다)
  const mailText = h('textarea', { class: 'input', placeholder: '고객사에서 온 메일을 그대로 복사해 붙여넣으세요. 보낸 사람 · 연락처 · 이메일을 읽어 위 고객 · 견적 정보의 빈 칸에 채웁니다.',
    style: 'width:100%;height:120px;padding:8px 9px;line-height:1.6;resize:vertical;font-size:12px', readonly: !!wiz.readOnly });
  mailText.value = b.mail_text || '';
  mailText.addEventListener('change', async () => {
    wiz.patch({ basic: { mail_text: mailText.value } });
    if (!mailText.value.trim()) return;
    const got = parseMail(mailText.value);
    const cur = wiz.get().basic;
    const map = [['company', 'customer_name', '고객사명'], ['contact', 'customer_contact', '고객 담당자'], ['phone', 'phone', '연락처'], ['email', 'email', '이메일']];
    const fill = {};
    for (const [from, to] of map) if (got[from] && !String(cur[to] || '').trim()) fill[to] = got[from];
    const names = map.filter(([, to]) => fill[to]).map(([, , label]) => label);
    if (!names.length) {
      toast(Object.keys(got).length ? '메일에서 찾은 정보의 칸이 이미 채워져 있어 그대로 두었습니다.' : '메일에서 고객 정보를 찾지 못했습니다. 직접 입력하세요.', 'err');
      return;
    }
    wiz.patch({ basic: fill });
    await syncPurpose(wiz);
    toast(`메일에서 ${names.join(' · ')}을(를) 채웠습니다.`, 'ok');
    renderStep1(root, wiz.get(), wiz);
  });

  // 견적번호는 뺐다(화면 위 경로 · 3단계부터 오른쪽 위에 이미 보인다). 근거 메일은 아래 '근거 자료' 로 옮겼다.
  const companySel = (() => {
    const opts = companyOptions(state.type && state.type.solution);
    // 저장된 값이 지금 선택지에 없으면(사용 중지 등) 그대로 보이게 한 줄 더 둔다
    if (b.company_class && !opts.some(([k]) => k === b.company_class)) opts.push([b.company_class, b.company_class]);
    return h('select', { class: 'input', style: 'width:100%', disabled: !!wiz.readOnly,
      onchange: (e) => wiz.patch({ basic: { company_class: e.target.value || null } }) },
    h('option', { value: '' }, '선택'),
    ...opts.map(([k, label]) => h('option', { value: k, selected: k === b.company_class }, label)));
  })();
  // 채널 — 고객사와 바로 하는지, 컨설팅펌 · SI 업체 등을 끼고 하는지
  const channelSel = h('select', { class: 'input', style: 'width:100%', disabled: !!wiz.readOnly,
    onchange: async (e) => { wiz.patch({ basic: { channel: e.target.value || null } }); await syncPurpose(wiz); renderStep1(root, wiz.get(), wiz); } },
  h('option', { value: '' }, '선택'),
  ...CHANNELS.map(([k, label]) => h('option', { value: k, selected: k === b.channel }, label)));
  // 한 카드 '견적 기본정보'(2026-11-03 사용자 요청 — 고객 · 견적 / 담당자 / 견적 조건을 나눌 필요 없음).
  // 4칸 격자, 줄 순서: 고객(수신처 · 담당 · 연락처 · 이메일) → 고객 구분 · 견적용도 → 견적 조건(일자 · 유효일 · 결제 · 설치) → 영업 담당 · 상태.
  // 고객 · 영업 연락처가 한 카드에 같이 있어 라벨에 '고객' · '영업' 을 붙여 구분한다
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '견적 기본정보'),
      h('span', { class: 'sub' }, '[고객사 선택] 으로 고르면 고객 담당자 · 연락처 · 이메일 · 기업구분 · 채널까지 채워집니다'),
      h('span', { class: 'sp' }), h('span', { class: 'req-note' }, h('b', {}, '*'), ' 표시는 꼭 입력해야 다음 단계로 갈 수 있습니다')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px' },
      // 직접 입력하거나 [고객사 선택] 팝업(고객사 마스터)에서 골라 담당자 · 연락처 · 이메일까지 채운다
      fld(b.channel === 'AGENCY' ? '수신처 (원청사)' : '수신처 (고객사명)', h('div', { style: 'display:flex;gap:6px' }, inp('customer_name', { ph: '예) 솔브레인' }),
        h('button', { class: 'btn', style: 'white-space:nowrap', onclick: async () => {
          const c = await pickCustomer();
          if (!c) return;
          // 간접 고객(경유 업체 있음) — 수신처는 경유 업체(담당자 · 연락처 · 이메일도 그쪽), 최종 고객사는 고른 고객.
          // 중간업체 행을 바로 고르면 수신처만 그 업체로(간접). 그 밖에는 예전처럼 고른 고객사 그대로
          const to = c._via || c;
          wiz.patch({ basic: { customer_name: to.name || '', customer_contact: to.contact_name || '',
            phone: to.contact_phone || '', email: to.contact_email || '', company_class: c.company_key || b.company_class || null,
            channel: c._via || c.kind === 'PARTNER' ? 'AGENCY' : c.channel || b.channel || null,
            ...(c._via ? { end_customer: c.name || '' } : {}) } });
          await syncPurpose(wiz);
          renderStep1(root, wiz.get(), wiz);
        } }, '고객사 선택')), null, true),
      fld('고객 담당자', inp('customer_contact', { ph: '예) 김OO 책임' })),
      // 연락처·이메일은 견적서 본문이 아니라 메모에 실린다(구 화면과 동일).
      fld('고객 연락처', inp('phone', { ph: '예) 010-0000-0000' })),
      fld('고객 이메일', inp('email', { ph: '예) name@company.co.kr' })),
      fld('기업구분', companySel),
      fld('채널', channelSel),
      // 최종 고객사 — 간접일 때만. 수신처에는 중간업체(컨설팅펌 · SI), 여기에는 실제 고객(견적용도에 들어간다)
      b.channel === 'AGENCY' ? fld('최종 고객사', inp('end_customer', { ph: '예) JW' }), '견적용도에 이 이름이 들어갑니다') : null,
      h('div', { style: b.channel === 'AGENCY' ? '' : 'grid-column:span 2' }, fld('견적용도', inp('purpose', { ph: '예) 전자계약관리 시스템 견적_구축형' }))),
      fld('견적일자', inp('quote_date', { type: 'date' }), null, true),
      // 견적유효일 — 달력으로 바꿀 수 있다(2026-11-02 사용자 요청). 견적일자를 바꾸면 +30일로 다시 맞춘다
      fld('견적유효일', inp('valid_until', { type: 'date' }), '기본은 견적일 + 30일'),
      fld('결제조건', inp('pay_terms')),
      fld('설치완료', inp('install_note')),
      // 영업 담당(우리 쪽) — 로그인한 사용자 정보로 채운다. 연락처는 사용자 정보에 없어 직접 넣는다
      fld('영업 담당자', inp('rep_name', { ph: '예) 홍길동 책임' }), '로그인한 사용자 정보로 채워집니다'),
      fld('영업 연락처', inp('rep_phone', { ph: '예) 010-0000-0000' })),
      fld('영업 이메일', inp('rep_email', { ph: '예) name@sepoasoft.co.kr' })),
      h('div', { 'data-keep': '' }, fld('상태', wiz.statusSelect(), wiz.readOnly ? '상세에서도 바로 바뀝니다' : null)),
      // 2차 이상 — 차수 추가 때 넣은 사유(읽기 전용)
      state.revision > 1 ? h('div', { style: 'grid-column:1 / -1' }, fld(`차수 추가 사유 (${state.revision}차)`, ro(state.revisionReason || '-'))) : null)));

  // 자사 정보는 견적 작성 화면에서 뺐다(2026-11-03 사용자 요청) — 기준정보 > 자사 정보에서 관리하고 견적서에만 들어간다

  if (state.type.quote_type === 'MAINT') root.appendChild(maintCard(root, state, wiz, inp));

  // ── 첨부파일 — 근거 자료 위에 따로(2026-11-03 사용자 요청). 표는 V17 sq_quote_files. 저장된 견적에만 올린다 ──
  root.appendChild(filesCard(state, wiz));

  // ── 근거 자료 — 근거 메일 · 고객 전달 파일(RFP 등)을 한 곳에(2026-11-03 사용자 요청) ──
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, '근거 자료'), h('span', { class: 'sub' }, '이 견적의 근거가 되는 고객 메일 · 문서')),
    h('div', { class: 'card-b', style: 'padding-top:0' },
      // 근거 메일 — 이 견적의 근거(고객 요청 메일). 링크와 본문 둘 다 저장한다(V14)
      h('div', { style: 'padding:12px 0' },
        h('div', { style: 'font-size:12.5px;font-weight:700;color:var(--text-1);margin-bottom:8px' }, '근거 메일',
          h('span', { style: 'font-weight:400;color:var(--text-3);margin-left:8px' }, '링크가 안 되면 본문을 붙여넣으세요 — 본문에서 고객 정보를 읽어 위의 빈 칸에 채웁니다')),
        fld('메일 링크', inp('mail_url', { ph: '예) https://mail.google.com/mail/u/0/#inbox/…' }), '링크는 저장만 합니다'),
        fld('메일 본문', mailText)),
      // 고객 전달 파일 — RFP · 요청서 · 사양서 등 고객사가 보낸 파일(V18 kind = CUSTOMER). 예전 'RFP 분석(준비 중)' 자리
      filesCard(state, wiz, { kind: 'CUSTOMER', embed: true }))));
}

// 유지보수 견적의 금액 기준 · 기간(2026-11-07 사용자 요청) — 구축 견적이 이 시스템에 없어도(옮기지 못한 예전 견적) 만들 수 있게 세 가지 중 하나로.
//   구축 견적 불러오기: 고른 견적의 솔루션 견적 합계를 공급가로 / 직접 입력: 원 계약 · 공급가를 손으로 / 전년도 금액: 작년 연 금액 × (1 + 인상률)
//   3단계 솔루션유지보수 금액이 이 값으로 계산된다(recalcBlocks)
const MAINT_BASES = [['QUOTE', '구축 견적 불러오기'], ['MANUAL', '직접 입력'], ['PREV', '전년도 금액']];
const wonText = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('ko-KR'));
function maintCard(root, state, wiz, inp) {
  const b = state.basic;
  const basis = b.maint_basis || 'QUOTE';
  const rerender = () => renderStep1(root, wiz.get(), wiz);
  // 금액 칸 — 3자리 콤마로 보이고 숫자만 저장한다
  const money = (key) => h('input', { class: 'input', style: 'width:100%;text-align:right', value: wonText(b[key]), disabled: !!wiz.readOnly,
    onchange: (e) => {
      const v = e.target.value.replace(/[^\d]/g, '');
      wiz.patch({ basic: { [key]: v === '' ? null : Number(v) } });
      e.target.value = wonText(v === '' ? null : Number(v));
    } });
  const pct = (key) => h('input', { class: 'input', style: 'width:100%;text-align:right', value: b[key] ?? '', disabled: !!wiz.readOnly,
    onchange: (e) => { const v = e.target.value.replace(/[^\d.]/g, ''); wiz.patch({ basic: { [key]: v === '' ? null : Number(v) } }); } });
  const basisSel = h('select', { class: 'input', style: 'width:100%', disabled: !!wiz.readOnly,
    onchange: (e) => { wiz.patch({ basic: { maint_basis: e.target.value } }); rerender(); } },
  ...MAINT_BASES.map(([k, label]) => h('option', { value: k, selected: k === basis }, label)));
  // 유지보수 기간 — 시작일을 넣으면 종료일이 비어 있을 때 1년 뒤 전날로 채운다
  const fromInp = inp('maint_from', { type: 'date' });
  fromInp.addEventListener('change', () => {
    const cur = wiz.get().basic;
    if (cur.maint_from && !cur.maint_to) {
      const x = new Date(cur.maint_from + 'T00:00:00');
      x.setFullYear(x.getFullYear() + 1);
      wiz.patch({ basic: { maint_to: wiz.addDays(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`, -1) } });
      rerender();
    }
  });
  const pickBuild = () => openQuotePicker({
    currentId: state.quoteId, title: '구축 견적 불러오기', okLabel: '불러오기', note: '',
    filter: (q) => (q.quote_type || 'BUILD') !== 'MAINT' && (!state.type.solution || !q.solution || q.solution === state.type.solution),
    onPick: async ({ quote }) => {
      const supply = (quote.blocks || []).filter((x) => x.block_code === 'SOLUTION').flatMap((x) => x.items || [])
        .reduce((a, it) => a + (Number(it.amount) || 0), 0);
      const purpose = (String(quote.memo || '').match(/\[견적용도\]\s*(.+)/) || [])[1] || '';
      const cur = wiz.get().basic;
      wiz.patch({ basic: {
        maint_ref: quote.quote_no || '', maint_contract: purpose, maint_date: String(quote.quote_date || '').slice(0, 10), maint_supply: supply,
        // 고객 정보는 비어 있을 때만 원 견적에서 가져온다
        ...(String(cur.customer_name || '').trim() ? {} : { customer_name: quote.customer_name || '', customer_contact: quote.customer_contact || '' }),
      } });
      if (!supply) toast(`${quote.quote_no} 에 솔루션 견적 금액이 없습니다. 솔루션 공급가를 직접 넣으세요.`, 'err');
      rerender();
    },
  });
  const cells = [fld('금액 기준', basisSel, null, true)];
  if (basis === 'QUOTE') {
    cells.push(fld('원 견적', h('div', { style: 'display:flex;gap:6px' },
      h('input', { class: 'input', style: 'width:100%', value: b.maint_ref || '', readonly: true, disabled: true }),
      h('button', { class: 'btn', style: 'white-space:nowrap', disabled: !!wiz.readOnly, onclick: pickBuild }, '구축 견적 불러오기')), null, true));
  }
  cells.push(fld('원 계약명', inp('maint_contract')));
  if (basis !== 'PREV') {
    cells.push(fld('계약일', inp('maint_date', { type: 'date' })));
    cells.push(fld('솔루션 공급가', money('maint_supply'), null, true));
  } else {
    cells.push(fld('전년도 유지보수 금액 (연)', money('maint_prev'), null, true));
    cells.push(fld('인상률 (%)', pct('maint_raise')));
  }
  cells.push(fld('유지보수 시작일', fromInp), fld('유지보수 종료일', inp('maint_to', { type: 'date' })));
  return h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '유지보수 기준')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px' }, ...cells));
}

// 파일 칸 — 목록(파일명 · 크기 · 올린 사람 · 올린 날) · [파일 추가] · 끌어 놓기 · 내려받기 · 삭제. 상세(읽기 전용)는 내려받기만.
// 새 견적(번호 없음)도 올릴 수 있다(2026-11-03 사용자 요청) — 화면에 담아 두었다가(state.pendingFiles) 처음 저장할 때 같이 올린다(uploadPendingFiles).
// opts.kind — ATTACH 첨부파일 카드(기본) | CUSTOMER 고객 전달 파일(근거 자료 카드 안, opts.embed — 카드 대신 구획)
const MAX_MB = 20;

// 저장 전에 담아 둔 파일을 올린다 — 임시저장 · 결재요청이 견적을 처음 만든 뒤 부른다. 올리지 못한 파일은 담긴 채로 남긴다
export async function uploadPendingFiles(state) {
  const list = state.pendingFiles || [];
  if (!list.length || !state.quoteId) return 0;
  let ok = 0;
  const left = [];
  for (const p of list) {
    try { await http.uploadQuoteFile(state.quoteId, p.file, p.kind); ok++; }
    catch (err) { left.push(p); toast(`${p.file.name} — ${err.message}`, 'err'); }
  }
  state.pendingFiles = left;
  return ok;
}

function filesCard(state, wiz, opts = {}) {
  const kind = opts.kind || 'ATTACH';
  const what = kind === 'CUSTOMER' ? '고객 전달 파일' : '첨부파일';
  const list = h('div', {});
  const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  // 올리기 — [파일 추가] 로 고르거나 카드에 끌어 놓은 파일(2026-11-03 사용자 요청: 끌어 놓기)
  async function upload(files) {
    if (!files.length) return;
    // 아직 저장 전 — 화면에 담아 두고 처음 저장할 때 같이 올린다
    if (!state.quoteId) {
      const add = files.filter((f) => {
        if (f.size <= MAX_MB * 1048576) return true;
        toast(`${f.name} — ${MAX_MB}MB 를 넘어 담지 못했습니다.`, 'err');
        return false;
      }).map((file) => ({ file, kind, key: Date.now() + Math.random() }));
      if (!add.length) return;
      state.pendingFiles = [...(state.pendingFiles || []), ...add];
      wiz.patch({});
      toast(`${add.length}개 파일을 담았습니다. 임시저장하면 함께 올라갑니다.`, 'ok');
      paint();
      return;
    }
    let ok = 0;
    for (const f of files) {
      if (f.size > MAX_MB * 1048576) { toast(`${f.name} — ${MAX_MB}MB 를 넘어 올리지 못했습니다.`, 'err'); continue; }
      try { await http.uploadQuoteFile(state.quoteId, f, kind); ok++; } catch (err) { toast(`${f.name} — ${err.message}`, 'err'); }
    }
    if (ok) toast(`${ok}개 파일을 올렸습니다.`, 'ok');
    paint();
  }
  const picker = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: () => {
    const files = [...picker.files];
    picker.value = '';
    upload(files);
  } });
  const canEdit = !wiz.readOnly;
  const addBtn = h('button', { class: 'btn', 'data-keep': '', disabled: !canEdit, onclick: () => picker.click() }, '파일 추가');
  async function paint() {
    if (!state.quoteId) {
      // 저장 전 — 담아 둔 파일만 보인다. [빼기] 로 뺄 수 있다
      const mine = (state.pendingFiles || []).filter((p) => p.kind === kind);
      if (!mine.length) {
        list.replaceChildren(h('div', { class: 'hint', style: 'padding:6px 0' }, kind === 'CUSTOMER'
          ? 'RFP · 요청서 · 사양서 등 고객사가 보낸 파일을 이 칸에 끌어 놓거나 [파일 추가] 로 담으세요. 임시저장하면 함께 올라갑니다.'
          : '파일을 이 칸에 끌어 놓거나 [파일 추가] 로 담으세요. 임시저장하면 함께 올라갑니다.'));
        return;
      }
      list.replaceChildren(h('table', { class: 'grid', style: 'width:100%' },
        h('thead', {}, h('tr', {}, h('th', {}, '파일명'), h('th', { class: 'num', style: 'width:90px' }, '크기'),
          h('th', { style: 'width:260px' }, '상태'), h('th', { style: 'width:150px' }))),
        h('tbody', {}, ...mine.map((p) => h('tr', {},
          h('td', {}, h('span', { style: 'font-weight:600' }, p.file.name)),
          h('td', { class: 'num' }, sizeText(p.file.size)),
          h('td', { style: 'color:#B54708' }, '저장 전 — 임시저장하면 올라갑니다'),
          h('td', { style: 'text-align:right;white-space:nowrap' },
            canEdit ? h('button', { class: 'btn btn-sm btn-danger', onclick: () => {
              state.pendingFiles = (state.pendingFiles || []).filter((x) => x.key !== p.key);
              wiz.patch({});
              paint();
            } }, '빼기') : null))))));
      return;
    }
    let files = [];
    try { files = (await http.quoteFiles(state.quoteId, kind)).files || []; }
    catch (err) { list.replaceChildren(h('div', { class: 'hint', style: 'padding:6px 0' }, err.message)); return; }
    if (!files.length) {
      list.replaceChildren(h('div', { class: 'hint', style: 'padding:6px 0' }, kind === 'CUSTOMER'
        ? 'RFP · 요청서 · 사양서 등 고객사가 보낸 파일을 이 칸에 끌어 놓거나 [파일 추가] 로 올리세요.' : '첨부한 파일이 없습니다.'));
      return;
    }
    list.replaceChildren(h('table', { class: 'grid', style: 'width:100%' },
      h('thead', {}, h('tr', {}, h('th', {}, '파일명'), h('th', { class: 'num', style: 'width:90px' }, '크기'),
        h('th', { style: 'width:110px' }, '올린 사람'), h('th', { style: 'width:150px' }, '올린 날'), h('th', { style: 'width:150px' }))),
      h('tbody', {}, ...files.map((f) => h('tr', {},
        h('td', {}, h('a', { href: http.quoteFileUrl(state.quoteId, f.id), 'data-keep': '', style: 'color:var(--ss-link);font-weight:600' }, f.file_name)),
        h('td', { class: 'num' }, sizeText(Number(f.size) || 0)),
        h('td', {}, f.uploaded_by_name || '-'),
        h('td', {}, String(f.created_at || '').slice(0, 16)),
        h('td', { style: 'text-align:right;white-space:nowrap' },
          h('a', { class: 'btn btn-sm', 'data-keep': '', href: http.quoteFileUrl(state.quoteId, f.id) }, '내려받기'),
          canEdit ? h('button', { class: 'btn btn-sm btn-danger', style: 'margin-left:4px', onclick: async () => {
            if (!(await confirmModal({ title: `${what} 삭제`, danger: true, okLabel: '삭제', message: `${f.file_name} 파일을 지웁니다. 되돌릴 수 없습니다.` }))) return;
            try { await http.deleteQuoteFile(state.quoteId, f.id); toast('삭제했습니다.', 'ok'); } catch (err) { toast(err.message, 'err'); }
            paint();
          } }, '삭제') : null))))));
  }
  paint();
  const dropNote = canEdit ? ' · 파일을 이 칸에 끌어 놓아도 됩니다' : '';
  const card = opts.embed
    // 근거 자료 카드 안의 구획 — 제목 줄(이름 · 설명 · 파일 추가) + 점선 상자(목록). 점선 상자째 놓는 곳
    ? h('div', { style: 'padding:14px 0 16px;border-top:1px dashed var(--line)' },
      h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:10px' },
        h('span', { style: 'font-size:12.5px;font-weight:700;color:var(--text-1)' }, `${what} (RFP 등)`),
        h('span', { style: 'font-size:12px;color:var(--text-3)' }, `고객사가 보낸 RFP · 요청서 · 사양서 — 한 파일 ${MAX_MB}MB 까지${dropNote}`),
        h('span', { style: 'flex:1' }), wiz.readOnly ? null : addBtn, picker),
      h('div', { style: 'border:1px dashed #D0D5DD;border-radius:10px;padding:10px 14px;background:#FAFBFC' }, list))
    : h('div', { class: 'card', style: 'margin-bottom:14px' },
      h('div', { class: 'card-h' }, h('h2', {}, '첨부파일'),
        h('span', { class: 'sub' }, `견적에 함께 보관할 파일 — 한 파일 ${MAX_MB}MB 까지${dropNote}`),
        h('span', { class: 'sp' }), wiz.readOnly ? null : addBtn, picker),
      h('div', { class: 'card-b' }, list));
  // 카드 밖에 잘못 놓으면 브라우저가 파일을 열어 작성 중인 화면을 떠난다 — 앱 전체에서 한 번만 막는다
  if (!window.__q2DropGuard) {
    window.__q2DropGuard = true;
    for (const t of ['dragover', 'drop']) window.addEventListener(t, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  }
  // 끌어 놓기 — 카드 전체가 놓는 곳. 끌고 있는 동안 파란 점선 테두리. 올릴 수 없는 상태(새 견적 · 상세)면 막고 알린다
  if (!wiz.readOnly) {
    let depth = 0;
    const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const mark = (on) => { card.style.outline = on ? '2px dashed var(--ss-primary, #0747A6)' : ''; card.style.outlineOffset = on ? '-4px' : ''; card.style.background = on ? '#F0F5FF' : ''; };
    card.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; e.preventDefault(); depth++; mark(true); });
    card.addEventListener('dragover', (e) => { if (!isFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = canEdit ? 'copy' : 'none'; });
    card.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; if (--depth <= 0) { depth = 0; mark(false); } });
    card.addEventListener('drop', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault(); depth = 0; mark(false);
      upload([...e.dataTransfer.files]);
    });
  }
  return card;
}
