# 報告 / 行銷文宣產生器：移植指南

本文件說明「AOI 業務系統」裡**評估報告編輯器**的做法，讓你能把同一套機制搬到其他網站，用來產生：

- 客戶評估報告、測試報告、提案書、報價說明
- 行銷宣傳頁、產品 DM、活動廣告單、電子型錄

來源程式：`frontend/evalreport.html`（畫面）、`frontend/evalreport.js`（編輯邏輯，約 1350 行）、`frontend/evalreport-render.js`（輸出 HTML，約 390 行）。

---

## 1. 核心想法（為什麼好用）

一句話：**資料 → 區塊清單 → 一份獨立 HTML → 列印成 PDF。**

1. 報告不是存成一大段 HTML，而是存成一個 **JSON**：`{ theme, meta, blocks[] }`。
2. 每個 `block` 是一種內容單元（標題、文字、圖片、表格……），有自己的小型編輯器。
3. **渲染器是純函式** `buildReportHtml(report) → HTML 字串`：同一份 JSON，預覽、列印、下載、存檔都用它，畫面所見即所得。
4. 輸出是**單一 HTML 檔**：CSS 內嵌、圖片轉 base64 內嵌，沒有外部相依，寄給客戶、存進雲端、用瀏覽器「列印 → 另存 PDF」都行。
5. 品牌（顏色、字型、Logo、公司名、頁尾）是 `theme`，和內容分開，換一份 theme 整份文件就換一個風格。
6. **不需要後端產生 PDF**：不用 wkhtmltopdf、不用 headless Chrome，全在瀏覽器完成，零成本。

```
          ┌───────────────┐
 案件/商品 │ 自動帶入資料    │  buildBlocksFromCase()
 資料庫 ──▶│ 產生初始 blocks │
          └──────┬────────┘
                 ▼
   report = { theme, meta, blocks[] }  ◀── 使用者在左側編輯區改（增刪/排序/改字/貼圖）
                 │
                 ▼  buildReportHtml(report)   ← 純函式，唯一的輸出來源
        ┌────────┴─────────┬───────────────┬──────────────┐
        ▼                  ▼               ▼              ▼
   右側即時預覽(iframe)   列印/另存 PDF    下載 .html     存進雲端(附件)
```

---

## 2. 資料模型

```js
report = {
  caseId: 'ABC-001',                 // 關聯的業務主鍵（換成你系統的 ID）
  theme: {                            // 品牌設定
    preset: 'blue',                   // 預設配色名稱
    primary: '#0d6efd',               // 主色
    dark: '#0d3b66',                  // 標題深色
    textColor: '#2b2b2b',
    font: 'jhenghei',                 // 字型代號，對應 REPORT_FONTS
    baseSize: 14,                     // 內文字級 px
    companyName: '你的公司', companySub: 'English tagline',
    logo: 'data:image/png;base64,...',
    watermark: true, watermarkText: '你的公司',
    title: '評估報告',
    numbering: true,                  // 章節自動編號 01、02…
    footerText: '機密聲明…', footerBless: 'Thank you.', coverNote: '…'
  },
  meta: { reportNo: '', date: '2026-10-01', author: '', version: 'V1.0' },
  blocks: [ { id: 'b1', type: 'cover', ... }, { id: 'b2', type: 'heading', text: '測試結果' }, ... ]
}
```

### 區塊類型（blocks）

| type | 用途 | 主要欄位 |
|---|---|---|
| `cover` | 封面 | title, subtitle, kicker, customer, image |
| `heading` | 章節標題（自動編號） | text |
| `text` | 富文字段落（粗體/顏色/字級/清單/對齊） | html |
| `images` | 1～3 張並排圖片 + 圖說（自動「圖 1、圖 2」） | images[{src, caption}], widthPct, align |
| `imageText` | 左圖右文 / 左文右圖 | image, html, imageSide |
| `table` | 表格：`kv`（兩欄一列的資訊表）或自由格線 | rows[[label, value]] |
| `callout` | 重點框：結論/建議/注意/風險/說明，各有顏色與圖示 | variant, title, html |
| `signature` | 簽核欄（製表/審核/核准） | roles[] |
| `pagebreak` | 強制分頁 | — |

