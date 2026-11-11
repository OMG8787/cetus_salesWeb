/**
 * prospects-lib.js - 開發名單庫的純函式（不碰畫面，方便測試）
 * 讀檔（CSV / 政府的 .zip）、辨識編碼、解析 CSV、把欄位對到系統欄位、產業分類名稱、匯出 CSV。
 */

// 系統欄位（匯入時對應用）：key = 後端欄位名；aliases = 各種可能的 CSV 標題（比對時不分大小寫、忽略空白與括號）
const PS_FIELDS = [
  { key: 'Name', label: '公司名稱', required: true, aliases: ['工廠名稱', '公司名稱', '廠商名稱', '客戶名稱', '公司', '廠商', '名稱', 'companyname', 'company', 'name'] },
  { key: 'TaxId', label: '統一編號', aliases: ['統一編號', '統編', 'taxid', 'vat', 'vatnumber'] },
  { key: 'RegNo', label: '工廠登記編號', aliases: ['工廠登記編號'] },
  { key: 'Address', label: '地址', aliases: ['工廠地址', '公司地址', '營業地址', '地址', 'address'] },
  { key: 'Owner', label: '負責人', aliases: ['工廠負責人姓名', '負責人姓名', '負責人', '代表人', '代表人姓名'] },
  { key: 'Category', label: '產業分類', aliases: ['產業類別', '產業分類', '行業別', '行業', '產業', '類別', 'industry', 'category'] },
  { key: 'Products', label: '主要產品', aliases: ['主要產品', '主要產品服務', '產品', '營業項目', 'products'] },
  { key: 'Status', label: '登記狀態', aliases: ['工廠登記狀態', '登記狀態', '公司狀況', '狀態'] },
  { key: 'Org', label: '組織型態', aliases: ['工廠組織型態', '組織型態', '組織類型', '公司型態'] },
  { key: 'Website', label: '網站', aliases: ['官網', '網站', '網址', 'website', 'url', 'web'] },
  { key: 'Phone', label: '電話', aliases: ['公司電話', '聯絡電話', '電話', '手機', 'tel', 'phone', 'telephone'] },
  { key: 'Email', label: 'Email', aliases: ['email', 'e-mail', 'mail', '電子郵件', '電子信箱', '信箱'] },
  { key: 'Contact', label: '聯絡人', aliases: ['聯絡人', '聯絡窗口', '窗口', 'contact'] },
  { key: 'Notes', label: '備註', aliases: ['備註', 'note', 'notes', 'remark'] },
  { key: 'Type', label: '類型（一般使用者 / 設備商）', aliases: ['類型', '客戶類型', '公司類型', 'type'] },
];

// 行業快速選取（經濟部工廠登記的產業類別代碼）
const PS_GROUPS = [
  { label: '電子 / 光電 / 電力', codes: ['26', '27', '28'] },
  { label: '機械 / 金屬加工', codes: ['24', '25', '29'] },
  { label: '汽車 / 運輸工具', codes: ['30', '31'] },
  { label: '塑膠 / 橡膠 / 化工 / 非金屬', codes: ['18', '19', '21', '22', '23'] },
  { label: '民生 / 輕工業', codes: ['08', '09', '11', '12', '13', '14', '15', '16', '32', '33'] },
];

const PS_FACTORY_SOURCE = '經濟部生產中工廠名錄';

function psNormHeader(h) {
  return String(h || '')
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[\s_\-()（）【】\[\]:：/]/g, '');
}

/** 把位元組判成文字：先試 UTF-8（含 BOM），不是合法 UTF-8 就當 Big5（Excel 另存 CSV 常見）。 */
function psDecode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch (e) {
    return new TextDecoder('big5').decode(bytes);
  }
}

/** 解析 CSV（RFC 4180：雙引號、欄位內逗號與換行、"" 代表一個引號）。回傳二維陣列。 */
function psParseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  const n = text.length;
  let inQuotes = false;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      // 引號內：一次吃到下一個引號，比逐字處理快很多
      const next = text.indexOf('"', i);
      const end = next < 0 ? n : next;
      field += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === 34 && field === '') {
      inQuotes = true;
      i++;
    } else if (c === 44) {
      row.push(field);
      field = '';
      i++;
    } else if (c === 10 || c === 13) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    } else {
      // 一般文字：一次吃到下一個特殊字元
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 44 || d === 10 || d === 13) break;
        j++;
      }
      field += text.slice(i, j);
      i = j;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

