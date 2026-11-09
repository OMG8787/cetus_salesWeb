// 開發名單庫前端純函式：CSV 解析、編碼判斷、讀 zip、欄位自動對應、安全網址、匯出 CSV
const assert = require('assert');
const zlib = require('zlib');
const lib = require('../../frontend/prospects-lib.js');
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};

// ---- CSV 解析 ----
let rows = lib.psParseCsv('﻿a,b,c\r\n1,"x,y","say ""hi"""\r\n"line1\nline2",,3\r\n');
ok(rows.length === 3 && rows[0].join('|') === '﻿a|b|c', 'CSV：基本欄位（BOM 留給讀檔那層處理）');
ok(rows[1][1] === 'x,y' && rows[1][2] === 'say "hi"', 'CSV：雙引號欄位內的逗號與 "" 跳脫');
ok(rows[2][0] === 'line1\nline2' && rows[2][1] === '' && rows[2][2] === '3', 'CSV：欄位內換行、空欄位');
ok(lib.psParseCsv('a,b\n1,2').length === 2 && lib.psParseCsv('a,b\n1,2\n\n\n').length === 2, 'CSV：沒有結尾換行、尾端空行都能處理');
ok(lib.psParseCsv('a\n1\n').length === 2, 'CSV：單欄也能處理');

// ---- 編碼 ----
ok(lib.psDecode(Buffer.from('﻿公司,統編', 'utf8')) === '公司,統編', 'UTF-8（含 BOM）');
ok(lib.psDecode(new Uint8Array([0xa5, 0x78, 0xa4, 0xa4])) === '台中', '不是 UTF-8 → 當 Big5 解（Excel 另存的 CSV）');

