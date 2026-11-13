import { api } from '../api.js';
import { h, toast, clear, loading } from '../ui.js';

// 회사정보 — 시스템관리 > 조직 의 첫 탭(org.js). 2026-11-03 사용자 요청: "견적서 작성시 자사정보는 다 아는 내용이야. 마스터에 별도 관리" → "조직을 회사정보, 부서정보로".
// 견적서 공급자 칸(상호 · 대표이사 · 사업자등록번호 · 주소 · 연락처 · 인감)에 들어가는 값. 견적 작성 화면에서는 보이지 않는다.
// L2 작성형 — 우상단 저장, 4칸 격자 폼. 저장 위치는 예전 그대로 설정(sq_settings)의 supplier_* 키 — 새 표 없음.
export const COMPANY_KEYS = [
  ['supplier_name', '상호', ''],
  ['supplier_ceo', '대표이사', ''],
  ['supplier_regno', '사업자등록번호', '예) 119-81-95026'],
  ['supplier_tel', '연락처', '예) 02-6242-3094'],
  ['supplier_addr', '주소', '', 'full'],
  ['seal_image_path', '인감 이미지 경로', '서버의 인감 이미지 파일 경로', 'full'],
];

export async function renderCompany(root) {
  root.appendChild(loading());
  let settings;
  try { ({ settings } = await api.getSettings()); }
  catch (err) { clear(root).appendChild(h('div', { class: 'ss-cell--empty', style: 'padding:16px' }, err.message)); return; }
  clear(root);

  const inputs = {};
  const field = ([key, label, ph, wide]) => {
    inputs[key] = h('input', { class: 'ss-input', value: settings[key] ?? '', placeholder: ph, 'aria-label': label });
    return h('div', { class: 'ss-field' + (wide ? ' ss-field--full' : '') }, h('label', {}, label), inputs[key]);
  };

  async function save() {
    const payload = Object.fromEntries(COMPANY_KEYS.map(([k]) => [k, inputs[k].value.trim()]));
    try {
      await api.putSettings(payload);
      toast('저장되었습니다. 새로 만드는 견적서부터 반영됩니다.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  root.appendChild(h('div', { class: 'ss-edithead' },
    h('div', { class: 'ss-edithead__fields' }),
    h('div', { class: 'ss-actions' }, h('button', { class: 'ss-btn ss-btn--save', onclick: save }, '저장'))));
  root.appendChild(h('div', { class: 'ss-detailbar', style: 'margin-top:12px' },
    h('span', { class: 'ss-detailbar__note' }, '견적서의 공급자(자사) 정보입니다. 견적 작성 화면에는 나오지 않고, 견적서 · PDF · Excel 에 자동으로 들어갑니다.')));
  root.appendChild(h('div', { class: 'ss-form ss-form--cols4', style: 'max-width:none;margin:12px 0 0' },
    h('div', { class: 'ss-fields' }, ...COMPANY_KEYS.map(field))));
}
