/**
 * evalreport-render.js - 評估報告「產生最終 HTML」的部分
 * ------------------------------------------------------------
 * 只負責：report 物件 → 一份獨立的 HTML 字串（圖片都是內嵌 base64，單一檔案就能打開/列印）。
 * 編輯畫面的邏輯在 evalreport.js。版面參考舊系統 FAE 評估報告（Logo 抬頭、浮水印、
 * 基本資訊、原始需求、FAE 方案、圖文區、機密聲明頁尾），再加上封面、圖號、結論框、簽核欄。
 *
 * report 結構：
 *   { caseId, theme: {...}, meta: {...}, blocks: [ { id, type, ... } ] }
 * block.type：cover / heading / table / text / images / imageText / callout / signature / pagebreak
 * ------------------------------------------------------------
 */

const REPORT_THEMES = {
  cetus: { name: '鑫堡紅', primary: '#E60012', dark: '#1f2937' },
  blue: { name: '科技藍', primary: '#0d6efd', dark: '#0d3b66' },
  gray: { name: '沉穩灰', primary: '#475569', dark: '#1e293b' },
  green: { name: '品質綠', primary: '#15803d', dark: '#14532d' },
};

const REPORT_FONTS = {
  jhenghei: { name: '微軟正黑體', css: '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif', google: '' },
  noto: { name: '思源黑體 (Noto Sans TC)', css: '"Noto Sans TC", "Microsoft JhengHei", sans-serif', google: 'Noto+Sans+TC:wght@400;500;700;900' },
  serif: { name: '思源宋體 (Noto Serif TC)', css: '"Noto Serif TC", "PMingLiU", serif', google: 'Noto+Serif+TC:wght@400;600;700;900' },
  kai: { name: '標楷體', css: '"DFKai-SB", "BiauKai", "KaiTi", serif', google: '' },
};

const CALLOUT_VARIANTS = {
  conclusion: { name: '結論（主色）', color: null, icon: '✔' },
  suggest: { name: '建議（綠）', color: '#15803d', icon: '💡' },
  notice: { name: '注意（橘）', color: '#d97706', icon: '⚠' },
  risk: { name: '風險（紅）', color: '#dc2626', icon: '✖' },
  info: { name: '說明（藍）', color: '#2563eb', icon: 'ℹ' },
};

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 純文字 → HTML（保留換行）。 */
function textToHtml(str) {
  return escHtml(str).replace(/\n/g, '<br>');
}

/** #rrggbb → rgba(r,g,b,a)，用來做主色的淡色底。 */
function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 只允許安全的顏色字串進 CSS。 */
function safeColor(c, fallback) {
  return /^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim() : fallback;
}

function safeNum(n, min, max, fallback) {
  const v = parseFloat(n);
  return isNaN(v) ? fallback : Math.min(max, Math.max(min, v));
}

/** 圖片來源只接受 data:image/…（報告要能單檔離線打開，也避免塞進奇怪的網址）。 */
function safeImgSrc(src) {
  return /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(String(src || '')) ? src : '';
}

/**
 * 富文字清理：編輯器裡的內容是使用者自己打的，但也可能是從網頁/Word 貼上來的，
 * 輸出前把 script、事件屬性、javascript: 連結、外部資源之類的東西拿掉。
 */
function sanitizeRichHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'H3', 'H4', 'BLOCKQUOTE', 'A', 'MARK', 'SMALL', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'HR']);
  const allowedStyle = /^(color|background-color|font-size|font-weight|font-style|text-decoration|text-align|line-height|margin-left|padding-left)$/i;

  const walk = (node) => {
    [...node.children].forEach((el) => {
      if (!allowedTags.has(el.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
          el.remove();
          return;
        }
        // 其他不認識的標籤：留下內容、拿掉標籤本身
        walk(el);
        el.replaceWith(...el.childNodes);
        return;
      }
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name === 'style') {
          const kept = attr.value
            .split(';')
            .map((d) => d.trim())
            .filter((d) => {
              const [prop, ...rest] = d.split(':');
              const value = rest.join(':');
              return prop && allowedStyle.test(prop.trim()) && !/url\s*\(|expression|javascript/i.test(value);
            });
          if (kept.length) el.setAttribute('style', kept.join('; '));
          else el.removeAttribute('style');
        } else if (name === 'href') {
          if (!/^(https?:|mailto:)/i.test(attr.value.trim())) el.removeAttribute('href');
          else {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
        } else if (!['color', 'size', 'align', 'colspan', 'rowspan', 'target', 'rel'].includes(name)) {
          el.removeAttribute(attr.name);
        }
      });
      walk(el);
    });
  };
  walk(root);
  return root.innerHTML;
}

/** 表格列：一般欄位兩兩一列（4 欄），wide 的欄位自己佔一整列。 */
function renderKvTable(rows, labelBg) {
  const html = [];
  let pending = null;
  const cell = (r) => `<td class="rp-label" style="background:${labelBg}">${escHtml(r.k)}</td><td class="rp-value">${r.v !== '' && r.v != null ? textToHtml(r.v) : '<span class="rp-empty">-</span>'}</td>`;
  (rows || []).forEach((r) => {
    if (!r || (!r.k && !r.v)) return;
    if (r.wide) {
      if (pending) {
        html.push(`<tr>${cell(pending)}<td class="rp-label" style="background:${labelBg}"></td><td class="rp-value"></td></tr>`);
        pending = null;
      }
      html.push(`<tr><td class="rp-label" style="background:${labelBg}">${escHtml(r.k)}</td><td class="rp-value" colspan="3">${r.v ? textToHtml(r.v) : '<span class="rp-empty">-</span>'}</td></tr>`);
    } else if (pending) {
      html.push(`<tr>${cell(pending)}${cell(r)}</tr>`);
      pending = null;
    } else {
      pending = r;
    }
  });
  if (pending) html.push(`<tr>${cell(pending)}<td class="rp-label" style="background:${labelBg}"></td><td class="rp-value"></td></tr>`);
  return `<table class="rp-table"><colgroup><col style="width:17%"><col style="width:33%"><col style="width:17%"><col style="width:33%"></colgroup>${html.join('')}</table>`;
}

/**
 * 產生完整報告 HTML。
 * options.logoSrc：Logo（data URL），options.forEditor：true 時每個區塊加上 data-block-id 方便預覽點擊定位。
 */
