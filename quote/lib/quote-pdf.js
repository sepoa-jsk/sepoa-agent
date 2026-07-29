'use strict';
// HTML → PDF 변환. 별도 npm 패키지 없이 시스템에 설치된 Chrome 을 headless 로 실행.
// (Chromium 다운로드 불필요. 경로는 CHROME_PATH 로 덮어쓸 수 있다.)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 흔한 설치 경로 후보 (Windows Chrome → Edge 순). CHROME_PATH 가 있으면 그것 우선.
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findBrowser() {
  for (const p of CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

function htmlToPdf(html) {
  return new Promise((resolve, reject) => {
    const bin = findBrowser();
    if (!bin) return reject(new Error('Chrome/Edge 를 찾을 수 없습니다. CHROME_PATH 환경변수로 경로를 지정하세요.'));

    const stamp = `${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const dir = path.join(os.tmpdir(), 'quote-pdf');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    const htmlPath = path.join(dir, stamp + '.html');
    const pdfPath = path.join(dir, stamp + '.pdf');
    const cleanup = () => { for (const f of [htmlPath, pdfPath]) { try { fs.unlinkSync(f); } catch { /* ignore */ } } };

    try { fs.writeFileSync(htmlPath, html, 'utf8'); }
    catch (e) { return reject(e); }

    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      '--no-pdf-header-footer',
      '--print-to-pdf=' + pdfPath,
      fileUrl,
    ];
    const child = spawn(bin, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { cleanup(); reject(new Error('브라우저 실행 실패: ' + e.message)); });
    child.on('close', () => {
      try {
        if (!fs.existsSync(pdfPath)) { cleanup(); return reject(new Error('PDF 생성 실패' + (err ? ': ' + err.slice(0, 300) : ''))); }
        const buf = fs.readFileSync(pdfPath);
        cleanup();
        if (!buf.length) return reject(new Error('PDF 가 비어 있습니다.'));
        resolve(buf);
      } catch (e) { cleanup(); reject(e); }
    });
  });
}

module.exports = { htmlToPdf };
