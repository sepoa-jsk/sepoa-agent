// STEP② 기본정보 (유형 선택 다음) — 시안 #s4 구조.
// 자사 정보는 sq_settings 값을 읽기 전용으로 보여준다. 견적서마다 다르게 입력되는 것을 막는 게 목적이다.
import { api as http } from '../../../api.js';
import { pickCustomer } from '../pickers.js';
import { store } from '../../../app.js';
import { h, toast } from '../../../ui.js';
import { syncPurpose } from './step3-config.js';
import { CHANNELS } from '../../customers.js';

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

let settingsCache = null;

async function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    const r = await http.getSettings();
    settingsCache = r.settings || r || {};
  } catch { settingsCache = {}; }
  return settingsCache;
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
  // 연락처는 사용자 정보에 없어 직접 넣는다. 지우면 다시 채우지 않는다.
  if (!state.quoteId && !wiz.readOnly && !b.rep_filled && store.profile) {
    const p = store.profile;
    wiz.patch({ basic: { rep_filled: true,
      rep_name: b.rep_name || [p.name, p.position].filter(Boolean).join(' '),
      rep_email: b.rep_email || p.email || '' } });
    return renderStep1(root, wiz.get(), wiz);
  }
  // 견적용도 — 비어 있으면 고객명 + 솔루션 + 구축 견적 (서비스명) 으로 채운다
  if (await syncPurpose(wiz)) return renderStep1(root, wiz.get(), wiz);

  // 근거 메일 — 붙여넣으면 고객 정보를 뽑아 빈 칸에만 채운다(이미 넣은 값은 둔다). 링크는 저장만 한다(메일 시스템에서 읽어 오지 못한다)
  const mailText = h('textarea', { class: 'input', placeholder: '고객사에서 온 메일을 그대로 복사해 붙여넣으세요. 보낸 사람 · 연락처 · 이메일을 읽어 위의 빈 칸에 채웁니다.',
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

  // ── 고객 정보 — 고객사 · 고객 담당자 · 연락처 · 이메일 · 기업구분 + 근거 메일(2026-11-02 사용자 요청으로 한 영역에 모음) ──
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '고객 정보'),
      h('span', { class: 'sub' }, '[고객사 선택] 이나 근거 메일로 채울 수 있습니다'),
      h('span', { class: 'sp' }), h('span', { class: 'req-note' }, h('b', {}, '*'), ' 표시는 꼭 입력해야 다음 단계로 갈 수 있습니다')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px' },
      // 직접 입력하거나 [고객사 선택] 팝업(고객사 마스터)에서 골라 담당자 · 연락처 · 이메일까지 채운다
      fld(b.channel === 'AGENCY' ? '수신처 (중간업체)' : '수신처 (고객사명)', h('div', { style: 'display:flex;gap:6px' }, inp('customer_name', { ph: '예) 솔브레인' }),
        h('button', { class: 'btn', style: 'white-space:nowrap', onclick: async () => {
          const c = await pickCustomer();
          if (!c) return;
          wiz.patch({ basic: { customer_name: c.name || '', customer_contact: c.contact_name || '',
            phone: c.contact_phone || '', email: c.contact_email || '', company_class: c.company_key || b.company_class || null,
            channel: c.channel || b.channel || null } });
          await syncPurpose(wiz);
          renderStep1(root, wiz.get(), wiz);
        } }, '고객사 선택')), null, true),
      fld('고객 담당자', inp('customer_contact', { ph: '예) 김OO 책임' })),
      fld('기업구분', (() => {
        const opts = companyOptions(state.type && state.type.solution);
        // 저장된 값이 지금 선택지에 없으면(사용 중지 등) 그대로 보이게 한 줄 더 둔다
        if (b.company_class && !opts.some(([k]) => k === b.company_class)) opts.push([b.company_class, b.company_class]);
        return h('select', { class: 'input', style: 'width:100%', disabled: !!wiz.readOnly,
          onchange: (e) => wiz.patch({ basic: { company_class: e.target.value || null } }) },
        h('option', { value: '' }, '선택'),
        ...opts.map(([k, label]) => h('option', { value: k, selected: k === b.company_class }, label)));
      })(), '고객사를 고르면 고객사의 기업구분으로 채워집니다'),
      // 연락처·이메일은 견적서 본문이 아니라 메모에 실린다(구 화면과 동일).
      fld('연락처', inp('phone', { ph: '예) 010-0000-0000' })),
      fld('이메일', inp('email', { ph: '예) name@company.co.kr' })),
      h('div'),
      // 근거 메일 — 이 견적의 근거(고객 요청 메일). 링크와 본문 둘 다 저장한다(V14)
      h('div', { style: 'grid-column:1 / -1;border-top:1px dashed var(--line);padding-top:12px;margin-top:2px' },
        h('div', { style: 'font-size:12px;font-weight:700;color:var(--text-1);margin-bottom:8px' }, '근거 메일',
          h('span', { style: 'font-weight:400;color:var(--text-3);margin-left:8px' }, '이 견적의 근거가 되는 고객사 메일 — 링크가 안 되면 본문을 붙여넣으세요')),
        fld('메일 링크', inp('mail_url', { ph: '예) https://mail.google.com/mail/u/0/#inbox/…' }), '링크는 저장만 합니다 — 고객 정보를 읽어 오려면 아래에 본문을 붙여넣으세요'),
        fld('메일 본문', mailText)))));

  // ── 견적 정보 — 채널 · 최종 고객사 · 견적용도 · 견적번호 · 상태(고객 정보와 나눔) ──
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '견적 정보')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px' },
      // 채널 — 고객사와 바로 하는지, 컨설팅펌 · SI 업체 등을 끼고 하는지. 고객사를 고르면 고객사 마스터 값으로 채운다
      fld('채널', h('select', { class: 'input', style: 'width:100%', disabled: !!wiz.readOnly,
        onchange: async (e) => { wiz.patch({ basic: { channel: e.target.value || null } }); await syncPurpose(wiz); renderStep1(root, wiz.get(), wiz); } },
      h('option', { value: '' }, '선택'),
      ...CHANNELS.map(([k, label]) => h('option', { value: k, selected: k === b.channel }, label))), '고객사를 고르면 고객사의 채널로 채워집니다'),
      // 최종 고객사 — 간접일 때만. 수신처에는 중간업체(컨설팅펌 · SI), 여기에는 실제 고객(견적용도에 들어간다)
      b.channel === 'AGENCY' ? fld('최종 고객사', inp('end_customer', { ph: '예) JW' }), '간접 견적 — 견적용도에 이 이름이 들어갑니다') : null,
      fld('견적용도', inp('purpose', { ph: '예) 전자계약관리 시스템 견적_구축형' })),
      fld('견적번호', ro(state.quoteNo || '저장 시 자동 채번 (QTYYYYMMDD_NNN)'), state.quoteNo ? '저장된 견적 — 번호는 바뀌지 않습니다' : '임시저장 또는 발행 시 채번'),
      // 2차 이상 — 차수 추가 때 넣은 사유(읽기 전용)
      state.revision > 1 ? fld(`차수 추가 사유 (${state.revision}차)`, ro(state.revisionReason || '-')) : null,
      h('div', { 'data-keep': '' }, fld('상태', wiz.statusSelect(), wiz.readOnly ? '상세에서도 바로 바뀝니다' : '저장할 때 함께 저장됩니다')))));

  // ── 담당자 정보(우리 영업 담당) — 고객 정보와 따로(2026-11-02 사용자 요청) ──
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '담당자 정보'),
      h('span', { class: 'sub' }, '견적을 작성하는 영업 담당자 — 로그인한 사용자 정보로 채워집니다')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px' },
      fld('담당자', inp('rep_name', { ph: '예) 홍길동 책임' })),
      fld('연락처', inp('rep_phone', { ph: '예) 010-0000-0000' }), '사용자 정보에 연락처가 없어 직접 입력합니다'),
      fld('이메일', inp('rep_email', { ph: '예) name@sepoasoft.co.kr' })))));

  // ── 견적 조건 ──
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '견적 조건')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px' },
      fld('견적일자', inp('quote_date', { type: 'date' }), null, true),
      // 견적유효일 — 달력으로 바꿀 수 있다(2026-11-02 사용자 요청). 견적일자를 바꾸면 +30일로 다시 맞춘다
      fld('견적유효일', inp('valid_until', { type: 'date' }), '기본은 견적일 + 30일, 직접 바꿀 수 있습니다'),
      fld('결제조건', inp('pay_terms')),
      fld('설치완료', inp('install_note')))));

  // ── 자사 정보 (읽기 전용) ──
  const s = await loadSettings();
  const miss = (v) => (v && String(v).trim() ? String(v) : null);
  const rows = [
    ['상호', miss(s.supplier_name)],
    ['대표이사', miss(s.supplier_ceo)],
    ['사업자등록번호', miss(s.supplier_regno)],
    ['주소', miss(s.supplier_addr)],
    ['연락처', miss(s.supplier_tel)],
    ['인감 이미지', miss(s.seal_image_path)],
  ];
  const missing = rows.filter(([, v]) => !v).length;
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' },
      h('h2', {}, '자사 정보'),
      h('span', { class: 'sub' }, '설정에서 관리합니다. 견적마다 다르게 입력되지 않도록 읽기 전용입니다.'),
      h('span', { class: 'sp' }),
      missing ? h('span', { class: 'badge badge-yellow' }, `미설정 ${missing}건`) : null),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px' },
      ...rows.map(([k, v]) => fld(k, ro(v || ''), v ? null : '설정 필요 — 설정 화면에서 입력')))));

  // ── RFP 업로드 (UI 만) ──
  root.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', {}, 'RFP 분석'), h('span', { class: 'sub' }, '준비 중')),
    h('div', { class: 'card-b' },
      h('div', {
        style: 'border:1px dashed var(--line);border-radius:var(--radius);padding:22px;text-align:center;'
          + 'color:var(--text-3);background:#FAFBFC',
      },
        h('div', { style: 'font-size:12.5px;margin-bottom:4px' }, 'RFP 문서를 올리면 요건을 자동 분석합니다'),
        h('button', { class: 'btn', disabled: true, style: 'margin-top:8px' }, '파일 선택 (준비 중)')))));
}