function buildReportHtml(report, options) {
  const opt = options || {};
  const t = report.theme || {};
  const meta = report.meta || {};
  const primary = safeColor(t.primary, REPORT_THEMES.cetus.primary);
  const dark = safeColor(t.dark, REPORT_THEMES.cetus.dark);
  const textColor = safeColor(t.textColor, '#2b2b2b');
  const font = REPORT_FONTS[t.font] || REPORT_FONTS.jhenghei;
  const baseSize = safeNum(t.baseSize, 11, 20, 14);
  const tint = hexToRgba(primary, 0.07);
  const tint2 = hexToRgba(primary, 0.14);
  const logo = safeImgSrc(opt.logoSrc);
  const companyName = t.companyName || '';
  const docTitle = `${t.title || '評估報告'}_${report.caseId || ''}`;

  let sectionNo = 0;
  let figureNo = 0;
  const attr = (b) => (opt.forEditor ? ` data-block-id="${escHtml(b.id)}"` : '');

  const figure = (img, widthPct) => {
    const src = safeImgSrc(img.src);
    if (!src) return '';
    figureNo++;
    const cap = img.caption ? `：${escHtml(img.caption)}` : '';
    return `<figure class="rp-figure"><img src="${src}" style="width:${widthPct}%" alt="${escHtml(img.caption || '')}"><figcaption>圖 ${figureNo}${cap}</figcaption></figure>`;
  };

  const blockParts = (report.blocks || [])
    .map((b) => {
      switch (b.type) {
        case 'cover': {
          const coverImg = safeImgSrc(b.image);
          const rows = [
            ['客戶名稱', b.customer],
            ['案件編號', report.caseId],
            ['報告編號', meta.reportNo],
            ['報告日期', meta.date],
            ['撰寫人', meta.author],
            ['版次', meta.version],
          ].filter((r) => r[1]);
          return `<section class="rp-cover"${attr(b)}>
  <div class="rp-cover-top">${logo ? `<img class="rp-cover-logo" src="${logo}" alt="logo">` : ''}<div class="rp-cover-company">${escHtml(companyName)}<small>${escHtml(t.companySub || '')}</small></div></div>
  <div class="rp-cover-band"></div>
  <div class="rp-cover-main">
    <div class="rp-cover-kicker">${escHtml(b.kicker || 'AOI VISION INSPECTION REPORT')}</div>
    <h1 class="rp-cover-title">${escHtml(b.title || t.title || '評估報告')}</h1>
    ${b.subtitle ? `<div class="rp-cover-sub">${textToHtml(b.subtitle)}</div>` : ''}
    ${coverImg ? `<div class="rp-cover-image"><img src="${coverImg}" alt=""></div>` : ''}
  </div>
  <table class="rp-cover-info">${rows.map((r) => `<tr><th>${escHtml(r[0])}</th><td>${escHtml(r[1])}</td></tr>`).join('')}</table>
  <div class="rp-cover-foot">${escHtml(t.coverNote || '本報告內容僅供評估參考，實際效果以現場驗證為準')}</div>
</section>`;
        }
        case 'heading': {
          sectionNo++;
          const no = t.numbering !== false ? `<span class="rp-h-no">${String(sectionNo).padStart(2, '0')}</span>` : '';
          const color = safeColor(b.color, dark);
          return `<h2 class="rp-h2"${attr(b)} style="color:${color}">${no}${escHtml(b.text || '')}</h2>`;
        }
        case 'table': {
          const badge = b.badge ? `<span class="rp-badge">${escHtml(b.badge)}</span>` : '';
          return `<div class="rp-card rp-avoid"${attr(b)}>${b.title || badge ? `<h3 class="rp-h3">${badge}${escHtml(b.title || '')}</h3>` : ''}${renderKvTable(b.rows, tint)}</div>`;
        }
        case 'text': {
          const size = b.fontSize ? `font-size:${safeNum(b.fontSize, 9, 48, baseSize)}px;` : '';
          const color = b.color ? `color:${safeColor(b.color, textColor)};` : '';
          const align = ['left', 'center', 'right', 'justify'].includes(b.align) ? `text-align:${b.align};` : '';
          return `<div class="rp-text"${attr(b)} style="${size}${color}${align}">${sanitizeRichHtml(b.html)}</div>`;
        }
        case 'images': {
          const items = (b.items || []).filter((it) => safeImgSrc(it.src));
          if (!items.length) return opt.forEditor ? `<div class="rp-placeholder"${attr(b)}>（圖片區：尚未加入圖片）</div>` : '';
          const cols = Math.min(3, Math.max(1, parseInt(b.columns, 10) || 1));
          const width = cols === 1 ? safeNum(b.width, 20, 100, 80) : 100;
          const align = ['left', 'center', 'right'].includes(b.align) ? b.align : 'center';
          const title = b.title ? `<h3 class="rp-h3">${escHtml(b.title)}</h3>` : '';
          return `<div class="rp-images rp-cols-${cols}"${attr(b)} style="text-align:${align}">${title}<div class="rp-grid" style="grid-template-columns:repeat(${cols},1fr)">${items.map((it) => figure(it, width)).join('')}</div></div>`;
        }
        case 'imageText': {
          const imgHtml = safeImgSrc(b.src) ? figure({ src: b.src, caption: b.caption }, 100) : opt.forEditor ? '<div class="rp-placeholder">（尚未加入圖片）</div>' : '';
          const w = safeNum(b.imageWidth, 25, 70, 45);
          const side = b.side === 'right' ? 'right' : 'left';
          const text = `<div class="rp-it-text">${b.title ? `<h3 class="rp-h3">${escHtml(b.title)}</h3>` : ''}<div class="rp-text">${sanitizeRichHtml(b.html)}</div></div>`;
          const img = `<div class="rp-it-img" style="flex:0 0 ${w}%">${imgHtml}</div>`;
          return `<div class="rp-imagetext rp-avoid"${attr(b)}>${side === 'left' ? img + text : text + img}</div>`;
        }
        case 'callout': {
          const v = CALLOUT_VARIANTS[b.variant] || CALLOUT_VARIANTS.conclusion;
          const c = v.color || primary;
          return `<div class="rp-callout rp-avoid"${attr(b)} style="border-color:${c};background:${hexToRgba(c, 0.07)}">
  ${b.title ? `<div class="rp-callout-title" style="color:${c}">${v.icon} ${escHtml(b.title)}</div>` : ''}
  <div class="rp-text">${sanitizeRichHtml(b.html)}</div>
</div>`;
        }
        case 'signature': {
          const slots = (b.slots || []).filter((s) => s && s.label);
          return `<div class="rp-sign rp-avoid"${attr(b)}>${slots
            .map((s) => `<div class="rp-sign-box"><div class="rp-sign-label">${escHtml(s.label)}</div><div class="rp-sign-line">${escHtml(s.name || '')}</div><div class="rp-sign-date">日期：${escHtml(s.date || '＿＿＿＿＿＿')}</div></div>`)
            .join('')}</div>`;
        }
        case 'pagebreak':
          return opt.forEditor ? `<div class="rp-pagebreak-mark"${attr(b)}>── 分頁 ──</div><div class="rp-pagebreak"></div>` : '<div class="rp-pagebreak"></div>';
        default:
          return '';
      }
    });
  const header = `<header class="rp-header">
  <div class="rp-header-logo">${logo ? `<img src="${logo}" alt="logo">` : ''}</div>
  <div class="rp-header-info"><div class="rp-company">${escHtml(companyName)}</div><div class="rp-company-sub">${escHtml(t.companySub || '')}</div></div>
</header>
<h1 class="rp-title">${escHtml(t.title || '評估報告')}</h1>
<div class="rp-meta">${[
    meta.reportNo && `報告編號：${escHtml(meta.reportNo)}`,
    report.caseId && `案件編號：${escHtml(report.caseId)}`,
    meta.date && `報告日期：${escHtml(meta.date)}`,
    meta.version && `版次：${escHtml(meta.version)}`,
  ]
    .filter(Boolean)
    .join('<span class="rp-dot">｜</span>')}</div>`;

  const footer = `<footer class="rp-footer">
  ${(t.footerText || '').split('\n').filter(Boolean).map((l) => `<div>${escHtml(l)}</div>`).join('')}
  ${t.footerBless ? `<div class="rp-bless">${escHtml(t.footerBless)}</div>` : ''}
</footer>`;

  // 有封面時，抬頭放在封面後面（第二頁開始）；沒有封面就放最上面
  const coverIdx = (report.blocks || []).findIndex((b) => b.type === 'cover');
  const bodyHtml =
    coverIdx === 0
      ? [blockParts[0], header, ...blockParts.slice(1)].join('\n')
      : [header, ...blockParts].join('\n');

  const watermark = t.watermark !== false && t.watermarkText ? `<div class="rp-watermark">${escHtml(t.watermarkText)}</div>` : '';
  const googleFont = font.google ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${font.google}&display=swap">` : '';

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(docTitle)}</title>
${googleFont}
<style>
*{box-sizing:border-box}
:root{--p:${primary};--d:${dark};--tint:${tint};--tint2:${tint2};--txt:${textColor};--fs:${baseSize}px}
html{background:#e9edf2}
body{margin:0;padding:28px 0;font-family:${font.css};color:var(--txt);font-size:var(--fs);line-height:1.8;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rp-sheet{position:relative;width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:16mm 15mm 18mm;box-shadow:0 6px 30px rgba(15,23,42,.15);overflow:hidden}
.rp-watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:72px;font-weight:900;letter-spacing:8px;color:rgba(0,0,0,.045);white-space:nowrap;pointer-events:none;z-index:5}
.rp-sheet>*{position:relative;z-index:1}
/* 抬頭 */
.rp-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:3px solid var(--p);margin-bottom:22px}
.rp-header-logo img{height:52px;object-fit:contain}
.rp-header-info{text-align:right}
.rp-company{font-size:22px;font-weight:800;color:var(--d)}
.rp-company-sub{font-size:12px;color:#64748b;letter-spacing:1px}
.rp-title{font-size:28px;font-weight:800;color:var(--d);margin:0 0 6px;padding-left:14px;border-left:7px solid var(--p)}
.rp-meta{font-size:12.5px;color:#64748b;margin-bottom:26px}
.rp-dot{color:#cbd5e1;margin:0 4px}
/* 封面 */
.rp-cover{min-height:260mm;display:flex;flex-direction:column;break-after:page;page-break-after:always}
.rp-cover-top{display:flex;justify-content:space-between;align-items:center}
.rp-cover-logo{height:64px;object-fit:contain}
.rp-cover-company{text-align:right;font-size:20px;font-weight:800;color:var(--d)}
.rp-cover-company small{display:block;font-size:12px;font-weight:400;color:#64748b;letter-spacing:1px}
.rp-cover-band{height:8px;margin:18px 0 0;background:linear-gradient(90deg,var(--p) 0 60%,var(--d) 60% 100%)}
.rp-cover-main{flex:1;display:flex;flex-direction:column;justify-content:center;padding:36px 0}
.rp-cover-kicker{color:var(--p);font-weight:700;letter-spacing:3px;font-size:13px}
.rp-cover-title{font-size:40px;line-height:1.3;margin:10px 0 12px;color:var(--d);font-weight:900}
.rp-cover-sub{font-size:17px;color:#475569}
.rp-cover-image{margin-top:26px;text-align:center}
.rp-cover-image img{max-width:100%;max-height:95mm;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.12)}
.rp-cover-info{width:100%;border-collapse:collapse;margin-top:10px}
.rp-cover-info th{width:26%;text-align:left;padding:9px 12px;background:var(--tint);color:var(--d);border-bottom:1px solid #e5e7eb;font-weight:700}
.rp-cover-info td{padding:9px 12px;border-bottom:1px solid #e5e7eb}
.rp-cover-foot{margin-top:18px;font-size:12px;color:#94a3b8;text-align:center}
/* 標題 */
.rp-h2{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:800;margin:30px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--tint2);break-after:avoid;page-break-after:avoid}
.rp-h-no{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:26px;padding:0 6px;border-radius:6px;background:var(--p);color:#fff;font-size:13px;font-weight:800}
.rp-h3{display:flex;align-items:center;gap:8px;font-size:15.5px;color:var(--d);margin:0 0 10px;break-after:avoid}
.rp-badge{display:inline-block;padding:1px 10px;border-radius:12px;background:var(--p);color:#fff;font-size:12px;font-weight:700}
/* 卡片與表格 */
.rp-card{margin:0 0 16px}
.rp-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.93em}
.rp-table td{border:1px solid #e2e8f0;padding:8px 10px;vertical-align:top;word-break:break-word}
.rp-table tr{break-inside:avoid;page-break-inside:avoid}
.rp-label{font-weight:700;color:var(--d)}
.rp-empty{color:#cbd5e1}
/* 內文 */
.rp-text{margin:0 0 14px}
.rp-text p{margin:0 0 8px}
.rp-text ul,.rp-text ol{margin:4px 0 8px;padding-left:1.6em}
/* 圖片 */
.rp-images{margin:6px 0 18px}
.rp-grid{display:grid;gap:12px}
.rp-cols-1 .rp-grid{display:block}
.rp-figure{margin:0 0 6px;break-inside:avoid;page-break-inside:avoid}
.rp-figure img{max-width:100%;height:auto;border-radius:8px;border:1px solid #e2e8f0}
.rp-cols-2 .rp-figure img,.rp-cols-3 .rp-figure img{width:100%!important;aspect-ratio:4/3;object-fit:contain;background:#f8fafc}
.rp-figure figcaption{font-size:12.5px;color:#64748b;margin-top:4px;text-align:center}
.rp-imagetext{display:flex;gap:18px;align-items:flex-start;margin:6px 0 18px}
.rp-it-text{flex:1;min-width:0}
/* 結論框 */
.rp-callout{border-left:6px solid;border-radius:8px;padding:14px 18px;margin:8px 0 18px}
.rp-callout-title{font-weight:800;font-size:16px;margin-bottom:6px}
.rp-callout .rp-text{margin:0}
/* 簽核 */
.rp-sign{display:flex;gap:16px;margin:30px 0 10px}
.rp-sign-box{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px}
.rp-sign-label{font-weight:700;color:var(--d);font-size:13px}
.rp-sign-line{height:52px;border-bottom:1px solid #94a3b8;display:flex;align-items:flex-end;justify-content:center;font-size:15px}
.rp-sign-date{font-size:12px;color:#64748b;margin-top:6px}
/* 頁尾 */
.rp-footer{margin-top:40px;padding-top:14px;border-top:2px solid var(--tint2);text-align:center;font-size:12px;color:#64748b;line-height:1.9}
.rp-bless{margin-top:6px;color:var(--p);font-weight:700;font-size:13px}
.rp-avoid{break-inside:avoid;page-break-inside:avoid}
.rp-pagebreak{break-after:page;page-break-after:always;height:0}
.rp-pagebreak-mark{text-align:center;color:#94a3b8;font-size:12px;letter-spacing:2px;margin:18px 0;border-top:1px dashed #cbd5e1;padding-top:4px}
.rp-placeholder{border:2px dashed #cbd5e1;border-radius:8px;padding:22px;text-align:center;color:#94a3b8;margin:6px 0 16px}
${opt.forEditor ? `/* 預覽版面對齊列印：內容區寬 186mm、每頁可用高度 271mm */
.rp-sheet{padding:12mm 12mm 14mm}
.rp-cover{min-height:265mm}
.rp-sheet>.rp-sim-line{position:absolute;left:0;right:0;height:0;border-top:2px dashed #ef4444;z-index:6;pointer-events:none}
.rp-sim-line span{position:absolute;right:10px;font-size:11px;font-weight:700;color:#fff;background:#ef4444;padding:0 8px;border-radius:9px;line-height:17px;white-space:nowrap}
.rp-sim-line .up{bottom:4px}
.rp-sim-line .down{top:4px;background:#f87171}
[data-block-id]{cursor:pointer;transition:outline-color .15s;outline:2px solid transparent;outline-offset:4px;border-radius:4px}
[data-block-id]:hover{outline-color:${hexToRgba(primary, 0.35)}}
[data-block-id].rp-focus{outline-color:var(--p)}` : ''}
@page{size:A4;margin:12mm 12mm 14mm}
@media print{
  html,body{background:#fff}
  body{padding:0}
  .rp-sheet{width:auto;min-height:0;padding:0;box-shadow:none;overflow:visible}
  .rp-cover{min-height:265mm}
  .rp-pagebreak-mark{display:none}
}
</style>
</head>
<body>
${watermark}
<div class="rp-sheet">
${bodyHtml}
${footer}
</div>
</body>
</html>`;
}
