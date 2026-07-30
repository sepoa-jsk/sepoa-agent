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

// ── 부속 페이지 ──────────────────────────────────────────────
// 1) 인력투입계획표 — month_alloc 이 있는 인건비 라인이 있을 때만(has_labor_plan 옵션)
// 2) 임금단가표    — 견적의 인건비 기준단가가 나온 근거표(한국SW산업협회)
// 3) 건수 밴드표   — SaaS 월 건수별 제안금액(실측 하단 우측 표)
function buildAppendix(quote, masters) {
  const parts = [];

  const laborRows = (quote.blocks || []).flatMap((b) => b.labor || []);
  const planRows = laborRows.filter((l) => l.month_alloc && Object.keys(l.month_alloc).length);
  if (planRows.length) {
    // 등장하는 월 키를 M, M1, M2 … 순서로 정렬
    const keys = [...new Set(planRows.flatMap((l) => Object.keys(l.month_alloc)))]
      .sort((a, b) => (a === 'M' ? -1 : b === 'M' ? 1 : Number(a.slice(1)) - Number(b.slice(1))));
    const colTotal = Object.fromEntries(keys.map((k) => [k, 0]));
    let grandMM = 0;
    const body = planRows.map((l) => {
      const mm = Number(l.mm) || 0; grandMM += mm;
      const cells = keys.map((k) => {
        const v = Number(l.month_alloc[k]) || 0;
        colTotal[k] += v;
        return `<td class="c">${v ? v.toFixed(2) : ''}</td>`;
      }).join('');
      return `<tr><td>${esc(l.role_label || l.role_name || l.role_code)}</td><td>${esc(l.task || '')}</td>${cells}<td class="c b">${mm.toFixed(2)}</td></tr>`;
    }).join('');
    parts.push(`<div class="page-break"></div>
      <div class="sec">#. 인력투입계획</div>
      <table class="grid">
        <tr><th>역할</th><th>상세업무내역</th>${keys.map((k) => `<th>${esc(k)}</th>`).join('')}<th>합계(MM)</th></tr>
        ${body}
        <tr class="subrow"><td colspan="2" class="r">합계(M/M)</td>${keys.map((k) => `<td class="c">${colTotal[k].toFixed(2)}</td>`).join('')}<td class="c b">${grandMM.toFixed(2)}</td></tr>
      </table>`);
  }

  const rates = masters.laborRates || [];
  if (rates.length && laborRows.length) {
    const body = rates.map((r) => `<tr>
      <td>${esc(r.role_name)}</td><td class="c">${esc(r.grade || '')}</td>
      <td class="r">${won(r.wage_md)}</td><td class="r">${won(r.wage_mm)}</td>
      <td class="r">${won(r.overhead)}</td><td class="r">${won(r.tech_fee)}</td>
      <td class="r b">${won(r.apply_price)}</td><td>${esc(r.note || '')}</td></tr>`).join('');
    parts.push(`<div class="page-break"></div>
      <div class="sec">#. 한국SW산업협회 기준 SW기술자 평균임금 (${esc(masters.laborRateYear || '')}년)</div>
      <div class="muted" style="margin-bottom:4px">SW기술자비용 = 직접인건비(노임단가×근무일수 20.5) + 제경비(직접인건비×110%) + 기술료((직접인건비+제경비)×20%)</div>
      <table class="grid">
        <tr><th>구분</th><th>등급</th><th>노임단가(M/D)</th><th>평균임금(M/M)</th><th>제경비</th><th>기술료</th><th>적용단가</th><th>비고</th></tr>
        ${body}
      </table>
      ${masters.laborRateSource ? `<div class="muted" style="margin-top:4px">출처: ${esc(masters.laborRateSource)}</div>` : ''}`);
  }

  const bands = masters.bands || {};
  const bandCodes = Object.keys(bands);
  if (bandCodes.length) {
    parts.push(bandCodes.map((code) => `
      <div class="sec" style="margin-top:10px">▣ 건수별 제안금액</div>
      <table class="grid" style="width:60%">
        <tr><th>월 건수</th><th>년 건수</th><th>제안 금액</th></tr>
        ${bands[code].map((v) => `<tr><td class="c">${Number(v.min_qty)}</td><td class="c">${Number(v.max_qty)}</td><td class="r">${won(v.price)}</td></tr>`).join('')}
      </table>`).join(''));
  }

  return parts.join('\n');
}