> **要做行銷文宣**，可新增：`hero`（大圖標語）、`feature`（三欄賣點卡片）、`price`（價格方案表）、`cta`（行動按鈕/QR Code）、`gallery`（多圖格線）、`testimonial`（客戶見證）。做法見第 6 節。

---

## 3. 渲染器 `buildReportHtml(report, options)`

原則：**只吃 JSON、只吐字串、沒有副作用**。核心骨架：

```js
function buildReportHtml(report, opt = {}) {
  const t = report.theme;
  const primary = safeColor(t.primary, '#0d6efd');          // 所有使用者輸入都先驗證
  const font = REPORT_FONTS[t.font] || REPORT_FONTS.jhenghei;

  const parts = report.blocks.map(b => {
    switch (b.type) {
      case 'heading':  return `<h2 class="rp-h2"${attr(b)}>${numbering()}${esc(b.text)}</h2>`;
      case 'text':     return `<div class="rp-text"${attr(b)}>${sanitizeRichHtml(b.html)}</div>`;
      case 'images':   return renderFigures(b);
      case 'callout':  return renderCallout(b);
      case 'pagebreak':return '<div class="rp-pagebreak"></div>';
      // …其他類型
    }
  });

  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
    <title>${esc(docTitle)}</title>
    ${font.google ? `<link href="https://fonts.googleapis.com/css2?family=${font.google}&display=swap" rel="stylesheet">` : ''}
    <style>${buildCss({ primary, dark, font, baseSize })}</style>
  </head><body><div class="rp-page">${parts.join('')}${footer()}</div></body></html>`;
}
```

重點細節：

- **用 CSS 變數上色**：`:root{--p:#0d6efd; --d:#0d3b66; --tint:rgba(p,.07)}`，換主色不用改任何 class。淡色底用 `hexToRgba(primary, 0.07)` 算出。
- `options.forEditor = true` 時，每個區塊多輸出 `data-block-id`，預覽裡**點一下內容就能跳到左側對應的編輯區塊**（反向也行）。最終輸出不帶這個屬性。
- 圖號、章節號都在渲染時用計數器產生，插入/刪除區塊後自動重排，不用人工維護。
- 浮水印用 `position:fixed` 的大字旋轉 + 低透明度，列印時每頁都會出現。

### 列印成 PDF 的關鍵 CSS（最容易踩雷）

```css
@page { size: A4; margin: 12mm 12mm 14mm; }
.rp-cover      { min-height: 260mm; break-after: page; page-break-after: always; }
.rp-h2, .rp-h3 { break-after: avoid; page-break-after: avoid; }   /* 標題不要落單在頁尾 */
.rp-figure, .rp-avoid, .rp-callout, .rp-table tr
               { break-inside: avoid; page-break-inside: avoid; } /* 圖/框/表格列不要被切斷 */
.rp-pagebreak  { break-after: page; page-break-after: always; height: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; } /* 底色/主色要印出來 */
```

要出 A3 傳單或 16:9 簡報，只要改 `@page size` 與版面寬度。

---

## 4. 編輯器（左側編輯 + 右側即時預覽）

- **畫面**：左欄兩個分頁——「報告內容」（區塊清單）與「版面與品牌」（theme 表單）；右欄是一個 `<iframe sandbox="allow-same-origin allow-modals">`，每次修改用 `iframe.srcdoc = buildReportHtml(report, {forEditor:true})` 重畫（用 300ms debounce）。iframe 用 sandbox 隔離，預覽內容不會影響主頁。
- **區塊操作**：新增、上移/下移、複製、刪除、摺疊；每種 type 對應一個編輯器函式，集中在 `BLOCK_EDITORS = { text(b){…}, images(b){…}, … }`，新增類型只要加一個函式 + 一個渲染 case。
- **富文字**：`contentEditable` 加自製小工具列（粗體、字級、顏色、螢光筆、對齊、清單），輸出前一律過 `sanitizeRichHtml()`。
- **圖片輸入**：檔案選取、**拖曳**、**截圖後 Ctrl+V 貼上** 三種；進來後用 canvas 壓縮（最長邊約 1600px、品質 0.85）再轉 base64，避免檔案太肥。
- **草稿自動存**：`DraftStore` 優先用 IndexedDB（容量大，能放圖片），3 秒內打不開就退回 localStorage；每次變動 debounce 存一次，重開頁面自動還原。
- **品牌預設**：「把品牌設定存成我的預設」寫進 localStorage，新報告自動套用，確保公司文件風格一致。
- **從資料自動帶入**：`buildBlocksFromCase(caseData)` 把資料庫欄位轉成初始區塊（基本資訊表、需求表、方案表、圖片）。`refillFromCase()` 只更新標記 `auto:true` 的自動欄位，**使用者自己加的區塊與手改的內容不會被覆蓋**——這個設計對「重新同步資料」非常重要。

---

## 5. 輸出方式

| 動作 | 做法 |
|---|---|
| 列印 / 另存 PDF | 建一個隱藏 iframe，寫入乾淨版 HTML，等**圖片與字型載入完**（`Promise.all(images) → document.fonts.ready`）再 `print()`，否則會印出空白。 |
| 下載 HTML | `new Blob([html], {type:'text/html;charset=utf-8'})` + `<a download>`。 |
| 存到雲端 | 把 HTML 轉 base64 丟給後端（本專案是 Apps Script 存進 Google Drive），連結記在資料表。 |
| 寄信 | 直接把 HTML 當附件，或後端轉 PDF（可選）。 |

---

## 6. 移植到其他網站：步驟

1. **複製兩支檔案**：`evalreport-render.js`（渲染）與 `evalreport.js`（編輯），加上 `evalreport.html` 與 `style.css` 內 `.er-*` 樣式。
2. **換掉資料來源**：`loadCase()`、`buildBlocksFromCase()`、`refillFromCase()` 是唯一和「案件」耦合的地方，改成讀你系統的資料（商品、活動、客戶……）。
3. **換掉儲存**：`saveReportToCase()` 改成呼叫你系統的 API；草稿仍用瀏覽器本機即可。
4. **調整 `REPORT_THEMES` / `REPORT_FONTS`** 成你的品牌色與字型；Logo 放預設圖或讓使用者上傳。
5. **依用途增減區塊類型**（見下）。
6. **權限與資料隔離**：報告只存在使用者自己的瀏覽器草稿與你指定的儲存位置，後端記得驗證身分。

### 做成行銷宣傳頁：建議新增的區塊

```js
// 渲染
case 'hero':
  return `<section class="mk-hero" style="background-image:url(${safeImgSrc(b.image)})">
            <h1>${esc(b.headline)}</h1><p>${esc(b.sub)}</p>
            ${b.ctaText ? `<a class="mk-btn" href="${safeUrl(b.ctaUrl)}">${esc(b.ctaText)}</a>` : ''}
          </section>`;
case 'features':   // 三欄賣點卡片
  return `<div class="mk-grid">${b.items.map(i => `<div class="mk-card"><div class="mk-ic">${esc(i.icon)}</div><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}</div>`;
case 'pricing':    // 方案比較表
case 'cta':        // 行動呼籲 + QR Code（可用 qrcode 產生 data URL）
case 'gallery':    // 多圖格線
case 'testimonial':// 客戶見證
```

行銷用途的差異點：

- **尺寸**：`@page { size: A4 }` 改成 DM 單張、社群圖（用 `html2canvas` 轉 PNG）或 16:9 簡報。
- **AI 文案**：加一顆「AI 幫我寫」按鈕，把商品資料送給 LLM，回傳填進 `hero/features` 的文字（前端呼叫你自己的後端代理，**API 金鑰不要放前端**）。
- **多版本**：同一份內容切換不同 `theme` 一鍵產出「給經銷商版 / 給終端客戶版」。
- **追蹤**：下載 HTML 版本可在按鈕連結加 UTM 參數。

---

## 7. 安全注意事項（務必保留）

這套程式有幾個容易被忽略、但移植時**一定要帶著走**的防護：

- `sanitizeRichHtml()`：富文字輸出前白名單過濾（只留安全標籤與屬性，拿掉 `script`、事件屬性、`javascript:` 連結、外部資源、`url()` 樣式）。內容可能是使用者從網頁/Word 貼上的。
- `safeImgSrc()`：圖片只接受 `data:image/...;base64,...`，擋掉外部圖片與奇怪的 scheme。
- `safeColor()` / `safeNum()`：顏色、數字先驗證再放進 CSS，避免 CSS 注入。
- `escHtml()`：所有純文字欄位一律跳脫。
- 預覽 iframe 加 `sandbox`。
- 如果新增了連結欄位（CTA 按鈕），要有 `safeUrl()` 只允許 `http/https/mailto`。

---

## 8. 給 AI 的實作提示詞（可直接貼給 Claude / 其他 AI）

```
我要在【我的網站名稱 / 技術棧】新增一個「報告 / 行銷文宣產生器」，請參考我提供的
evalreport.js、evalreport-render.js、evalreport.html 與 REPORT_GENERATOR_GUIDE.md 的做法：

1. 資料模型用 { theme, meta, blocks[] } 的 JSON。
2. 寫一個純函式 buildReportHtml(report, options)，輸出「單一 HTML」（CSS 內嵌、圖片 base64 內嵌），
   用 CSS 變數處理主色，列印用 @page A4 與 break-inside/break-after 規則。
3. 左側是區塊編輯器（新增/排序/複製/刪除、富文字、圖片可拖曳與 Ctrl+V 貼上並壓縮），
   右側是 sandbox iframe 即時預覽，點預覽可跳到對應區塊。
4. 草稿用 IndexedDB 自動儲存（失敗退回 localStorage）。
5. 輸出：列印/另存 PDF（等圖片與字型載入完再 print）、下載 HTML、存到【我的儲存位置】。
6. 品牌設定（配色、字型、Logo、公司名、浮水印、頁尾）可存成個人預設。
7. 資料自動帶入：從【我的資料來源，例如商品表/活動表】產生初始區塊，並支援「重新帶入」
   而不覆蓋使用者手改的內容（自動欄位標記 auto:true）。
8. 安全：保留 sanitizeRichHtml、safeImgSrc、safeColor、escHtml 這類白名單過濾。
9. 用途是【評估報告 / 產品 DM / 活動廣告 / 電子型錄】，請額外提供 hero、features、pricing、cta、gallery 區塊。

我的品牌色是【#xxxxxx】，Logo 在【路徑】，字型偏好【…】，輸出尺寸【A4 / DM / 16:9 / 社群方圖】。
請先給我檔案結構與資料模型，確認後再實作。
```

---

## 9. 檔案對照

| 功能 | 位置 |
|---|---|
| 區塊類型、主題、字型、重點框樣式常數 | `evalreport-render.js` 開頭 `REPORT_THEMES` / `REPORT_FONTS` / `CALLOUT_VARIANTS` |
| 安全過濾 | `evalreport-render.js`：`escHtml` `safeColor` `safeImgSrc` `sanitizeRichHtml` |
| 輸出 HTML 與列印 CSS | `evalreport-render.js`：`buildReportHtml` |
| 草稿儲存 | `evalreport.js`：`DraftStore` |
| 由資料產生區塊 | `evalreport.js`：`buildBlocksFromCase` `refillFromCase` |
| 各區塊編輯器 | `evalreport.js`：`BLOCK_EDITORS` `richEditor` `dropZone` |
| 圖片壓縮 | `evalreport.js`：`compressDataUrl` `filesToImages` |
| 預覽 / 列印 / 下載 / 存檔 | `evalreport.js`：`renderPreview` `printReport` `downloadReportHtml` `saveReportToCase` |
| 型號下拉 + 詢問是否新增進資料表 | `evalreport.js`：`buildModelValueInput` `maybeImportModel`（依你的資料表調整或移除） |
