// STEP① 기본정보 — 시안 #s4 구조.
// 자사 정보는 sq_settings 값을 읽기 전용으로 보여준다. 견적서마다 다르게 입력되는 것을 막는 게 목적이다.
import { api as http } from '../../../api.js';
import { h } from '../../../ui.js';

let settingsCache = null;

async function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    const r = await http.getSettings();
    settingsCache = r.settings || r || {};
  } catch { settingsCache = {}; }
  return settingsCache;
}

const fld = (label, el, hint) => h('div', { class: 'fld' },
  h('label', {}, label), el, hint ? h('div', { class: 'hint' }, hint) : null);

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
    },
  });
  const ro = (val) => h('input', { class: 'input', style: 'width:100%', value: val || '', readonly: true, disabled: true });

  root.replaceChildren();

  // ── 고객 정보 ──
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '고객 정보'),
      h('span', { class: 'sub' }, '고객사 마스터는 작업 13에서 연동됩니다')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px' },
      fld('수신처 (고객사명)', inp('customer_name', { ph: '예) 솔브레인' })),
      fld('담당자', inp('customer_contact', { ph: '예) 김OO 책임' })),
      fld('견적용도', inp('purpose', { ph: '예) 전자계약관리 시스템 견적_구축형' })),
      // 연락처·이메일은 견적서 본문이 아니라 메모에 실린다(구 화면과 동일).
      fld('연락처', inp('phone', { ph: '예) 010-0000-0000' })),
      fld('이메일', inp('email', { ph: '예) name@company.co.kr' })),
      fld('기업구분', ro(''), '마스터 연동 예정 — 현재 고객사 마스터가 없습니다'),
      fld('채널', ro(''), '마스터 연동 예정'),
      fld('견적번호', ro('저장 시 자동 채번 (SYYYYMMDD###)'), '형식 전환은 작업 10'))));

  // ── 견적 조건 ──
  root.appendChild(h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('div', { class: 'card-h' }, h('h2', {}, '견적 조건')),
    h('div', { class: 'card-b', style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:0 14px' },
      fld('견적일자', inp('quote_date', { type: 'date' })),
      fld('견적유효일', ro(b.valid_until), '견적일 + 30일 자동'),
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
