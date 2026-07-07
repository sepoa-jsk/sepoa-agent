import { api } from '../api.js';
import { h, toast, loading, clear } from '../ui.js';

// 공급자 정보 등 알려진 설정 키 (추가 키도 표시)
const KNOWN = [
  ['supplier_name', '상호'],
  ['supplier_biz_no', '사업자등록번호'],
  ['supplier_ceo', '대표자'],
  ['supplier_address', '주소'],
  ['seal_image_path', '인감 이미지 경로'],
];

export async function renderSettings(root) {
  root.appendChild(loading());
  let settings;
  try { ({ settings } = await api.getSettings()); }
  catch (err) { clear(root).appendChild(h('div', { class: 'empty' }, err.message)); return; }
  clear(root);

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '설정'),
      h('div', { class: 'page-sub' }, '견적서에 표기되는 공급자 정보입니다. (하드코딩 없이 여기서 관리)')
    )
  ));

  const inputs = {};
  const keys = [...new Set([...KNOWN.map((k) => k[0]), ...Object.keys(settings)])];
  const labelOf = (k) => (KNOWN.find((x) => x[0] === k)?.[1]) || k;

  const rows = keys.map((k) => {
    const input = h(k === 'supplier_address' ? 'textarea' : 'input',
      { class: k === 'supplier_address' ? 'textarea' : 'input', rows: 2, value: settings[k] ?? '' });
    inputs[k] = input;
    return h('div', { class: 'field', style: 'margin-bottom:14px' }, h('label', {}, labelOf(k), '  ', h('span', { class: 'page-sub' }, k)), input);
  });

  const saveBtn = h('button', { class: 'btn btn-navy' }, '저장');
  saveBtn.onclick = async () => {
    const payload = {};
    for (const k of keys) payload[k] = inputs[k].value;
    saveBtn.disabled = true;
    try { await api.putSettings(payload); toast('저장되었습니다.', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    finally { saveBtn.disabled = false; }
  };

  root.appendChild(h('div', { class: 'panel', style: 'max-width:640px' },
    h('div', { class: 'panel-head' }, '공급자 정보'),
    h('div', { class: 'panel-body' }, ...rows, h('div', { style: 'margin-top:8px' }, saveBtn))
  ));
}
