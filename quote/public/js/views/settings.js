import { api } from '../api.js';
import { h, toast, loading, clear } from '../ui.js';

// 공급자 정보 등 알려진 설정 키 (추가 키도 표시)
const KNOWN = [
  ['supplier_name', '상호'],
  ['supplier_regno', '사업자등록번호'],
  ['supplier_ceo', '대표자'],
  ['supplier_addr', '주소'],
  ['seal_image_path', '인감 이미지 경로'],
];
const TEMPLATE_KEY = 'quote_condition_templates';
const DEFAULT_COND_TEMPLATES = [
  { text: '프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.', auto: false },
  { text: '개발단가는 한국SW산업협회 노임 단가 기준 {laborRate}%를 적용하였습니다.', auto: true },
  { text: '동일서버 내 Company 추가시 License는 솔루션 공급가의 25%가 적용됩니다.(서버 분리시 50%)', auto: false },
  { text: '솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.', auto: false },
  { text: '본 프로젝트는 {onsiteLabel} 제안합니다. 업무 협의, 통합테스트 등 필요시에는 방문 진행합니다.', auto: true },
  { text: 'PKI툴킷은 서버 이중화 구성시 2식이 필요합니다.', auto: false },
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
      h('div', { class: 'page-sub' }, '견적서 공급자 정보와 견적조건 템플릿을 관리합니다. (하드코딩 없이 여기서 관리)')
    )
  ));

  // ── 공급자 정보(일반 key-value) — 템플릿 키는 제외 ──
  const inputs = {};
  const keys = [...new Set([...KNOWN.map((k) => k[0]), ...Object.keys(settings)])].filter((k) => k !== TEMPLATE_KEY);
  const labelOf = (k) => (KNOWN.find((x) => x[0] === k)?.[1]) || k;
  const rows = keys.map((k) => {
    const isAddr = k === 'supplier_addr';
    const input = h(isAddr ? 'textarea' : 'input', { class: isAddr ? 'textarea' : 'input', rows: 2, value: settings[k] ?? '' });
    inputs[k] = input;
    return h('div', { class: 'field', style: 'margin-bottom:14px' }, h('label', {}, labelOf(k), '  ', h('span', { class: 'page-sub' }, k)), input);
  });

  // ── 견적조건 템플릿 ──
  let templates = DEFAULT_COND_TEMPLATES;
  try { if (settings[TEMPLATE_KEY]) { const p = JSON.parse(settings[TEMPLATE_KEY]); if (Array.isArray(p)) templates = p; } } catch { /* 기본값 */ }
  const tplRows = templates.map((t) => ({ text: t.text || '', auto: !!t.auto }));

  const tplList = h('div', {});
  function renderTpl() {
    clear(tplList);
    tplRows.forEach((t, i) => tplList.appendChild(tplRow(t, i)));
  }
  function tplRow(t, i) {
    const inp = h('input', { class: 'input', style: 'flex:1', value: t.text, oninput: (e) => { t.text = e.target.value; } });
    const auto = h('input', { type: 'checkbox', checked: t.auto, onchange: (e) => { t.auto = e.target.checked; } });
    const swap = (a, b) => { [tplRows[a], tplRows[b]] = [tplRows[b], tplRows[a]]; renderTpl(); };
    return h('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px' },
      inp,
      h('label', { style: 'display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap', title: '자동 갱신(변수 치환) 문구' }, auto, '자동'),
      h('button', { class: 'btn btn-sm', title: '위로', onclick: () => { if (i > 0) swap(i - 1, i); } }, '▲'),
      h('button', { class: 'btn btn-sm', title: '아래로', onclick: () => { if (i < tplRows.length - 1) swap(i, i + 1); } }, '▼'),
      h('button', { class: 'btn btn-sm btn-danger', onclick: () => { tplRows.splice(i, 1); renderTpl(); } }, '삭제'));
  }
  renderTpl();
  const addTpl = h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => { tplRows.push({ text: '', auto: false }); renderTpl(); } }, '＋ 조건 추가');
  const varHelp = h('div', { class: 'page-sub', style: 'margin-bottom:10px;line-height:1.7' },
    '치환 변수: {laborRate}=인력 적용네고율 · {moduleRate}=모듈 적용네고율 · {onsiteLabel}=상주(상주로/부분상주로) · {companyLabel}=기업구분명. ',
    h('br'), '"자동" 체크 시 견적 작성에서 변수 치환·자동 갱신됩니다(직접 수정한 줄은 고정).');

  // ── 저장 (공급자 + 템플릿 함께) ──
  const saveBtn = h('button', { class: 'btn btn-navy' }, '저장');
  saveBtn.onclick = async () => {
    const payload = {};
    for (const k of keys) payload[k] = inputs[k].value;
    payload[TEMPLATE_KEY] = JSON.stringify(tplRows.filter((t) => t.text.trim()).map((t) => ({ text: t.text, auto: !!t.auto })));
    saveBtn.disabled = true;
    try { await api.putSettings(payload); toast('저장되었습니다.', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    finally { saveBtn.disabled = false; }
  };

  root.appendChild(h('div', { class: 'panel', style: 'max-width:760px;margin-bottom:16px' },
    h('div', { class: 'panel-head' }, '공급자 정보'),
    h('div', { class: 'panel-body' }, ...rows)
  ));
  root.appendChild(h('div', { class: 'panel', style: 'max-width:760px' },
    h('div', { class: 'panel-head' }, '견적조건 템플릿'),
    h('div', { class: 'panel-body' }, varHelp, tplList, addTpl)
  ));
  root.appendChild(h('div', { style: 'max-width:760px;margin-top:12px' }, saveBtn));
}