// opts.withCover=false 로 표지를 생략한다(REV §6: 커버는 별도 구성 — 외부 PDF 를 앞에 병합).
function renderQuoteHtml(quote, settings = {}, masters = {}, opts = {}) {
  const withCover = opts.withCover !== false;
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

  // 견적조건: 저장값 → 템플릿의 condition_set(마스터) → 일반 문구 순으로 사용
  const conds = (Array.isArray(quote.conditions) && quote.conditions.length)
    ? quote.conditions.map((c) => (typeof c === 'string' ? c : c.text)).filter(Boolean)
    : (masters.conditionLines && masters.conditionLines.length) ? masters.conditionLines
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

  // ── 블록형 견적(5-C) 렌더 ──
  // quote.blocks 를 순서대로 출력. 실측 양식대로 '구분'(category) 이 같은 연속 행을 rowspan 으로 묶는다.
  const isBlock = Array.isArray(quote.blocks) && quote.blocks.length > 0;
  const blockDefs = masters.blockDefs || {};
  let bodyTablesHtml, totalsHtml, appendixHtml = '';

  if (isBlock) {
    const onetimeSub = quote.blocks.filter((b) => !b.recurring).reduce((a, b) => a + Number(b.subtotal || 0), 0);
    const monthlySub = quote.blocks.filter((b) => b.recurring).reduce((a, b) => a + Number(b.subtotal || 0), 0);
    const onetimeTotal = Number(quote.onetime_total) || 0;
    const monthlyTotal = Number(quote.monthly_total) || 0;
    const onetimeDc = onetimeSub - onetimeTotal;
    const monthlyDc = monthlySub - monthlyTotal;

    // 연속된 같은 category 를 묶어 rowspan 계산
    const groupSpans = (rows) => {
      const spans = new Array(rows.length).fill(0);
      let i = 0;
      while (i < rows.length) {
        let j = i;
        while (j + 1 < rows.length && (rows[j + 1].gubun || '') === (rows[i].gubun || '')) j++;
        spans[i] = j - i + 1;
        i = j + 1;
      }
      return spans;
    };

    const blockTable = (b) => {
      const def = blockDefs[b.block_code] || {};
      const isLabor = b.block_code === 'LABOR';
      const title = b.title || def.name || b.block_code;
      // 블록 정의의 컬럼 수를 따른다(REV §2). 7열=구분·모듈·세부기능·… / 6열=구분·세부기능·…
      // 6열 블록(SETUP/LICENSE/SERVICE)은 모듈명과 세부기능을 한 칸에 합쳐 출력한다.
      const wide = (def.columns || []).length >= 7 || isLabor;
      // 모듈 행 + 인건비 행(SETUP 은 둘 다 올 수 있다)
      const rowsData = [
        ...(b.items || []).map((it) => ({
          gubun: it.category || title, name: it.name, spec: it.spec || '',
          qty: Number(it.qty) || 0, unit: it.unit || '',
          base: it.base_price, proposed: it.proposed_price != null ? it.proposed_price : it.unit_price,
          amount: Number(it.amount) || 0,
        })),
        ...(b.labor || []).map((l) => ({
          gubun: l.category || '개발인건비',
          name: (l.role_label || l.role_name || l.role_code) + (l.grade ? ` (${l.grade})` : ''),
          spec: l.task || '', qty: Number(l.mm) || 0, unit: 'MM',
          base: l.base_price, proposed: l.proposed_price, amount: Number(l.amount) || 0, isLabor: true,
        })),
      ];
      const spans = groupSpans(rowsData);
      const nCols = wide ? 7 : 6;
      const body = rowsData.length ? rowsData.map((r, i) =>
        '<tr>'
        + (spans[i] ? `<td class="gubun" rowspan="${spans[i]}">${esc(r.gubun)}</td>` : '')
        + (wide
            ? `<td>${esc(r.name)}</td><td>${esc(r.spec)}</td>`
            // 6열: 모듈명(굵게) + 세부기능(작게)을 한 칸에
            : `<td>${esc(r.name)}${r.spec ? `<div class="muted" style="margin-top:1px">${esc(r.spec)}</div>` : ''}</td>`)
        + `<td class="c">${r.qty}${r.unit === 'MM' ? ' MM' : ''}</td>`
        + `<td class="r">${r.base != null && r.base > 0 ? won(r.base) : ''}</td>`
        + `<td class="r">${won(r.proposed)}</td>`
        // 실측: 수량 0 인 참고라인은 금액을 '-' 로 표기
        + `<td class="r b">${r.qty === 0 ? '-' : won(r.amount)}</td></tr>`).join('')
        : `<tr><td colspan="${nCols}" class="c muted">(항목 없음)</td></tr>`;

      const hasLaborRow = rowsData.some((r) => r.isLabor);
      const col2 = isLabor || hasLaborRow ? '역할(등급)' : (wide ? '모듈' : '세부기능');
      return `<div class="sec">▣ ${esc(title)}${b.recurring ? ' <span style="font-weight:400;color:#888">(월)</span>' : ''}</div>`
        + `<table class="grid"><tr><th>구분</th><th>${col2}</th>${wide ? '<th>세부내역</th>' : ''}`
        + `<th>${isLabor ? '공수(MM)' : '수량'}</th><th>기준단가</th>`
        + `<th>${b.recurring ? '제안단가(월)' : '제안단가'}</th><th>${b.recurring ? '제안금액(월)' : '제안금액'}</th></tr>`
        + `${body}<tr class="subrow"><td colspan="${nCols - 1}" class="r">${esc(title)} 소계${b.recurring ? '(월)' : ''}</td><td class="r">${won(b.subtotal)}</td></tr></table>`;
    };
    bodyTablesHtml = quote.blocks.map(blockTable).join('\n');

    // 합계: 일시불(소계합→특별DC→절사) / 월(소계→특별DC) 분리
    const freeText = (v) => (v === 0 ? '무상제공' : won(v));
    totalsHtml = `<table class="tot">
      <tr><td class="r">일시납 합계</td><td class="r b" style="width:150px">${won(onetimeSub)}</td></tr>
      ${onetimeDc > 0 ? `<tr><td class="r">특별 DC</td><td class="r">-${won(onetimeDc)}</td></tr>` : ''}
      <tr><td class="r b">최종견적금액 (특별DC 적용)</td><td class="r b">${freeText(onetimeTotal)}</td></tr>
      <tr><td class="r">부가세 (별도, 10%)</td><td class="r">${won(vat)}</td></tr>
      ${monthlySub ? `<tr><td class="r" style="padding-top:8px">월 사용료 소계</td><td class="r b" style="padding-top:8px">${won(monthlySub)}</td></tr>
      ${monthlyDc > 0 ? `<tr><td class="r">월 특별 DC</td><td class="r">-${won(monthlyDc)}</td></tr>` : ''}
      <tr><td class="r b">월 사용료 (특별DC 적용)</td><td class="r b">${won(monthlyTotal)}</td></tr>` : ''}
      <tr><td class="r grand">총 견적가${monthlySub ? ' (일시납)' : ''}</td><td class="r grand">${freeText(onetimeTotal)}${onetimeTotal ? ' 원' : ''}</td></tr>
      ${monthlySub ? `<tr><td class="r grand">총 견적가 (월)</td><td class="r grand">${won(monthlyTotal)} 원</td></tr>` : ''}
      </table>
      <div class="muted" style="margin-top:4px">※ 부가세 별도${quote.round_unit > 0 ? ` · ${won(quote.round_unit)}단위 절사 적용` : ''}</div>`;

    appendixHtml = buildAppendix(quote, masters);
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
  // 상단 총견적가 — 실측 SaaS/PCloud 는 셋업비용과 월사용료를 두 줄로 나눠 표기한다
  let sealOnGrandRow = false;
  const grandRowsHtml = (() => {
    const lbl = (t) => `<td class="lbl">${t}</td>`;
    const right = `<td class="lbl">상 호</td><td colspan="2" class="c b">${esc(supplier)}</td>`;
    if (!isBlock) return `<tr>${lbl('총견적가')}<td colspan="2" class="r b">${won(grand)} 원</td>${right}</tr>`;
    const one = Number(quote.onetime_total) || 0;
    const mon = Number(quote.monthly_total) || 0;
    const oneTxt = one === 0 ? '무상제공' : `₩${won(one)}`;
    if (!mon) return `<tr>${lbl('총견적가')}<td colspan="2" class="r b">${oneTxt}</td>${right}</tr>`;
    // 월 금액이 있으면 총견적가를 2행으로 나누고, 대표이사(인감)를 둘째 행에 둔다.
    // → 아래 '설치완료' 행의 우측은 비운다(sealOnGrandRow).
    sealOnGrandRow = true;
    return `<tr>${lbl('총견적가')}<td colspan="2" class="r b">${oneTxt} <span class="u">셋업비용(부가세 별도)</span></td>${right}</tr>`
      + `<tr>${lbl('')}<td colspan="2" class="r b">₩${won(mon)} <span class="u">월사용료(부가세 별도)</span></td>${lbl('대표이사')}`
      + `<td colspan="2" class="c b seal">${esc(ceo)} (인)${seal ? `<img src="${seal}">` : ''}</td></tr>`;
  })();

  const bandFallbackTop = '<div style="background:#A6CE39"></div><div style="background:#F5C400"></div><div style="background:#EC008C"></div><div style="background:#404040;flex:5"></div>';
  const bandFallbackBot = '<div style="background:#404040;flex:5"></div><div style="background:#EC008C"></div><div style="background:#F5C400"></div><div style="background:#A6CE39"></div>';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 11mm 9mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
body { font-family: 'Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif; color:#222; font-size:10px; margin:0; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
/* 부속 페이지(인력투입계획표·임금단가표)는 새 장에서 시작 */
.page-break { page-break-before: always; height: 0; }
table.grid { page-break-inside: auto; }
table.grid tr { page-break-inside: avoid; }
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

${withCover ? `<div class="page cover">
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
</div>` : '<!-- 커버 생략(withCover=false) — 외부에서 제작한 커버 PDF 를 앞에 병합하세요 -->'}

<div class="page">
  <div class="addr">${esc(addr)}　☎ 02-6242-3094</div>
  <h2 class="qt">Quotation</h2>
  <table class="hdrbox">
    <tr><td class="lbl">수 신</td><td colspan="2">${esc(quote.customer_name ? quote.customer_name + ' 귀중' : '')}</td><td class="lbl">견적번호</td><td colspan="2">${esc(quote.quote_no || '')}</td></tr>
    <tr><td class="lbl">견적용도</td><td colspan="2">${esc(purpose)}</td><td class="lbl">견적일자</td><td colspan="2">${fmtDate(quote.quote_date)}</td></tr>
    <tr><td class="lbl">결제조건</td><td colspan="2">${esc(payTerms)}</td><td class="lbl">견적유효일</td><td colspan="2">${quote.valid_until ? fmtDate(quote.valid_until) : '견적일로부터 30일'}</td></tr>
    ${grandRowsHtml}
    <tr><td class="lbl">설치완료</td><td colspan="2">협의된 프로젝트 기간</td>${sealOnGrandRow
      ? '<td class="lbl"></td><td colspan="2"></td>'
      : `<td class="lbl">대표이사</td><td colspan="2" class="c seal">${esc(ceo)} (인)${seal ? `<img src="${seal}">` : ''}</td>`}</tr>
  </table>
  <div class="note">하기와 같이 견적하오니 참조 바랍니다.<span class="u">(단위: 원, 부가세 별도)</span></div>

  ${bodyTablesHtml}

  ${totalsHtml}

  <div class="sec">▣ 견적조건</div>
  <div class="conds">${conds.map((c) => `<div>-. ${esc(c)}</div>`).join('')}</div>

  ${appendixHtml}
</div>

</body></html>`;
}

module.exports = { renderQuoteHtml };