/** 讀 .zip 裡第一個 CSV / TXT（政府開放資料常包成 zip）。瀏覽器的 DecompressionStream 負責解壓縮。回傳 { name, buffer }。 */
async function psUnzip(buffer) {
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('這不是有效的 zip 檔');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const flags = dv.getUint16(p + 8, true);
    const nameBytes = new Uint8Array(buffer, p + 46, nameLen);
    let name;
    try {
      name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'big5').decode(nameBytes);
    } catch (e) {
      name = new TextDecoder('utf-8').decode(nameBytes);
    }
    entries.push({ name, method: dv.getUint16(p + 10, true), compSize: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const entry = entries.find((e) => /\.(csv|txt)$/i.test(e.name)) || entries[0];
  if (!entry) throw new Error('zip 裡面沒有檔案');
  const lh = entry.offset;
  if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error('zip 檔案毀損');
  const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const comp = new Uint8Array(buffer, start, entry.compSize);
  if (entry.method === 0) return { name: entry.name, buffer: comp.slice().buffer };
  if (entry.method !== 8) throw new Error('不支援的 zip 壓縮方式');
  if (typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器不能直接讀 zip，請先解壓縮再選 CSV 檔');
  const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return { name: entry.name, buffer: await new Response(stream).arrayBuffer() };
}

/** 檔案內容（ArrayBuffer）→ { headers, rows, fileName }。支援 .csv / .txt / .zip。 */
async function psReadFileBuffer(buffer, fileName) {
  let buf = buffer;
  let name = fileName || '';
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const z = await psUnzip(buf);
    buf = z.buffer;
    name = z.name;
  }
  const rows = psParseCsv(psDecode(buf));
  if (rows.length < 2) throw new Error('檔案裡沒有資料列（第一列要是欄位標題）');
  return { headers: rows[0].map((h) => String(h).replace(/^﻿/, '').trim()), rows: rows.slice(1), fileName: name };
}

/** 依標題自動對應：回傳 { 系統欄位key: CSV 欄位索引 }，對不到的不放進去。同一個 CSV 欄位只給一個系統欄位用。 */
function psAutoMap(headers) {
  const norm = headers.map(psNormHeader);
  const map = {};
  const used = {};
  PS_FIELDS.forEach((f) => {
    for (const a of f.aliases) {
      const idx = norm.findIndex((h, i) => h === psNormHeader(a) && !used[i]);
      if (idx > -1) {
        map[f.key] = idx;
        used[idx] = true;
        return;
      }
    }
  });
  return map;
}

/** 看標題判斷是不是經濟部工廠名錄（有「工廠登記編號」和「產業類別」）。是 → 回建議的來源名稱。 */
function psDetectSource(headers) {
  const norm = headers.map(psNormHeader);
  return norm.includes('工廠登記編號') && norm.includes('產業類別') ? PS_FACTORY_SOURCE : '';
}

/** 一列 CSV → 送給後端的物件（只放有值的欄位，減少傳輸量）。對不到名稱的回 null。 */
function psRowToRecord(row, map) {
  const o = {};
  Object.keys(map).forEach((k) => {
    const v = row[map[k]];
    if (v != null && String(v).trim() !== '') o[k] = String(v).trim();
  });
  return o.Name ? o : null;
}

/** 把整份資料轉成要送的物件陣列，略過沒有名稱的列。回傳 { records, skipped }。 */
function psBuildRecords(rows, map) {
  const records = [];
  let skipped = 0;
  rows.forEach((r) => {
    const rec = psRowToRecord(r, map);
    if (rec) records.push(rec);
    else skipped++;
  });
  return { records, skipped };
}

/** 產業代碼字串（"29|25"）→ 顯示名稱陣列；代碼表沒有的（自由文字）就直接顯示。 */
function psCatNames(codes, industry) {
  return String(codes || '')
    .split('|')
    .filter(Boolean)
    .map((c) => (industry && industry[c]) || c);
}

/** 網址轉成能安全點的連結：只允許 http / https，沒寫的補 http://；其他（javascript: 等）回空字串。 */
function psSafeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return '';
  return 'http://' + s;
}

/** CSV 儲存格跳脫；開頭是 = 或 @（以及 + - 後面不是數字）的加單引號，避免用 Excel 開啟時被當成公式執行。 */
function psCsvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=@]/.test(s) || /^[+\-][^0-9\s(]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const PS_EXPORT_COLUMNS = [
  ['公司名稱', (r) => r.Name],
  ['統一編號', (r) => r.TaxId],
  ['工廠登記編號', (r) => r.RegNo],
  ['縣市', (r) => r.City],
  ['地址', (r) => r.Address],
  ['負責人', (r) => r.Owner],
  ['產業分類', (r, ind) => psCatNames(r.CatCodes, ind).join('、')],
  ['主要產品', (r) => r.Products],
  ['來源', (r) => r.Source],
  ['官網', (r) => r.Website],
  ['電話', (r) => r.Phone],
  ['Email', (r) => r.Email],
  ['聯絡人', (r) => r.Contact],
  ['開發狀態', (r) => r.Stage],
  ['負責業務', (r) => r.AssignedTo],
  ['拒絕聯絡', (r) => (r.Optout ? '是' : '')],
  ['備註', (r) => r.Notes],
];

function psRowsToCsv(rows, industry) {
  const lines = [PS_EXPORT_COLUMNS.map((c) => psCsvCell(c[0])).join(',')];
  rows.forEach((r) => lines.push(PS_EXPORT_COLUMNS.map((c) => psCsvCell(c[1](r, industry))).join(',')));
  return lines.join('\r\n');
}

if (typeof module !== 'undefined') {
  module.exports = { PS_FIELDS, PS_GROUPS, PS_FACTORY_SOURCE, psNormHeader, psDecode, psParseCsv, psUnzip, psReadFileBuffer, psAutoMap, psDetectSource, psRowToRecord, psBuildRecords, psCatNames, psSafeUrl, psCsvCell, psRowsToCsv };
}
