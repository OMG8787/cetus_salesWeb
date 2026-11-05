// 極簡 Apps Script 模擬環境：只實作 Code.gs 會用到的試算表 / 日曆 / 快取 / 鎖 / UrlFetch 等 API，用來在本機跑後端邏輯測試。
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d, tz, fmt) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000); // GMT+8
  const Y = t.getUTCFullYear(), M = pad(t.getUTCMonth() + 1), D = pad(t.getUTCDate()), h = pad(t.getUTCHours()), m = pad(t.getUTCMinutes()), s = pad(t.getUTCSeconds());
  return fmt.replace("yyyy-MM-dd'T'HH:mm", `${Y}-${M}-${D}T${h}:${m}`).replace('yyyy-MM-dd HH:mm:ss', `${Y}-${M}-${D} ${h}:${m}:${s}`).replace('yyyy-MM-dd HH:mm', `${Y}-${M}-${D} ${h}:${m}`).replace('yyyy-MM-dd', `${Y}-${M}-${D}`).replace('HH:mm', `${h}:${m}`).replace('EEE', ['日', '一', '二', '三', '四', '五', '六'][t.getUTCDay()]).replace('u', String(t.getUTCDay() || 7));
}

let CtxDate = Date;
// Sheets 自動轉型：沒設純文字的儲存格，數字字串變數字、yyyy-MM-dd 變日期
function coerce(v, fmt) {
  if (fmt === '@' || typeof v !== 'string') return v;
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new CtxDate(`${v}T00:00:00+08:00`);
  return v;
}

class Sheet {
  constructor(name, header) {
    this.name = name;
    this.rows = [header.slice()];
    this.maxRows = 1000;
    this.maxCols = Math.max(26, header.length);
    this.fmt = {};
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some((v) => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let n = 0;
    this.rows.forEach((r) => r.forEach((v, i) => { if (v !== '' && v != null) n = Math.max(n, i + 1); }));
    return n;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = coerce(v, this.fmt[r + ',' + c]);
  }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  deleteRow(r) {
    this.rows.splice(r - 1, 1);
    const nf = {};
    Object.keys(this.fmt).forEach((k) => {
      const [rr, cc] = k.split(',').map(Number);
      if (rr < r) nf[k] = this.fmt[k];
      else if (rr > r) nf[(rr - 1) + ',' + cc] = this.fmt[k];
    });
    this.fmt = nf;
    this.maxRows--;
  }
  deleteRows(s, n) { for (let i = 0; i < n; i++) this.deleteRow(s); }
  insertRowsAfter(after, n) { this.maxRows += n; }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, i) => this.set(r, i + 1, v)); }
  setFrozenRows() {}
  getFrozenRows() { return 1; }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = this.sh.cell(this.r + i, this.c + j);
        row.push(v == null ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error(`setValues 尺寸不符 ${vals.length}x${vals[0].length} vs ${this.nr}x${this.nc}`);
    if (this.r + this.nr - 1 > this.sh.maxRows) throw new Error('超出工作表列數');
    vals.forEach((row, i) => row.forEach((v, j) => this.sh.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.fmt[(this.r + i) + ',' + (this.c + j)] = f;
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

/** opts.files：要載入的 .gs 檔案路徑陣列（依序，模擬 Apps Script 專案多個檔案共用全域範圍）；opts.fetch：UrlFetchApp.fetch 的模擬函式 */
function makeEnv(opts) {
  opts = opts || {};
  const files = opts.files || [require('path').join(__dirname, '..', 'Code.gs')];
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    getSheets: () => Object.values(sheets),
    insertSheet: (n) => (sheets[n] = new Sheet(n, [])),
    getUrl: () => 'mock://ss',
    getId: () => 'mock',
  };
  const events = {};
  let evSeq = 0;
  function mkEvent(title, start, end, o, allDay) {
    const id = 'ev' + ++evSeq;
    const ev = {
      id, title, start, end, allDay, desc: (o && o.description) || '',
      getId: () => id,
      isAllDayEvent: () => ev.allDay,
      setTitle: (t) => (ev.title = t),
      setTime: (s, e) => { ev.start = s; ev.end = e; ev.allDay = false; },
      setAllDayDate: (d) => { ev.start = d; ev.allDay = true; },
      setDescription: (d) => (ev.desc = d),
      deleteEvent: () => delete events[id],
      getTitle: () => ev.title,
    };
    events[id] = ev;
    return ev;
  }
  const calendar = {
    createEvent: (t, s, e, o) => mkEvent(t, s, e, o, false),
    createAllDayEvent: (t, d, o) => mkEvent(t, d, null, o, true),
    getEventById: (id) => events[id] || null,
    getEvents: () => Object.values(events),
  };
  const cache = {};
  const props = {};
  const drive = {};
  let driveSeq = 0;
  const driveFolder = (name) => {
    const id = 'folder' + ++driveSeq + 'abcdefghij';
    const files = [];
    return (drive[id] = {
      name, files, getId: () => id,
      createFile: (blob) => {
        const fid = 'file' + ++driveSeq + 'XYZabcdefg';
        const f = { blob, shared: false, trashed: false, getId: () => fid, setSharing: () => { if (opts.denyShare) throw new Error('policy'); f.shared = true; }, setTrashed: (v) => (f.trashed = v) };
        files.push(f);
        return f;
      },
    });
  };
  const fetchLog = [];
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    CalendarApp: { getDefaultCalendar: () => calendar },
    Utilities: {
      formatDate: fmtDate,
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (b) => (Array.isArray(b) ? Buffer.from(b.map((x) => (x < 0 ? x + 256 : x))).toString('base64') : Buffer.from(String(b)).toString('base64')),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      newBlob: (a, b, c) => ({ bytes: a, type: b, name: c }),
      base64Decode: (t) => Array.from(Buffer.from(String(t), 'base64')),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'link' },
      Permission: { VIEW: 'view' },
      createFolder: (n) => driveFolder(n),
      getFolderById: (id) => { if (!drive[id]) throw new Error('no folder'); return drive[id]; },
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => (cache[k] = v), remove: (k) => delete cache[k], removeAll: (ks) => ks.forEach((k) => delete cache[k]) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => (props[k] = String(v)), deleteProperty: (k) => delete props[k], getProperties: () => Object.assign({}, props) }) },
    UrlFetchApp: {
      fetch: (url, o) => {
        fetchLog.push({ url, o });
        const r = opts.fetch ? opts.fetch(url, o) : { code: 404, body: '' };
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      },
    },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }), everyHours: () => ({ create: () => {} }) }) }), deleteTrigger: () => {} },
  };
  vm.createContext(ctx);
  CtxDate = vm.runInContext('Date', ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
  const all = ctx.allSchemas_ ? ctx.allSchemas_() : { schema: ctx.SCHEMA, text: ctx.TEXT_COLUMNS };
  Object.keys(all.schema).forEach((name) => {
    const sh = (sheets[name] = new Sheet(name, all.schema[name]));
    (all.text[name] || []).forEach((col) => {
      const ci = all.schema[name].indexOf(col) + 1;
      if (ci <= 0) return;
      for (let r = 2; r <= sh.maxRows; r++) sh.fmt[r + ',' + ci] = '@';
    });
  });
  return { ctx, sheets, events, cache, props, fetchLog, drive };
}

module.exports = { makeEnv };
