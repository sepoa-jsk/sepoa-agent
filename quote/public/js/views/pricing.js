import { api } from '../api.js';
import { store } from '../app.js';
import { h, won, toast, loading, clear, openModal, confirmModal } from '../ui.js';

const TYPES = ['DISCOUNT', 'BAND', 'FIXED', 'MM'];

export async function renderPricing(root) {
  const master = await store.getMaster();
  const state = { solution: master.solutions[0].code, deployment: '', items: [] };

  const solSel = h('select', { class: 'select', onchange: () => { state.solution = solSel.value; load(); } },
    ...master.solutions.map((s) => h('option', { value: s.code }, s.name)));
  const depSel = h('select', { class: 'select', onchange: () => { state.deployment = depSel.value; load(); } },
    h('option', { value: '' }, '전체 배포형태'), ...master.deployments.map((d) => h('option', { value: d.code }, d.name)));

  const tbody = h('tbody');

  root.appendChild(h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'page-title' }, '가격정책 관리'),
      h('div', { class: 'page-sub' }, '항목·단가를 수정하면 이후 작성되는 견적에 즉시 반영됩니다. (기존 저장 견적은 스냅샷 보존)')
    ),
    h('div', { class: 'page-actions' }, h('button', { class: 'btn btn-primary', onclick: () => editItem(null) }, '＋ 항목 추가'))
  ));

  root.appendChild(h('div', { class: 'filterbar' },
    h('div', { class: 'field' }, h('label', {}, '솔루션'), solSel),
    h('div', { class: 'field' }, h('label', {}, '배포형태'), depSel)
  ));

  root.appendChild(h('div', { class: 'panel' }, h('div', { class: 'table-wrap' },
    h('table', { class: 'grid' },
      h('thead', {}, h('tr', {},
        h('th', {}, '구분'), h('th', {}, '코드'), h('th', {}, '품목'), h('th', { class: 'center' }, '유형'),
        h('th', { class: 'num' }, '기준가'), h('th', { class: 'center' }, '단위'),
        h('th', { class: 'center' }, '필수'), h('th', { class: 'center' }, '반복'),
        h('th', { class: 'center' }, '구간/변형'), h('th', { class: 'center' }, '상태'), h('th', {}, '')
      )),
      tbody
    )
  )));

  async function load() {
    clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 11 }, loading())));
    try {
      const { items } = await api.pricing(state.solution, state.deployment, true);
      state.items = items;
      clear(tbody);
      if (items.length === 0) { tbody.appendChild(h('tr', {}, h('td', { colspan: 11 }, h('div', { class: 'empty' }, '항목이 없습니다.')))); return; }
      for (const it of items) {
        tbody.appendChild(h('tr', {},
          h('td', {}, h('span', { class: 'tag' }, it.category || '-')),
          h('td', { class: 'nowrap' }, it.code),
          h('td', {}, h('div', {}, h('strong', {}, it.name)), it.spec ? h('div', { class: 'page-sub' }, it.spec) : null),
          h('td', { class: 'center' }, h('span', { class: 'tag' }, it.pricing_type)),
          h('td', { class: 'num' }, won(it.base_price)),
          h('td', { class: 'center nowrap' }, it.unit || '-'),
          h('td', { class: 'center' }, it.required ? '●' : ''),
          h('td', { class: 'center' }, it.recurring ? '●' : ''),
          h('td', { class: 'center' }, String((it.variants || []).length)),
          h('td', { class: 'center' }, it.active ? h('span', { class: 'badge badge-green' }, '사용') : h('span', { class: 'badge badge-gray' }, '중지')),
          h('td', { class: 'nowrap' },
            h('button', { class: 'btn btn-sm', onclick: () => editItem(it) }, '수정'),
            ' ',
            h('button', { class: 'btn btn-sm btn-danger', onclick: () => delItem(it) }, '삭제')
          )
        ));
      }
    } catch (err) {
      clear(tbody).appendChild(h('tr', {}, h('td', { colspan: 11 }, h('div', { class: 'empty' }, err.message))));
    }
  }

  async function delItem(it) {
    const ok = await confirmModal({ title: '항목 중지', message: `${it.name} (${it.code}) 항목을 사용 중지하시겠습니까?`, okLabel: '중지', danger: true });
    if (!ok) return;
    try { await api.del(`/api/pricing/items/${it.id}`); toast('중지되었습니다.', 'ok'); load(); }
    catch (err) { toast(err.message, 'err'); }
  }

  function editItem(it) {
    const isNew = !it;
    const f = {
      solution: it?.solution || state.solution,
      deployment: it?.deployment || (state.deployment || master.deployments[0].code),
      category: it?.category || '', code: it?.code || '', name: it?.name || '', spec: it?.spec || '',
      pricing_type: it?.pricing_type || 'FIXED', base_price: it?.base_price ?? 0, unit: it?.unit || '',
      qty_default: it?.qty_default ?? 1, required: it?.required ?? 0, recurring: it?.recurring ?? 0,
      note: it?.note || '', active: it?.active ?? 1,
    };
    let variants = (it?.variants || []).map((v) => ({ key: v.key || '', label: v.label || '', min_qty: v.min_qty, max_qty: v.max_qty, rate: v.rate, price: v.price }));

    const inp = (k, attrs = {}) => h('input', { class: 'input', value: f[k] ?? '', oninput: (e) => { f[k] = e.target.value; }, ...attrs });
    const typeSel = h('select', { class: 'select', onchange: () => { f.pricing_type = typeSel.value; renderVariants(); } },
      ...TYPES.map((t) => h('option', { value: t, selected: t === f.pricing_type }, t)));
    const solSel2 = h('select', { class: 'select', onchange: () => { f.solution = solSel2.value; } }, ...master.solutions.map((s) => h('option', { value: s.code, selected: s.code === f.solution }, s.code)));
    const depSel2 = h('select', { class: 'select', onchange: () => { f.deployment = depSel2.value; } }, ...master.deployments.map((d) => h('option', { value: d.code, selected: d.code === f.deployment }, d.code)));
    const reqSel = h('select', { class: 'select', onchange: () => { f.required = Number(reqSel.value); } }, h('option', { value: '0', selected: !f.required }, '선택'), h('option', { value: '1', selected: !!f.required }, '필수'));
    const recSel = h('select', { class: 'select', onchange: () => { f.recurring = Number(recSel.value); } }, h('option', { value: '0', selected: !f.recurring }, '일시'), h('option', { value: '1', selected: !!f.recurring }, '월반복'));

    const variantsBox = h('div', {});
    function renderVariants() {
      clear(variantsBox);
      const t = f.pricing_type;
      if (t === 'FIXED') { variantsBox.appendChild(h('div', { class: 'page-sub' }, 'FIXED 유형은 기준가만 사용합니다 (변형 없음).')); return; }
      const cols = t === 'BAND' ? ['label', 'min_qty', 'max_qty', 'price'] : t === 'MM' ? ['key', 'rate'] : ['key', 'price'];
      const head = h('tr', {}, ...cols.map((c) => h('th', {}, c)), h('th', {}, ''));
      const vbody = h('tbody');
      variants.forEach((v, idx) => vbody.appendChild(vrow(v, idx, cols)));
      variantsBox.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'grid' }, h('thead', {}, head), vbody)));
      variantsBox.appendChild(h('button', { class: 'btn btn-sm', style: 'margin-top:8px', onclick: () => { variants.push({}); renderVariants(); } }, '＋ 변형 추가'));

      function vrow(v, idx, cols) {
        const cells = cols.map((c) => h('td', {}, h('input', { class: 'input', style: 'height:28px', value: v[c] ?? '', oninput: (e) => {
          const val = e.target.value;
          v[c] = (c === 'label' || c === 'key') ? val : (val === '' ? null : Number(val));
        } })));
        return h('tr', {}, ...cells, h('td', {}, h('button', { class: 'btn btn-sm btn-danger', onclick: () => { variants.splice(idx, 1); renderVariants(); } }, '×')));
      }
    }
    renderVariants();

    const body = h('div', {},
      h('div', { class: 'form-grid' },
        fld('솔루션', solSel2), fld('배포형태', depSel2),
        fld('구분', inp('category')), fld('코드', inp('code', { disabled: !isNew })),
        fld('품목명', inp('name'), true), fld('규격', inp('spec'), true),
        fld('가격유형', typeSel), fld('기준가(base_price)', inp('base_price', { type: 'number' })),
        fld('단위', inp('unit')), fld('기본수량', inp('qty_default', { type: 'number', step: '0.01' })),
        fld('필수여부', reqSel), fld('반복여부', recSel),
        fld('비고', inp('note'), true)
      ),
      h('div', { style: 'margin-top:16px' }, h('div', { class: 'panel-head', style: 'padding:0 0 8px;border:none' }, '변형 (variants)'), variantsBox)
    );

    const saveBtn = h('button', { class: 'btn btn-primary' }, isNew ? '생성' : '저장');
    const modal = openModal({ title: isNew ? '가격정책 항목 추가' : '가격정책 항목 수정', body,
      footer: [h('button', { class: 'btn', onclick: () => modal.close() }, '취소'), saveBtn] });

    saveBtn.onclick = async () => {
      if (!f.code || !f.name) return toast('코드와 품목명은 필수입니다.', 'err');
      const payload = { ...f, base_price: Number(f.base_price) || 0, qty_default: Number(f.qty_default) || 1,
        variants: f.pricing_type === 'FIXED' ? [] : variants };
      saveBtn.disabled = true;
      try {
        if (isNew) await api.post('/api/pricing/items', payload);
        else await api.put(`/api/pricing/items/${it.id}`, payload);
        toast('저장되었습니다.', 'ok'); modal.close(); load();
      } catch (err) { toast(err.message, 'err'); saveBtn.disabled = false; }
    };

    function fld(label, input, full) { return h('div', { class: full ? 'field full' : 'field' }, h('label', {}, label), input); }
  }

  load();
}