// ---- zip ----
function makeZip(name, data, method) {
  const nameB = Buffer.from(name, 'utf8');
  const comp = method === 8 ? zlib.deflateRawSync(data) : data;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x800, 6);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameB.length, 26);
  const local = Buffer.concat([lh, nameB, comp]);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x800, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameB.length, 28);
  cd.writeUInt32LE(0, 42);
  const central = Buffer.concat([cd, nameB]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  const all = Buffer.concat([local, central, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
const csvText = '﻿工廠名稱,工廠登記編號,統一編號,產業類別,主要產品\n琮允五金行,99657234,87851941,"30汽車及其零件製造業、29機械設備製造業",303汽車零件\n';
(async () => {
  for (const method of [8, 0]) {
    const z = makeZip('生產中工廠清冊.csv', Buffer.from(csvText, 'utf8'), method);
    const f = await lib.psReadFileBuffer(z, 'x.zip');
    ok(f.fileName === '生產中工廠清冊.csv' && f.headers[0] === '工廠名稱' && f.rows.length === 1 && f.rows[0][0] === '琮允五金行', 'zip（壓縮方式 ' + method + '）：直接讀出裡面的 CSV');
  }
  const plain = Buffer.from(csvText, 'utf8');
  const f2 = await lib.psReadFileBuffer(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.length), 'a.csv');
  ok(f2.rows.length === 1 && f2.headers[3] === '產業類別', '一般 CSV 檔');
  let err = '';
  try {
    const one = Buffer.from('只有標題\n');
    await lib.psReadFileBuffer(one.buffer.slice(one.byteOffset, one.byteOffset + one.length), 'b.csv');
  } catch (e) {
    err = e.message;
  }
  ok(/沒有資料列/.test(err), '只有標題列 → 清楚的錯誤');
  err = '';
  try {
    const bad = new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    await lib.psReadFileBuffer(bad.buffer, 'c.zip');
  } catch (e) {
    err = e.message;
  }
  ok(/zip/.test(err), '壞掉的 zip → 錯誤訊息');

  // ---- 欄位對應 ----
  const factoryHeaders = ['工廠名稱', '工廠登記編號', '工廠設立許可案號', '工廠地址', '工廠市鎮鄉村里', '工廠負責人姓名', '統一編號', '工廠組織型態', '工廠設立核准日期', '工廠登記核准日期', '工廠登記狀態', '產業類別', '主要產品'];
  let map = lib.psAutoMap(factoryHeaders);
  ok(map.Name === 0 && map.RegNo === 1 && map.Address === 3 && map.Owner === 5 && map.TaxId === 6 && map.Org === 7 && map.Status === 10 && map.Category === 11 && map.Products === 12, '工廠名錄的欄位全部自動對應');
  ok(map.Phone === undefined && map.Email === undefined, '沒有的欄位不亂對');
  ok(lib.psDetectSource(factoryHeaders) === lib.PS_FACTORY_SOURCE && lib.psDetectSource(['公司名稱', 'Email']) === '', '看標題辨識是不是工廠名錄');
  map = lib.psAutoMap(['﻿公司名稱', '統編', 'E-mail', '公司電話', '官網', '聯絡人', '產業', '備註', '縣市']);
  ok(map.Name === 0 && map.TaxId === 1 && map.Email === 2 && map.Phone === 3 && map.Website === 4 && map.Contact === 5 && map.Category === 6 && map.Notes === 7, '展覽 / 自己整理的名單：各種標題寫法都能對應（含 BOM、E-mail）');
  map = lib.psAutoMap(['Company Name', 'Tax ID', 'Email', 'Phone']);
  ok(map.Name === 0 && map.TaxId === 1 && map.Email === 2 && map.Phone === 3, '英文標題');
  map = lib.psAutoMap(['名稱', '公司名稱']);
  ok(map.Name === 1 && Object.keys(map).length === 1, '同一欄不會被兩個系統欄位重複使用');

  // ---- 轉成匯入資料 ----
  const parsed = lib.psBuildRecords([['琮允', '87851941', ''], ['', '12345678', 'x'], ['  新公司 ', '', 'a@b.com']], { Name: 0, TaxId: 1, Email: 2 });
  ok(parsed.records.length === 2 && parsed.skipped === 1, '沒有名稱的列略過並計數');
  ok(JSON.stringify(parsed.records[0]) === '{"Name":"琮允","TaxId":"87851941"}' && parsed.records[1].Name === '新公司' && parsed.records[1].Email === 'a@b.com', '只送有值的欄位、前後空白去掉');

  // ---- 產業名稱 / 網址 / 匯出 ----
  const ind = { 29: '機械設備製造業', 25: '金屬製品製造業' };
  ok(lib.psCatNames('29|25|半導體', ind).join() === '機械設備製造業,金屬製品製造業,半導體' && lib.psCatNames('', ind).length === 0, '產業代碼 → 名稱（沒有的原樣顯示）');
  ok(lib.psSafeUrl('www.a.com') === 'http://www.a.com' && lib.psSafeUrl('https://a.com/x') === 'https://a.com/x' && lib.psSafeUrl('javascript:alert(1)') === '' && lib.psSafeUrl('data:text/html,x') === '' && lib.psSafeUrl('') === '', '網址：只允許 http(s)，危險的不產生連結');
  ok(lib.psCsvCell('a,b') === '"a,b"' && lib.psCsvCell('=HYPERLINK("x")') === '"\'=HYPERLINK(""x"")"' && lib.psCsvCell('@SUM(1)') === "'@SUM(1)" && lib.psCsvCell('+886-2-1234') === '+886-2-1234' && lib.psCsvCell('-cmd') === "'-cmd", 'CSV 儲存格：跳脫逗號 / 引號，公式開頭加單引號，電話的 +886 不動');
  const csv = lib.psRowsToCsv([{ Name: '琮允, 五金', TaxId: '87851941', City: '臺南市', CatCodes: '29|25', Source: '來源A、來源B', Optout: 'Y', Notes: '=1+1', Stage: '未處理' }], ind);
  const lines = csv.split('\r\n');
  ok(lines[0].startsWith('公司名稱,統一編號,工廠登記編號,縣市,地址,負責人,產業分類') && lines[1].startsWith('"琮允, 五金",87851941,,臺南市,,,機械設備製造業、金屬製品製造業'), '匯出 CSV：欄位與產業名稱');
  ok(lines[1].indexOf(',是,') > -1 && lines[1].endsWith("'=1+1"), '匯出：拒絕聯絡寫「是」、備註的公式被中和');

  // ---- 速度：解析 10 萬列 × 13 欄 ----
  const big = ['a,b,c,d,e,f,g,h,i,j,k,l,m'];
  for (let i = 0; i < 100000; i++) big.push('工廠' + i + ',R' + i + ',,臺中市西屯區工業路' + i + '號,臺中市西屯區,王小明　,' + (10000000 + i) + ',有限公司,,1130101,生產中,"29機械設備製造業、25金屬製品製造業  ",293通用機械設備');
  const t0 = Date.now();
  const bigRows = lib.psParseCsv(big.join('\r\n'));
  const ms = Date.now() - t0;
  ok(bigRows.length === 100001 && bigRows[100000][11] === '29機械設備製造業、25金屬製品製造業  ', '10 萬列 × 13 欄解析正確');
  console.log('  （解析 10 萬列耗時 ' + ms + ' ms）');
  ok(ms < 5000, '解析速度可接受');
  console.log('prospects-lib checks passed:', pass);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
