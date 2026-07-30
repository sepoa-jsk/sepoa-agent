'use strict';
// 견적서 PDF용 HTML 렌더러. 표지 + 견적서(솔루션/인건비/유지보수/합계) + 견적조건.
// 헤드리스 Chrome 이 이 HTML 을 그대로 A4 PDF 로 인쇄한다(로고·인감 이미지 정상).
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
function dataUri(file) {
  try { return 'data:image/png;base64,' + fs.readFileSync(path.join(ASSETS, file)).toString('base64'); }
  catch { return null; }
}
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');

function renderQuoteHtml(quote, settings = {}, masters = {}) {
  const memo = String(quote.memo || '');
  const tag = (t) => { const m = memo.match(new RegExp('\\[' + t + '\\]\\s*(.+)')); return m ? m[1].trim() : ''; };
  const purpose = tag('견적용도');
  const payTerms = tag('결제조건') || '고객사 결제조건';
  const vatIncluded = tag('부가세') === '포함';
  const onsiteText = tag('상주') || '상주';

  const laborInfo = masters.laborInfo || {};
  const nameOfSolution = (c) => (masters.solutionNames && masters.solutionNames[c]) || c;

  const MAINT = ['유지보수', '운영유지보수', '유지관리'];
  const solItems = [], labItems = [], maintItems = [];
  let solutionCode = null;
  for (const sec of quote.sections || []) for (const it of sec.items || []) {
    if (it.category === '시스템구축') labItems.push(it);
    else if (MAINT.includes(it.category)) maintItems.push(it);
    else { solItems.push(it); if (!solutionCode) solutionCode = sec.solution; }
  }
  const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const solSub = sum(solItems, (i) => i.amount);
  const labSub = sum(labItems, (i) => i.amount);
  const maintSub = sum(maintItems, (i) => i.amount);
  const buildAmt = solSub + labSub;
  const disc = Number(quote.discount_amount) || 0;
  const vat = Number(quote.vat_amount) || 0;
  const grand = Number(quote.total_amount) || 0;
  const total = Number(quote.supply_amount) || (buildAmt + maintSub);
  const finalAmt = total - disc;

  const baseOfLabor = (it) => { const v = laborInfo[it.item_code] && laborInfo[it.item_code].base; return v != null ? Number(v) : null; };
  const baseOfSolution = (it) => (it.base_price != null ? Number(it.base_price) : null);
  const laborNego = labItems.find((i) => baseOfLabor(i));
  const negoPct = laborNego ? Math.round(Number(laborNego.unit_price) / baseOfLabor(laborNego) * 100) : 100;

  const logo = dataUri('logo.png'), seal = dataUri('seal.png'), bandTop = dataUri('band_top.png'), bandBot = dataUri('band_bottom.png');
  const supplier = settings.supplier_name || '㈜세포아소프트';
  const ceo = settings.supplier_ceo || '이 희 림';
  const addr = settings.supplier_addr || '서울특별시 구로구 디지털로31길 62, 아티스포럼 714~717호';

  const conds = (Array.isArray(quote.conditions) && quote.conditions.length)
    ? quote.conditions.map((c) => c.text).filter(Boolean)
    : [
      '프로젝트 투입공수 및 일정은 세부 업무요건에 따라 변경될 수 있습니다.',
      `개발단가는 한국SW산업협회 노임 단가 기준 ${negoPct}%를 적용하였습니다.`,
      '솔루션 유지보수는 시스템 오픈 후 12개월간 무상유지보수 이후 진행되며, 유상유지보수는 솔루션 공급가의 15%로 제안합니다.',
      `본 프로젝트는 ${onsiteText}로 진행합니다.`,
    ];

  const rows = (items, gubun, baseOf) => {
    if (!items.length) return '<tr><td colspan="7" class="c muted">(항목 없음)</td></tr>';
    return items.map((it, i) => {
      const bp = baseOf(it);
      return '<tr>'
        + (i === 0 ? `<td class="gubun" rowspan="${items.length}">${esc(gubun)}</td>` : '')
        + `<td>${esc(it.name)}</td><td>${esc(it.spec || '')}</td>`
        + `<td class="c">${Number(it.qty) || 0}</td>`
        + `<td class="r">${bp != null && bp > 0 ? won(bp) : ''}</td>`
        + `<td class="r">${won(it.unit_price)}</td><td class="r b">${won(it.amount)}</td></tr>`;
    }).join('');
  };
  const labRows = labItems.map((it) => ({ ...it, spec: it.spec || (laborInfo[it.item_code] && laborInfo[it.item_code].grade) || '' }));

  // ── 블록형 견적 여부 + 블록 단위 렌더 ──
  const isBlock = (quote.sections || []).some((s) => (s.labor || []).length || (s.items || []).some((it) => it.block_code));
  const blockDefs = masters.blockDefs || {};
  let bodyTablesHtml, totalsHtml;

  if (isBlock) {
    const groups = {};
    const ensure = (code) => (groups[code] = groups[code] || { code, name: (blockDefs[code] && blockDefs[code].name) || code, recurring: !!(blockDefs[code] && blockDefs[code].recurring), sort: (blockDefs[code] && blockDefs[code].sort) ?? 99, rows: [] });
    for (const sec of quote.sections || []) {
      for (const it of sec.items || []) ensure(it.block_code || 'ETC').rows.push({ name: it.name, spec: it.spec || '', qty: Number(it.qty) || 0, base: it.base_price, proposed: it.proposed_price != null ? it.proposed_price : it.unit_price, amount: it.amount });
      for (const l of sec.labor || []) ensure('LABOR').rows.push({ name: l.role_name || l.role_code, spec: l.task || '', qty: Number(l.mm) || 0, base: l.base_price, proposed: l.proposed_price, amount: l.amount, isLabor: true });
    }
    const order = Object.values(groups).sort((a, b) => a.sort - b.sort);
    const blockTable = (g) => {
      const isLabor = g.code === 'LABOR';
      const sub = g.rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const body = g.rows.length ? g.rows.map((r, i) =>
        `<tr>${i === 0 ? `<td class="gubun" rowspan="${g.rows.length}">${esc(g.name)}</td>` : ''}<td>${esc(r.name)}</td><td>${esc(r.spec)}</td><td class="c">${r.qty}</td><td class="r">${r.base != null && r.base > 0 ? won(r.base) : ''}</td><td class="r">${won(r.proposed)}</td><td class="r b">${won(r.amount)}</td></tr>`).join('')
        : '<tr><td colspan="7" class="c muted">(항목 없음)</td></tr>';
      return `<div class="sec">▣ ${esc(g.name)}${g.recurring ? ' <span style="font-weight:400;color:#888">(월정액)</span>' : ''}</div>`
        + `<table class="grid"><tr><th>구분</th><th>${isLabor ? '역할' : '모듈'}</th><th>세부내역</th><th>${isLabor ? '공수(MM)' : '수량'}</th><th>기준단가</th><th>${g.recurring ? '제안단가(월)' : '제안단가'}</th><th>${g.recurring ? '제안금액(월)' : '제안금액'}</th></tr>`
        + `${body}<tr class="subrow"><td colspan="6" class="r">${esc(g.name)} 소계${g.recurring ? '(월)' : ''}</td><td class="r">${won(sub)}</td></tr></table>`;
    };
    bodyTablesHtml = order.map(blockTable).join('\n');
    const afterDc = total - disc; // = 공급가액(별도) 기준
    totalsHtml = `<table class="tot">
      <tr><td class="r">블록 소계 합계</td><td class="r b" style="width:150px">${won(total)}</td></tr>
      ${disc > 0 ? `<tr><td class="r">특별 DC</td><td class="r">-${won(disc)}</td></tr>` : ''}
      <tr><td class="r b">공급가액</td><td class="r b">${won(vatIncluded ? Math.round(afterDc / 1.1) : afterDc)}</td></tr>
      <tr><td class="r">부가세 ${vatIncluded ? '(포함)' : '(별도, 10%)'}</td><td class="r">${won(vat)}</td></tr>
      <tr><td class="r grand">총 견적가</td><td class="r grand">${won(grand)} 원</td></tr></table>`;
  } else {
    bodyTablesHtml = `<div class="sec">▣ 솔루션 견적</div>
      <table class="grid"><tr><th>구분</th><th>모듈</th><th>세부기능</th><th>수량</th><th>기준단가</th><th>제안단가</th><th>제안금액</th></tr>
      ${rows(solItems, nameOfSolution(solutionCode) || '솔루션', baseOfSolution)}
      <tr class="subrow"><td colspan="6" class="r">솔루션 소계 (①)</td><td class="r">${won(solSub)}</td></tr></table>
      <div class="sec">▣ 시스템 구축 견적 (인건비)</div>
      <table class="grid"><tr><th>구분</th><th>역할</th><th>세부내역(등급)</th><th>공수(MM)</th><th>기준단가</th><th>제안단가</th><th>제안금액</th></tr>
      ${rows(labRows, '시스템구축', baseOfLabor)}
      <tr class="subrow"><td colspan="6" class="r">인건비 소계 (②)</td><td class="r">${won(labSub)}</td></tr></table>
      ${maintItems.length ? `<div class="sec">▣ 유지보수 견적</div><table class="grid"><tr><th>구분</th><th>역할</th><th>세부내역</th><th>공수(MM)</th><th>기준단가</th><th>제안단가</th><th>제안금액</th></tr>${rows(maintItems, '유지보수', baseOfLabor)}<tr class="subrow"><td colspan="6" class="r">유지보수 소계</td><td class="r">${won(maintSub)}</td></tr></table>` : ''}`;
    totalsHtml = `<table class="tot">
      <tr><td class="r">구축금액 (①+②)</td><td class="r b" style="width:150px">${won(buildAmt)}</td></tr>
      ${disc > 0 ? `<tr><td class="r">특별 DC</td><td class="r">-${won(disc)}</td></tr>` : ''}
      <tr><td class="r b">${maintItems.length ? '견적 합계 (구축 + 유지보수)' : '최종견적금액'}</td><td class="r b">${won(finalAmt)}</td></tr>
      ${!vatIncluded ? `<tr><td class="r">부가세 (VAT 10%)</td><td class="r">${won(vat)}</td></tr>` : ''}
      <tr><td class="r grand">총 견적가${vatIncluded ? ' (부가세 포함)' : ''}</td><td class="r grand">${won(grand)} 원</td></tr></table>`;
  }
  const bandFallbackTop = '<div style="background:#A6CE39"></div><div style="background:#F5C400"></div><div style="background:#EC008C"></div><div style="background:#404040;flex:5"></div>';
  const bandFallbackBot = '<div style="background:#404040;flex:5"></div><div style="background:#EC008C"></div><div style="background:#F5C400"></div><div style="background:#A6CE39"></div>';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 11mm 9mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
body { font-family: 'Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif; color:#222; font-size:10px; margin:0; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.cover { height: 268mm; display:flex; flex-direction:column; }
.band { height: 9mm; display:flex; overflow:hidden; }
.band > div { flex:1; } .band img { width:100%; height:100%; object-fit:fill; }
.cover-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16mm; }
.cover h1 { font-size:28px; margin:0; text-align:center; }
.cover .sub { font-size:24px; letter-spacing:8px; font-weight:700; }
.cover img.logo { height:66px; }
.cust-box { border:1px solid #ccc; border-radius:4px; padding:10px 18px; font-size:12px; color:#555; line-height:1.9; min-width:230px; }
.addr { text-align:right; font-size:8px; color:#888; }
h2.qt { text-align:center; font-size:30px; letter-spacing:8px; color:#0747A6; margin:2px 0 8px; text-decoration:underline; }
table { width:100%; border-collapse:collapse; }
.hdrbox td { border:1px solid #999; padding:4px 7px; font-size:10px; }
.hdrbox .lbl { background:#eee; font-weight:700; text-align:center; white-space:nowrap; width:64px; }
.note { margin:6px 0; font-size:9px; } .note .u { float:right; color:#888; }
.sec { font-weight:700; color:#0747A6; margin:11px 0 3px; font-size:11px; }
table.grid td, table.grid th { border:1px solid #aaa; padding:3px 6px; }
table.grid th { background:#ddd; font-weight:700; text-align:center; }
.c{text-align:center}.r{text-align:right}.b{font-weight:700}.muted{color:#999}
.gubun{background:#f2f2f2;font-weight:700;text-align:center;vertical-align:middle}
.subrow td{background:#f2f2f2;font-weight:700}
.tot{margin-top:8px}.tot td{border:1px solid #aaa;padding:4px 8px}
.tot .grand{background:#0747A6;color:#fff;font-weight:700;font-size:13px}
.conds{border:1px solid #999;border-radius:3px;padding:8px 11px;margin-top:6px;font-size:9.5px;line-height:1.7}
.seal{position:relative}.seal img{position:absolute;right:8px;top:-4px;width:40px;height:40px;opacity:.9}
</style></head><body>

<div class="page cover">
  <div class="band">${bandTop ? `<img src="${bandTop}">` : bandFallbackTop}</div>
  <div class="cover-body">
    <h1>${esc(purpose || ((quote.customer_name ? quote.customer_name + ' ' : '') + '시스템 구축'))}</h1>
    <div class="sub">가 격 제 안 서</div>
    ${logo ? `<img class="logo" src="${logo}">` : `<div style="font-size:16px;font-weight:700;color:#7AA324">${esc(supplier)}</div>`}
    <div class="cust-box">
      <div>고객사 : ${esc(quote.customer_name || '')}</div>
      <div>담당자 : ${esc(quote.customer_contact || '')}</div>
      <div>연락처 : ${esc(tag('연락처'))}</div>
      <div>이메일 : ${esc(tag('이메일'))}</div>
    </div>
  </div>
  <div class="band">${bandBot ? `<img src="${bandBot}">` : bandFallbackBot}</div>
</div>

<div class="page">
  <div class="addr">${esc(addr)}　☎ 02-6242-3094</div>
  <h2 class="qt">Quotation</h2>
  <table class="hdrbox">
    <tr><td class="lbl">수 신</td><td colspan="2">${esc(quote.customer_name ? quote.customer_name + ' 귀중' : '')}</td><td class="lbl">견적번호</td><td colspan="2">${esc(quote.quote_no || '')}</td></tr>
    <tr><td class="lbl">견적용도</td><td colspan="2">${esc(purpose)}</td><td class="lbl">견적일자</td><td colspan="2">${fmtDate(quote.quote_date)}</td></tr>
    <tr><td class="lbl">결제조건</td><td colspan="2">${esc(payTerms)}</td><td class="lbl">견적유효일</td><td colspan="2">${quote.valid_until ? fmtDate(quote.valid_until) : '견적일로부터 30일'}</td></tr>
    <tr><td class="lbl">총견적가</td><td colspan="2" class="r b">${won(grand)} 원</td><td class="lbl">상 호</td><td colspan="2" class="c b">${esc(supplier)}</td></tr>
    <tr><td class="lbl">설치완료</td><td colspan="2">협의된 프로젝트 기간</td><td class="lbl">대표이사</td><td colspan="2" class="c seal">${esc(ceo)} (인)${seal ? `<img src="${seal}">` : ''}</td></tr>
  </table>
  <div class="note">하기와 같이 견적하오니 참조 바랍니다.<span class="u">(단위: 원, 부가세 ${vatIncluded ? '포함' : '별도'})</span></div>

  ${bodyTablesHtml}

  ${totalsHtml}

  <div class="sec">▣ 견적조건</div>
  <div class="conds">${conds.map((c) => `<div>-. ${esc(c)}</div>`).join('')}</div>
</div>

</body></html>`;
}

module.exports = { renderQuoteHtml };
