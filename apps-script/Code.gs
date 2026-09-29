/**
 * ============================================================
 * AOI 業務/評估/詢價/報價 系統 - 後端 (Google Apps Script)
 * ------------------------------------------------------------
 * === 檔案結構導覽 ===
 *   1. 分頁名稱常數
 *   2. 路由表 ROUTES：所有 API 動作都註冊在這裡，之後要新增功能只要：
 *        (a) 寫一個 handleXxx(body) 函式
 *        (b) 在 ROUTES 裡加一行對應
 *      不需要動 doPost 本身。
 *   3. doPost/doGet 入口
 *   4. 共用小工具 (讀寫試算表、雜湊、驗證登入、通用的依欄位更新/刪除列...)
 *   5. 各功能模組：
 *      產品(含CRUD) / 價格紀錄(含CRUD) / 詢價信 /
 *      案件(含查詢修改刪除) / 文件產生(需求單・評估單・報價單) /
 *      客戶(含分類/急迫性+行事曆) / 客戶聯繫紀錄 / 日報
 *
 * 試算表分頁與欄位(詳見 README.md)：
 *   Products      - InternalModel, SupplierModel, Supplier, SupplierContact,
 *                    SupplierContactEmail, Origin, Category, CompatibleGroup, RefPrice, Notes
 *   PriceHistory  - Date, ProductInternalModel, Supplier, Price, Currency, CaseID, Notes
 *   Cases         - CaseID, CustomerName, EndCustomerName, ProjectContact, ContactPhone,
 *                    Salesperson, FAE, ProductApplication, TestObject, SoftwareName,
 *                    SoftwareCustomization, SoftwareCustomizationNote, Status, CreatedDate,
 *                    RequirementDetails, AttachmentLinksJson,
 *                    EvaluationResult, EvaluationReportHtml, LastUpdated
 *   CCDRequirements - CaseID, CcdIndex, Description, FovLengthMm, FovWidthMm, WdMm,
 *                    AccuracyUm, FlyingSpeedMmS, InspectionSpeedPs, LightingNote
 *                    （一個案件可能對應多列，用 CaseID 關聯）
 *   Staff         - Name, Role（業務/FAE 自動完成 + 快速新增用）
 *   Customers     - CompanyName, Contact, Phone, Email, NextFollowUpDate, Category,
 *                    Urgency, Notes, CalendarEventId
 *   ContactLogs   - Date, CompanyName, Contact, Method, Summary, Salesperson
 *   Users         - Username, PasswordHash, Role
 *   Config        - Key, Value
 * ============================================================
 */

// ------------------------------------------------------------
// 1. 分頁名稱常數
// ------------------------------------------------------------
var SHEET_PRODUCTS = 'Products';
var SHEET_PRICE_HISTORY = 'PriceHistory';
var SHEET_CASES = 'Cases';
var SHEET_CUSTOMERS = 'Customers';
var SHEET_CONTACT_LOGS = 'ContactLogs';
var SHEET_STAFF = 'Staff';
var SHEET_CCD_REQUIREMENTS = 'CCDRequirements';
var SHEET_USERS = 'Users';
var SHEET_CONFIG = 'Config';

// ------------------------------------------------------------
// 2. 路由表
// ------------------------------------------------------------
// 之後要新增一個 API 動作：
//   1) 寫 function handleXxx(body) { ... }
//   2) 在下面加一行： xxx: { auth: true, fn: handleXxx },
var ROUTES = {
  login:                   { auth: false, fn: handleLogin },

  // 產品(產品搜尋表)
  searchProducts:          { auth: true, fn: handleSearchProducts },
  getProduct:              { auth: true, fn: handleGetProduct },
  addProduct:              { auth: true, fn: handleAddProduct },
  updateProduct:           { auth: true, fn: handleUpdateProduct },
  deleteProduct:           { auth: true, fn: handleDeleteProduct },

  // 價格紀錄
  addPriceRecord:          { auth: true, fn: handleAddPriceRecord },
  getPriceHistory:         { auth: true, fn: handleGetPriceHistory },
  updatePriceRecord:       { auth: true, fn: handleUpdatePriceRecord },
  deletePriceRecord:       { auth: true, fn: handleDeletePriceRecord },

  // 詢價信
  generateInquiryDraft:    { auth: true, fn: handleGenerateInquiryDraft },
  createGmailDraft:        { auth: true, fn: handleCreateGmailDraft },

  // 案件
  createCase:              { auth: true, fn: handleCreateCase },
  getCases:                { auth: true, fn: handleGetCases },
  getCase:                 { auth: true, fn: handleGetCase },
  getCasesPageData:        { auth: true, fn: handleGetCasesPageData },
  updateCase:              { auth: true, fn: handleUpdateCase },
  deleteCase:              { auth: true, fn: handleDeleteCase },
  uploadCaseAttachment:    { auth: true, fn: handleUploadCaseAttachment },
  deleteCaseAttachment:    { auth: true, fn: handleDeleteCaseAttachment },
  getCaseImages:           { auth: true, fn: handleGetCaseImages },

  // 人員（業務/FAE 快速新增+自動完成用）
  getStaff:                { auth: true, fn: handleGetStaff },
  addStaff:                { auth: true, fn: handleAddStaff },

  // 文件產生（每種都支援 format: 'html' / 'pdf' / 'docx'）
  generateRequirementDoc:  { auth: true, fn: handleGenerateRequirementDoc },
  generateEvaluationDoc:   { auth: true, fn: handleGenerateEvaluationDoc },
  generateQuoteDoc:        { auth: true, fn: handleGenerateQuoteDoc },

  // 客戶 + 行事曆
  getCustomers:            { auth: true, fn: handleGetCustomers },
  addCustomer:             { auth: true, fn: handleAddCustomer },
  updateCustomer:          { auth: true, fn: handleUpdateCustomer },
  deleteCustomer:          { auth: true, fn: handleDeleteCustomer },

  // 客戶聯繫紀錄
  addContactLog:           { auth: true, fn: handleAddContactLog },
  getContactLogs:          { auth: true, fn: handleGetContactLogs },
  deleteContactLog:        { auth: true, fn: handleDeleteContactLog },

  // 日報 / 週報（可指定日期區間、業務）
  getDailyReportData:      { auth: true, fn: handleGetDailyReportData },
  sendDailyReportNow:      { auth: true, fn: handleSendDailyReportNow },
};

// ------------------------------------------------------------
// 3. 入口
// ------------------------------------------------------------
function doPost(e) {
  var result;
  try {
    var body = JSON.parse(e.postData.contents);
    var route = ROUTES[body.action];

    if (!route) {
      result = { success: false, message: '未知的操作: ' + body.action };
    } else {
      if (route.auth) body._user = requireAuth(body); // handler 需要知道是誰在操作時用 body._user
      result = route.fn(body);
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }
  return jsonOutput(result);
}

function doGet(e) {
  return jsonOutput({ success: true, message: 'AOI 系統 API 運作中，請用 POST 呼叫。' });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// 4. 共用小工具
// ------------------------------------------------------------

function getSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('找不到分頁: ' + name + '，請確認試算表分頁名稱是否正確。');
  return sheet;
}

function rowToObject(header, row) {
  var obj = {};
  header.forEach(function (h, i) {
    obj[h] = normalizeCellValue(row[i]);
  });
  return obj;
}

/**
 * 試算表會把寫進去的 "2026-09-23" 文字自動轉成日期格式，讀出來變成 Date 物件，
 * 跟字串比對(例如日報篩選「今天」)永遠不相等，傳到前端也會變成 ISO 時間字串。
 * 這裡統一把日期儲存格轉回 yyyy-MM-dd 字串。
 */
function normalizeCellValue(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+8', 'yyyy-MM-dd');
  return v;
}

/** 今天日期字串 yyyy-MM-dd（台灣時間）。 */
function todayStr() {
  return Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd');
}

/** yyyy-MM-dd 字串加減天數（台灣沒有日光節約時間，直接加毫秒即可）。 */
function addDaysStr(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00+08:00');
  return Utilities.formatDate(new Date(d.getTime() + n * 86400000), 'GMT+8', 'yyyy-MM-dd');
}

function isDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function sheetToObjects(sheetName) {
  var sheet = getSheet(sheetName);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { header: data[0] || [], rows: [] };
  var header = data[0];
  var rows = data.slice(1).map(function (r) {
    return rowToObject(header, r);
  });
  return { header: header, rows: rows };
}

function appendObjectRow(sheetName, obj) {
  var sheet = getSheet(sheetName);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = header.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/** 依欄位名稱更新某一列的部分欄位。fields = {欄位名: 新值}。 */
function updateRowFields(sheetName, rowNum, fields) {
  var sheet = getSheet(sheetName);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(fields || {}).forEach(function (key) {
    var col = header.indexOf(key);
    if (col > -1) sheet.getRange(rowNum, col + 1).setValue(fields[key]);
  });
  return header;
}

/** 讀取某一列目前完整內容，組成物件。 */
function readRowAsObject(sheetName, rowNum) {
  var sheet = getSheet(sheetName);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  return rowToObject(header, values);
}

function getConfig(key) {
  var sheet = getSheet(SHEET_CONFIG);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

/** 寫入/更新 Config 分頁的一筆設定，key 不存在就新增一列。 */
function setConfig(key, value) {
  var sheet = getSheet(SHEET_CONFIG);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

/** 取得(或第一次自動建立)附件存放用的雲端硬碟資料夾，資料夾ID存在 Config 的 AttachmentsFolderId。 */
function getOrCreateAttachmentsFolderId() {
  var id = getConfig('AttachmentsFolderId');
  if (id) {
    try {
      DriveApp.getFolderById(id);
      return id;
    } catch (e) {
      // 資料夾被刪掉或ID失效，往下重新建立一個
    }
  }
  var folder = DriveApp.createFolder('AOI系統附件');
  setConfig('AttachmentsFolderId', folder.getId());
  return folder.getId();
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return raw
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

/** 手動在 Apps Script 編輯器執行這個函式來產生密碼雜湊值，用法見 README。 */
function generatePasswordHash() {
  Logger.log(sha256('changeme'));
}

// ------------------------------------------------------------
// 登入 / 驗證
// ------------------------------------------------------------
function handleLogin(body) {
  var username = body.username;
  var password = body.password;
  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var uCol = header.indexOf('Username');
  var pCol = header.indexOf('PasswordHash');
  var rCol = header.indexOf('Role');
  var dCol = header.indexOf('DisplayName'); // 選填欄位：業務姓名，要跟案件的「業務」欄位寫法一致，日報才篩得到
  var hash = sha256(password);

  for (var i = 1; i < data.length; i++) {
    if (data[i][uCol] === username && data[i][pCol] === hash) {
      var token = Utilities.getUuid();
      var displayName = (dCol > -1 && data[i][dCol]) || username;
      var user = { username: username, displayName: displayName };
      CacheService.getScriptCache().put('token_' + token, JSON.stringify(user), 21600); // 6 小時
      return { success: true, token: token, username: username, displayName: displayName, role: rCol > -1 ? data[i][rCol] : '' };
    }
  }
  return { success: false, message: '帳號或密碼錯誤' };
}

/** 驗證 token，回傳 { username, displayName }。 */
function requireAuth(body) {
  var token = body.token;
  if (!token) throw new Error('尚未登入');
  var cached = CacheService.getScriptCache().get('token_' + token);
  if (!cached) throw new Error('登入已逾期，請重新登入');
  try {
    return JSON.parse(cached);
  } catch (e) {
    // 舊版登入時快取裡只存帳號字串
    return { username: cached, displayName: cached };
  }
}

// ------------------------------------------------------------
// 產品搜尋表 (CRUD)
// ------------------------------------------------------------
function handleSearchProducts(body) {
  var keyword = String(body.keyword || '').toLowerCase();
  var data = sheetToObjects(SHEET_PRODUCTS);
  var results = data.rows.filter(function (r) {
    if (!keyword) return true;
    return data.header.some(function (h) {
      return String(r[h] || '').toLowerCase().indexOf(keyword) > -1;
    });
  });

  // 每個產品的詢價次數(= 價格紀錄筆數)，前端可以拿來排序看哪些是熱門產品
  var counts = {};
  sheetToObjects(SHEET_PRICE_HISTORY).rows.forEach(function (h) {
    var key = h['ProductInternalModel'];
    counts[key] = (counts[key] || 0) + 1;
  });
  results.forEach(function (r) {
    r.InquiryCount = counts[r['InternalModel']] || 0;
  });
  return { success: true, products: results };
}

function handleGetProduct(body) {
  var internalModel = body.internalModel;
  var data = sheetToObjects(SHEET_PRODUCTS);
  var product = null;
  data.rows.forEach(function (r) {
    if (String(r['InternalModel']) === String(internalModel)) product = r;
  });
  if (!product) return { success: false, message: '查無此產品' };

  var group = product['CompatibleGroup'];
  var compatibleProducts = data.rows.filter(function (r) {
    return group && r['CompatibleGroup'] === group && r['InternalModel'] !== internalModel;
  });

  var priceHistory = handleGetPriceHistory({ internalModel: internalModel }).history;

  return {
    success: true,
    product: product,
    compatibleProducts: compatibleProducts,
    priceHistory: priceHistory,
    lastPrice: priceHistory.length ? priceHistory[0] : null,
  };
}

function findProductRowIndex(header, internalModel) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var data = sheet.getDataRange().getValues();
  var idCol = header.indexOf('InternalModel');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(internalModel)) return i + 1;
  }
  return -1;
}

function handleAddProduct(body) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!body.internalModel) return { success: false, message: '內部型號為必填' };
  if (findProductRowIndex(header, body.internalModel) > -1) {
    return { success: false, message: '此內部型號已存在，如要修改請用「修改」功能' };
  }
  appendObjectRow(SHEET_PRODUCTS, {
    InternalModel: body.internalModel,
    SupplierModel: body.supplierModel || '',
    Supplier: body.supplier || '',
    SupplierContact: body.supplierContact || '',
    SupplierContactEmail: body.supplierContactEmail || '',
    Origin: body.origin || '',
    Category: body.category || '',
    CompatibleGroup: body.compatibleGroup || '',
    RefPrice: body.refPrice || '',
    Notes: body.notes || '',
  });
  return { success: true };
}

function handleUpdateProduct(body) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = findProductRowIndex(header, body.internalModel);
  if (rowNum === -1) return { success: false, message: '查無此產品' };
  updateRowFields(SHEET_PRODUCTS, rowNum, body.fields);
  return { success: true };
}

function handleDeleteProduct(body) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = findProductRowIndex(header, body.internalModel);
  if (rowNum === -1) return { success: false, message: '查無此產品' };
  sheet.deleteRow(rowNum);
  return { success: true };
}

// ------------------------------------------------------------
// 價格紀錄表 (CRUD)
// ------------------------------------------------------------
function handleGetPriceHistory(body) {
  var sheet = getSheet(SHEET_PRICE_HISTORY);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, history: [] };
  var header = data[0];
  var history = [];
  for (var i = 1; i < data.length; i++) {
    var obj = rowToObject(header, data[i]);
    if (String(obj['ProductInternalModel']) === String(body.internalModel)) {
      obj.RowIndex = i + 1;
      history.push(obj);
    }
  }
  history.sort(function (a, b) {
    return new Date(b['Date']) - new Date(a['Date']);
  });
  return { success: true, history: history };
}

function handleAddPriceRecord(body) {
  appendObjectRow(SHEET_PRICE_HISTORY, {
    Date: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
    ProductInternalModel: body.internalModel,
    Supplier: body.supplier || '',
    Price: body.price || '',
    Currency: body.currency || 'TWD',
    CaseID: body.caseId || '',
    Notes: body.notes || '',
  });
  return { success: true };
}

function handleUpdatePriceRecord(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  updateRowFields(SHEET_PRICE_HISTORY, body.rowIndex, body.fields);
  return { success: true };
}

function handleDeletePriceRecord(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_PRICE_HISTORY).deleteRow(body.rowIndex);
  return { success: true };
}

// ------------------------------------------------------------
// 詢價信件
// ------------------------------------------------------------
function handleGenerateInquiryDraft(body) {
  var productResult = handleGetProduct({ internalModel: body.internalModel });
  if (!productResult.success) return productResult;
  var p = productResult.product;
  var lastPrice = productResult.lastPrice;

  var subject = '詢價 - ' + p['InternalModel'] + ' / ' + p['SupplierModel'];
  var bodyText =
    (p['SupplierContact'] ? p['SupplierContact'] + ' 您好，\n\n' : '您好，\n\n') +
    '想請教以下產品報價：\n' +
    '供應商型號: ' + p['SupplierModel'] + '\n' +
    '對應內部型號: ' + p['InternalModel'] + '\n' +
    (lastPrice ? '上次報價紀錄: ' + lastPrice['Price'] + ' ' + (lastPrice['Currency'] || '') + '（' + lastPrice['Date'] + '）\n' : '') +
    '需求數量: ' + (body.quantity || '請提供') + '\n\n' +
    '麻煩協助報價，謝謝！';

  var draftUrl = null;
  try {
    if (p['SupplierContactEmail']) {
      var draft = GmailApp.createDraft(p['SupplierContactEmail'], subject, bodyText);
      draftUrl = 'https://mail.google.com/mail/u/0/#drafts?compose=' + draft.getId();
    }
  } catch (mailErr) {
    // 沒有 Gmail 權限或帳號沒有信箱時，不中斷流程
  }

  return { success: true, subject: subject, body: bodyText, draftUrl: draftUrl };
}

/** 通用建立 Gmail 草稿：合併詢價信(多品項一次詢價)用這個，也可以給其他功能重複使用。 */
function handleCreateGmailDraft(body) {
  if (!body.to) return { success: false, message: '缺少收件人 Email' };
  try {
    var draft = GmailApp.createDraft(body.to, body.subject || '詢價', body.body || '');
    return { success: true, draftUrl: 'https://mail.google.com/mail/u/0/#drafts?compose=' + draft.getId() };
  } catch (err) {
    return { success: false, message: '建立草稿失敗: ' + err.message };
  }
}

// ------------------------------------------------------------
// 案件管理 (建立 / 查詢 / 修改 / 刪除)
// ------------------------------------------------------------
/** 把字串處理成適合放進案件編號的片段：去除空白/特殊符號，過長截斷，空值給預設字。 */
function sanitizeForId(str) {
  var s = String(str || '').trim().replace(/[^\w\u4e00-\u9fa5]+/g, '');
  s = s.slice(0, 20);
  return s || 'NA';
}

/** 案件編號 = 軟體名稱-待測物件-產品應用-客戶名稱，重複的話自動加流水號避免撞號。 */
function generateCaseId(fields) {
  var base = [
    sanitizeForId(fields.softwareName),
    sanitizeForId(fields.testObject),
    sanitizeForId(fields.productApplication),
    sanitizeForId(fields.customerName),
  ].join('-');

  var sheet = getSheet(SHEET_CASES);
  var data = sheet.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < data.length; i++) existing[data[i][0]] = true;

  var candidate = base;
  var n = 2;
  while (existing[candidate]) {
    candidate = base + '-' + n;
    n++;
  }
  return candidate;
}

function handleCreateCase(body) {
  var caseId = generateCaseId(body);
  appendObjectRow(SHEET_CASES, {
    CaseID: caseId,
    CustomerName: body.customerName || '',
    EndCustomerName: body.endCustomerName || '',
    ProjectContact: body.projectContact || '',
    ContactPhone: body.contactPhone || '',
    Salesperson: body.salesperson || '',
    FAE: body.fae || '',
    ProductApplication: body.productApplication || '',
    TestObject: body.testObject || '',
    SoftwareName: body.softwareName || '',
    SoftwareCustomization: body.softwareCustomization || '',
    SoftwareCustomizationNote: body.softwareCustomizationNote || '',
    Status: body.status || '需求單已發出',
    CreatedDate: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
    RequirementDetails: body.requirementDetails || '',
    AttachmentLinksJson: '[]',
    EvaluationResult: '',
    EvaluationReportHtml: '',
    LastUpdated: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
  });
  saveCcdRequirementsForCase(caseId, body.ccdRequirements || []);
  return { success: true, caseId: caseId };
}

/** 查詢案件清單：可用 status 篩選、keyword 模糊搜尋(案件編號/客戶/業務/FAE)。 */
function handleGetCases(body) {
  var data = sheetToObjects(SHEET_CASES);
  var rows = data.rows;

  if (body.status) {
    rows = rows.filter(function (r) {
      return r['Status'] === body.status;
    });
  }
  if (body.keyword) {
    var kw = String(body.keyword).toLowerCase();
    rows = rows.filter(function (r) {
      return ['CaseID', 'CustomerName', 'Salesperson', 'FAE'].some(function (f) {
        return String(r[f] || '').toLowerCase().indexOf(kw) > -1;
      });
    });
  }

  rows.sort(function (a, b) {
    return new Date(b['CreatedDate']) - new Date(a['CreatedDate']);
  });
  return { success: true, cases: rows };
}

/** 案件管理頁一進來要的資料(案件+客戶+人員)一次打包，省掉三次 Apps Script 啟動延遲。 */
function handleGetCasesPageData(body) {
  return {
    success: true,
    cases: handleGetCases({}).cases,
    customers: handleGetCustomers({}).customers,
    staff: handleGetStaff({}).staff,
  };
}

function handleGetCase(body) {
  var caseObj = findCase(body.caseId);
  if (!caseObj) return { success: false, message: '查無此案件' };
  caseObj = Object.assign({}, caseObj, { CcdRequirements: getCcdRequirementsForCase(body.caseId) });
  return { success: true, caseData: caseObj };
}

function findCaseRowIndex(header, caseId) {
  var sheet = getSheet(SHEET_CASES);
  var data = sheet.getDataRange().getValues();
  var idCol = header.indexOf('CaseID');
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === caseId) return i + 1;
  }
  return -1;
}

function handleUpdateCase(body) {
  var sheet = getSheet(SHEET_CASES);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = findCaseRowIndex(header, body.caseId);
  if (rowNum === -1) return { success: false, message: '查無此案件' };

  if (body.fields) updateRowFields(SHEET_CASES, rowNum, body.fields);
  var luCol = header.indexOf('LastUpdated');
  if (luCol > -1) sheet.getRange(rowNum, luCol + 1).setValue(Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'));

  // body.ccdRequirements 有給的話（例如案件編輯畫面按儲存修改）就整批覆蓋掉這個案件的 CCD 資料
  if (body.ccdRequirements) saveCcdRequirementsForCase(body.caseId, body.ccdRequirements);

  return { success: true };
}

function handleDeleteCase(body) {
  var sheet = getSheet(SHEET_CASES);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = findCaseRowIndex(header, body.caseId);
  if (rowNum === -1) return { success: false, message: '查無此案件' };
  sheet.deleteRow(rowNum);
  deleteCcdRowsForCase(body.caseId);
  return { success: true };
}

function findCase(caseId) {
  var data = sheetToObjects(SHEET_CASES);
  var found = null;
  data.rows.forEach(function (r) {
    if (r['CaseID'] === caseId) found = r;
  });
  return found;
}

// ------------------------------------------------------------
// CCD 檢測需求（存在獨立分頁 CCDRequirements，一個案件可以對應多列，
// 這樣直接在試算表打開 Cases 也好搭配 CCDRequirements 用 CaseID 查閱，
// 不用像以前塞一大包 JSON 字串在一個儲存格裡看不出內容）
// ------------------------------------------------------------

/** 刪掉某案件目前所有的 CCD 列（從後面往前刪，避免刪除時列號位移出錯）。 */
function deleteCcdRowsForCase(caseId) {
  var sheet = getSheet(SHEET_CCD_REQUIREMENTS);
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('CaseID');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === caseId) sheet.deleteRow(i + 1);
  }
}

/** 整批覆蓋某案件的 CCD 需求：先刪掉舊的，再依序把新的每一組 CCD 各存成一列。 */
function saveCcdRequirementsForCase(caseId, ccdList) {
  deleteCcdRowsForCase(caseId);
  (ccdList || []).forEach(function (ccd, idx) {
    appendObjectRow(SHEET_CCD_REQUIREMENTS, {
      CaseID: caseId,
      CcdIndex: idx + 1,
      Description: ccd.Description || '',
      FovLengthMm: ccd.FovLengthMm || '',
      FovWidthMm: ccd.FovWidthMm || '',
      WdMm: ccd.WdMm || '',
      AccuracyUm: ccd.AccuracyUm || '',
      FlyingSpeedMmS: ccd.FlyingSpeedMmS || '',
      InspectionSpeedPs: ccd.InspectionSpeedPs || '',
      LightingNote: ccd.LightingNote || '',
    });
  });
}

/** 取得某案件的所有 CCD 需求，依 CcdIndex 排序。 */
function getCcdRequirementsForCase(caseId) {
  var data = sheetToObjects(SHEET_CCD_REQUIREMENTS);
  return data.rows
    .filter(function (r) {
      return r['CaseID'] === caseId;
    })
    .sort(function (a, b) {
      return Number(a['CcdIndex']) - Number(b['CcdIndex']);
    });
}

// ------------------------------------------------------------
// 人員 (業務/FAE 自動完成建議 + 快速新增，找不到符合的人時前端會跳出小表單新增)
// ------------------------------------------------------------
function handleGetStaff(body) {
  var data = sheetToObjects(SHEET_STAFF);
  var rows = data.rows;
  if (body.role) {
    rows = rows.filter(function (r) {
      return r['Role'] === body.role;
    });
  }
  return { success: true, staff: rows };
}

function handleAddStaff(body) {
  if (!body.name) return { success: false, message: '姓名為必填' };
  appendObjectRow(SHEET_STAFF, { Name: body.name, Role: body.role || '' });
  return { success: true };
}

// ------------------------------------------------------------
// 案件附件 (檢測規章及其他附件)：上傳到 Google 雲端硬碟，連結存在案件的 AttachmentLinksJson 欄位
// ------------------------------------------------------------
function handleUploadCaseAttachment(body) {
  var caseObj = findCase(body.caseId);
  if (!caseObj) return { success: false, message: '查無此案件' };

  var folder = DriveApp.getFolderById(getOrCreateAttachmentsFolderId());
  var bytes = Utilities.base64Decode(body.base64);
  var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.filename || 'attachment');
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // 如果組織政策不允許改分享設定，檔案還是會存在資料夾裡，只是連結可能需要額外權限才能打開
  }

  var attachments = [];
  try {
    attachments = JSON.parse(caseObj['AttachmentLinksJson'] || '[]');
  } catch (e) {
    attachments = [];
  }
  attachments.push({ name: body.filename || file.getName(), url: file.getUrl(), fileId: file.getId() });

  handleUpdateCase({ caseId: body.caseId, fields: { AttachmentLinksJson: JSON.stringify(attachments) } });

  return { success: true, attachments: attachments };
}

/**
 * 評估報告「帶入案件圖片」用：把案件附件中的圖片（依副檔名判斷）讀出來轉 base64 回傳。
 * 單次回傳總量限制約 20MB，超過的圖片列在 skipped，前端會提示。
 */
function handleGetCaseImages(body) {
  var caseObj = findCase(body.caseId);
  if (!caseObj) return { success: false, message: '查無此案件' };

  var attachments = [];
  try {
    attachments = JSON.parse(caseObj['AttachmentLinksJson'] || '[]');
  } catch (e) {
    attachments = [];
  }

  var LIMIT = 20 * 1024 * 1024;
  var total = 0;
  var images = [];
  var skipped = [];
  attachments.forEach(function (a) {
    if (!/\.(jpe?g|png|gif|bmp|webp)$/i.test(a.name || '')) return;
    try {
      var blob = DriveApp.getFileById(a.fileId).getBlob();
      var bytes = blob.getBytes();
      if (total + bytes.length > LIMIT) {
        skipped.push(a.name);
        return;
      }
      total += bytes.length;
      images.push({ name: a.name, fileId: a.fileId, mimeType: blob.getContentType(), base64: Utilities.base64Encode(bytes) });
    } catch (err) {
      skipped.push(a.name);
    }
  });
  return { success: true, images: images, skipped: skipped };
}

function handleDeleteCaseAttachment(body) {
  var caseObj = findCase(body.caseId);
  if (!caseObj) return { success: false, message: '查無此案件' };

  var attachments = [];
  try {
    attachments = JSON.parse(caseObj['AttachmentLinksJson'] || '[]');
  } catch (e) {
    attachments = [];
  }

  var target = attachments.filter(function (a) {
    return a.fileId === body.fileId;
  })[0];
  if (target) {
    try {
      DriveApp.getFileById(target.fileId).setTrashed(true);
    } catch (delErr) {
      // 檔案可能已經被手動刪除，忽略即可
    }
  }

  attachments = attachments.filter(function (a) {
    return a.fileId !== body.fileId;
  });
  handleUpdateCase({ caseId: body.caseId, fields: { AttachmentLinksJson: JSON.stringify(attachments) } });

  return { success: true, attachments: attachments };
}

// ------------------------------------------------------------
// 文件產生：需求單 / 評估單(自動生成版) / 報價單
// 每一種都可以選輸出格式：html（純網頁，免範本，直接組資料）/ pdf / docx（Word，這兩種要用 Google 文件範本轉出）
// 手動撰寫的評估報告是前端用 html2pdf.js 直接轉，不經過這裡。
// ------------------------------------------------------------

/** 把文字裡的 HTML 特殊字元跳脫，避免資料裡剛好有 < > & 之類的字元把版面弄壞。 */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 通用的簡單 HTML 文件外框，body裡放實際內容，方便使用者自己另存/列印轉PDF。 */
function wrapHtmlDocument(title, bodyHtml) {
  return (
    '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>' +
    escapeHtml(title) +
    '</title><style>' +
    'body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;padding:32px;color:#222;}' +
    'h1{font-size:22px;border-bottom:2px solid #2c5aa0;padding-bottom:8px;}' +
    'table{width:100%;border-collapse:collapse;margin:12px 0;}' +
    'th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:14px;}' +
    'th{background:#eef2f7;}' +
    '.section-title{margin-top:24px;font-size:16px;font-weight:bold;}' +
    '</style></head><body>' +
    bodyHtml +
    '</body></html>'
  );
}

function htmlBlobResult(filenamePrefix, title, bodyHtml) {
  var html = wrapHtmlDocument(title, bodyHtml);
  var blob = Utilities.newBlob(html, 'text/html', filenamePrefix + '.html');
  return {
    success: true,
    filename: filenamePrefix + '.html',
    mimeType: 'text/html',
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}

function fillTemplateAndGetBlob(templateId, filenamePrefix, fieldMap, exportMimeType) {
  var copy = DriveApp.getFileById(templateId).makeCopy(filenamePrefix + '_' + new Date().getTime());
  var doc = DocumentApp.openById(copy.getId());
  var body = doc.getBody();
  Object.keys(fieldMap).forEach(function (key) {
    body.replaceText(escapeRegex('{{' + key + '}}'), String(fieldMap[key] == null ? '' : fieldMap[key]));
  });
  doc.saveAndClose();

  var blob = DriveApp.getFileById(copy.getId()).getAs(exportMimeType);
  DriveApp.getFileById(copy.getId()).setTrashed(true);
  return blob;
}

/** format: 'pdf'(預設) 或 'docx'，回傳對應的匯出 MIME type 跟副檔名。 */
function resolveExportFormat(format) {
  if (format === 'docx') {
    return { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' };
  }
  return { mimeType: 'application/pdf', ext: '.pdf' };
}

function handleGenerateRequirementDoc(body) {
  var caseObj = findCase(body.caseId);
  if (!caseObj) return { success: false, message: '查無此案件' };
  var format = body.format || 'pdf';
  var filenamePrefix = '需求單_' + caseObj['CaseID'];

  if (format === 'html') {
    var html =
      '<h1>需求單</h1>' +
      '<table>' +
      '<tr><th>案件編號</th><td>' + escapeHtml(caseObj['CaseID']) + '</td></tr>' +
      '<tr><th>客戶</th><td>' + escapeHtml(caseObj['CustomerName']) + '</td></tr>' +
      '<tr><th>終端客戶</th><td>' + escapeHtml(caseObj['EndCustomerName']) + '</td></tr>' +
      '<tr><th>專案聯絡人</th><td>' + escapeHtml(caseObj['ProjectContact']) + '　' + escapeHtml(caseObj['ContactPhone']) + '</td></tr>' +
      '<tr><th>業務</th><td>' + escapeHtml(caseObj['Salesperson']) + '</td></tr>' +
      '<tr><th>FAE</th><td>' + escapeHtml(caseObj['FAE']) + '</td></tr>' +
      '<tr><th>產品應用</th><td>' + escapeHtml(caseObj['ProductApplication']) + '</td></tr>' +
      '<tr><th>待測物件</th><td>' + escapeHtml(caseObj['TestObject']) + '</td></tr>' +
      '<tr><th>使用軟體</th><td>' + escapeHtml(caseObj['SoftwareName']) + '</td></tr>' +
      '<tr><th>日期</th><td>' + Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd') + '</td></tr>' +
      '</table>' +
      '<div class="section-title">需求細節</div><p>' + escapeHtml(caseObj['RequirementDetails']).replace(/\n/g, '<br>') + '</p>' +
      buildCcdHtmlSection(getCcdRequirementsForCase(caseObj['CaseID']));
    return htmlBlobResult(filenamePrefix, filenamePrefix, html);
  }

  var templateId = getConfig('TemplateDocId_Requirement');
  if (!templateId) return { success: false, message: '尚未設定需求單範本 (Config: TemplateDocId_Requirement)' };

  var exportFormat = resolveExportFormat(format);
  var blob = fillTemplateAndGetBlob(
    templateId,
    filenamePrefix,
    {
      CaseID: caseObj['CaseID'],
      CustomerName: caseObj['CustomerName'],
      Salesperson: caseObj['Salesperson'],
      FAE: caseObj['FAE'],
      RequirementDetails: caseObj['RequirementDetails'],
      Date: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
    },
    exportFormat.mimeType
  );

  return {
    success: true,
    filename: filenamePrefix + exportFormat.ext,
    mimeType: exportFormat.mimeType,
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}

/** 把 CCD 檢測需求陣列轉成一段 HTML（給需求單/評估單 HTML 輸出共用）。ccdList 直接傳 getCcdRequirementsForCase() 的結果。 */
function buildCcdHtmlSection(ccdList) {
  ccdList = ccdList || [];
  if (!ccdList.length) return '';

  var html = '<div class="section-title">檢測需求</div>';
  ccdList.forEach(function (ccd, idx) {
    html +=
      '<table><tr><th colspan="2">CCD ' + (idx + 1) + '</th></tr>' +
      '<tr><th>檢測需求說明</th><td>' + escapeHtml(ccd.Description) + '</td></tr>' +
      '<tr><th>FOV長(mm)</th><td>' + escapeHtml(ccd.FovLengthMm) + '</td></tr>' +
      '<tr><th>FOV寬(mm)</th><td>' + escapeHtml(ccd.FovWidthMm) + '</td></tr>' +
      '<tr><th>WD(mm)</th><td>' + escapeHtml(ccd.WdMm) + '</td></tr>' +
      '<tr><th>要求檢測精度(µm)</th><td>' + escapeHtml(ccd.AccuracyUm) + '</td></tr>' +
      '<tr><th>飛拍速度(mm/s)</th><td>' + escapeHtml(ccd.FlyingSpeedMmS) + '</td></tr>' +
      '<tr><th>檢測速度(p/s)</th><td>' + escapeHtml(ccd.InspectionSpeedPs) + '</td></tr>' +
      '<tr><th>打光限制說明</th><td>' + escapeHtml(ccd.LightingNote) + '</td></tr>' +
      '</table>';
  });
  return html;
}

function handleGenerateEvaluationDoc(body) {
  var caseObj = findCase(body.caseId);
  if (!caseObj) return { success: false, message: '查無此案件' };

  var ev = body.evaluationData || {};
  var format = body.format || 'docx';
  var filenamePrefix = '評估單_' + caseObj['CaseID'];

  handleUpdateCase({
    caseId: body.caseId,
    fields: {
      EvaluationResult: ev.TestResult || caseObj['EvaluationResult'],
      Status: '評估單已發出',
    },
  });

  if (format === 'html') {
    var html =
      '<h1>評估單</h1>' +
      '<table>' +
      '<tr><th>案件編號</th><td>' + escapeHtml(caseObj['CaseID']) + '</td></tr>' +
      '<tr><th>客戶</th><td>' + escapeHtml(caseObj['CustomerName']) + '</td></tr>' +
      '<tr><th>FAE</th><td>' + escapeHtml(caseObj['FAE']) + '</td></tr>' +
      '<tr><th>測試人員</th><td>' + escapeHtml(ev.Tester) + '</td></tr>' +
      '<tr><th>建議搭配產品</th><td>' + escapeHtml(ev.RecommendedProduct) + '</td></tr>' +
      '<tr><th>測試日期</th><td>' + escapeHtml(ev.TestDate || Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd')) + '</td></tr>' +
      '</table>' +
      '<div class="section-title">測試結果/評估結論</div><p>' + escapeHtml(ev.TestResult).replace(/\n/g, '<br>') + '</p>' +
      '<div class="section-title">備註</div><p>' + escapeHtml(ev.Notes).replace(/\n/g, '<br>') + '</p>';
    return htmlBlobResult(filenamePrefix, filenamePrefix, html);
  }

  var templateId = getConfig('TemplateDocId_Evaluation');
  if (!templateId) return { success: false, message: '尚未設定評估單範本 (Config: TemplateDocId_Evaluation)' };

  var exportFormat = resolveExportFormat(format === 'html' ? 'docx' : format || 'docx');
  var blob = fillTemplateAndGetBlob(
    templateId,
    filenamePrefix,
    {
      CaseID: caseObj['CaseID'],
      CustomerName: caseObj['CustomerName'],
      FAE: caseObj['FAE'],
      TestResult: ev.TestResult || '',
      RecommendedProduct: ev.RecommendedProduct || '',
      Tester: ev.Tester || '',
      TestDate: ev.TestDate || Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
      Notes: ev.Notes || '',
    },
    exportFormat.mimeType
  );

  return {
    success: true,
    filename: filenamePrefix + exportFormat.ext,
    mimeType: exportFormat.mimeType,
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}

function handleGenerateQuoteDoc(body) {
  var format = body.format || 'pdf';
  var filenamePrefix = '報價單_' + (body.customerName || 'quote');

  if (format === 'html') {
    var rowsHtml = (body.items || [])
      .map(function (item) {
        return (
          '<tr><td>' + escapeHtml(item.name) + '</td><td>' + escapeHtml(item.basePrice) + '</td><td>' + escapeHtml(item.listPrice) +
          '</td><td>' + escapeHtml(item.unitPrice) + '</td><td>' + escapeHtml(item.quantity) + '</td><td>' + escapeHtml(item.subtotal) + '</td></tr>'
        );
      })
      .join('');

    var html =
      '<h1>報價單</h1>' +
      '<table>' +
      '<tr><th>客戶</th><td>' + escapeHtml(body.customerName) + '</td></tr>' +
      '<tr><th>客戶類型</th><td>' + escapeHtml(body.quoteType) + '</td></tr>' +
      '<tr><th>日期</th><td>' + Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd') + '</td></tr>' +
      '</table>' +
      '<table><tr><th>品名</th><th>底價</th><th>牌價</th><th>報價</th><th>數量</th><th>小計</th></tr>' +
      rowsHtml +
      '</table>' +
      '<p style="text-align:right;font-size:16px;font-weight:bold;">總計：' + escapeHtml(body.total) + '</p>';
    return htmlBlobResult(filenamePrefix, filenamePrefix, html);
  }

  var templateId = getConfig('TemplateDocId_Quote');
  if (!templateId) return { success: false, message: '尚未設定報價單範本 (Config: TemplateDocId_Quote)' };

  var copy = DriveApp.getFileById(templateId).makeCopy(filenamePrefix + '_' + new Date().getTime());
  var doc = DocumentApp.openById(copy.getId());
  var docBody = doc.getBody();

  docBody.replaceText(escapeRegex('{{CustomerName}}'), body.customerName || '');
  docBody.replaceText(escapeRegex('{{QuoteDate}}'), Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'));
  docBody.replaceText(escapeRegex('{{QuoteType}}'), body.quoteType || '');
  docBody.replaceText(escapeRegex('{{Total}}'), String(body.total || 0));

  var tables = docBody.getTables();
  if (tables.length > 0) {
    var table = tables[0];
    var templateRow = table.getRow(table.getNumRows() - 1);
    (body.items || []).forEach(function (item) {
      var newRow = table.appendTableRow(templateRow.copy());
      newRow.getCell(0).setText(item.name || '');
      newRow.getCell(1).setText(String(item.quantity || ''));
      newRow.getCell(2).setText(String(item.unitPrice || ''));
      newRow.getCell(3).setText(String(item.subtotal || ''));
    });
    table.removeRow(table.getChildIndex(templateRow));
  }

  doc.saveAndClose();
  var exportFormat = resolveExportFormat(format);
  var outBlob = DriveApp.getFileById(copy.getId()).getAs(exportFormat.mimeType);
  var base64 = Utilities.base64Encode(outBlob.getBytes());
  DriveApp.getFileById(copy.getId()).setTrashed(true);

  return {
    success: true,
    filename: filenamePrefix + exportFormat.ext,
    mimeType: exportFormat.mimeType,
    base64: base64,
  };
}

// ------------------------------------------------------------
// 客戶管理 (含分類/急迫性) + 行事曆同步
// ------------------------------------------------------------
function handleGetCustomers(body) {
  var sheet = getSheet(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, customers: [] };
  var header = data[0];
  var customers = data.slice(1).map(function (r, i) {
    var obj = rowToObject(header, r);
    obj.RowIndex = i + 2;
    return obj;
  });
  return { success: true, customers: customers };
}

function syncCustomerFollowUpToCalendar(rowNum, header, sheet, customer) {
  if (!customer['NextFollowUpDate']) return;

  try {
    var calendar = CalendarApp.getDefaultCalendar();
    var title = '[AOI客戶追蹤] ' + customer['CompanyName'] + (customer['Contact'] ? '（' + customer['Contact'] + '）' : '');
    var date = new Date(customer['NextFollowUpDate']);
    var eventIdCol = header.indexOf('CalendarEventId');
    var existingId = eventIdCol > -1 ? customer['CalendarEventId'] : '';

    if (existingId) {
      var existingEvent = calendar.getEventById(existingId);
      if (existingEvent) {
        existingEvent.setTitle(title);
        existingEvent.setAllDayDate(date);
        return;
      }
    }

    var newEvent = calendar.createAllDayEvent(title, date);
    if (eventIdCol > -1) {
      sheet.getRange(rowNum, eventIdCol + 1).setValue(newEvent.getId());
    }
  } catch (calErr) {
    Logger.log('日曆同步失敗: ' + calErr.message);
  }
}

function handleAddCustomer(body) {
  var sheet = getSheet(SHEET_CUSTOMERS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var customer = {
    CompanyName: body.companyName || '',
    Contact: body.contact || '',
    Phone: body.phone || '',
    Email: body.email || '',
    NextFollowUpDate: body.nextFollowUpDate || '',
    Category: body.category || '',
    Urgency: body.urgency || '',
    Notes: body.notes || '',
  };

  appendObjectRow(SHEET_CUSTOMERS, customer);
  var rowNum = sheet.getLastRow();
  syncCustomerFollowUpToCalendar(rowNum, header, sheet, customer);

  return { success: true };
}

function handleUpdateCustomer(body) {
  var rowNum = body.rowIndex;
  if (!rowNum) return { success: false, message: '缺少 rowIndex' };

  var header = updateRowFields(SHEET_CUSTOMERS, rowNum, body.fields);
  var customer = readRowAsObject(SHEET_CUSTOMERS, rowNum);
  syncCustomerFollowUpToCalendar(rowNum, header, getSheet(SHEET_CUSTOMERS), customer);

  return { success: true };
}

function handleDeleteCustomer(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_CUSTOMERS).deleteRow(body.rowIndex);
  return { success: true };
}

// ------------------------------------------------------------
// 客戶聯繫紀錄 (日報的資料來源)
// ------------------------------------------------------------
function handleAddContactLog(body) {
  appendObjectRow(SHEET_CONTACT_LOGS, {
    Date: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'),
    CompanyName: body.companyName || '',
    Contact: body.contact || '',
    Method: body.method || '',
    Summary: body.summary || '',
    Salesperson: body.salesperson || '',
  });
  return { success: true };
}

function handleGetContactLogs(body) {
  var data = sheetToObjects(SHEET_CONTACT_LOGS);
  var rows = data.rows;
  if (body.date) {
    rows = rows.filter(function (r) {
      return r['Date'] === body.date;
    });
  }
  rows.sort(function (a, b) {
    return new Date(b['Date']) - new Date(a['Date']);
  });
  return { success: true, logs: rows };
}

function handleDeleteContactLog(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_CONTACT_LOGS).deleteRow(body.rowIndex);
  return { success: true };
}

// ------------------------------------------------------------
// 日報：以當日的「客戶聯繫紀錄」為主，加上今日案件動態、今日應追蹤客戶，
// 並支援前端傳入的「手動補充說明」一起放進信件內容。
// ------------------------------------------------------------

/** 組出日報文字內容(共用給自動排程跟手動送出用)。 */
function buildDailyReportText(manualNotes) {
  var today = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd');

  var contactLogs = sheetToObjects(SHEET_CONTACT_LOGS).rows.filter(function (r) {
    return r['Date'] === today;
  });
  var cases = sheetToObjects(SHEET_CASES).rows.filter(function (r) {
    return r['LastUpdated'] === today || r['CreatedDate'] === today;
  });
  var followUps = sheetToObjects(SHEET_CUSTOMERS).rows.filter(function (r) {
    return r['NextFollowUpDate'] === today;
  });

  var lines = [];
  lines.push('AOI 業務日報 - ' + today);
  lines.push('');
  lines.push('【今日客戶聯繫紀錄】(' + contactLogs.length + ' 筆)');
  contactLogs.forEach(function (c) {
    lines.push('- ' + c['CompanyName'] + '（' + c['Contact'] + '）｜方式:' + c['Method'] + '｜' + c['Summary']);
  });
  lines.push('');
  lines.push('【今日更新/新增案件】(' + cases.length + ' 筆)');
  cases.forEach(function (c) {
    lines.push('- ' + c['CaseID'] + ' | ' + c['CustomerName'] + ' | 狀態: ' + c['Status']);
  });
  lines.push('');
  lines.push('【今日應追蹤客戶】(' + followUps.length + ' 筆)');
  followUps.forEach(function (c) {
    lines.push('- ' + c['CompanyName'] + '（' + c['Contact'] + '）');
  });

  if (manualNotes) {
    lines.push('');
    lines.push('【手動補充說明】');
    lines.push(manualNotes);
  }

  return { text: lines.join('\n'), today: today, contactLogs: contactLogs, cases: cases, followUps: followUps };
}

/** 給前端「產生今日日報預覽」用，只組資料不寄信。 */
function handleGetDailyReportData(body) {
  var data = buildDailyReportText(body.manualNotes || '');
  return { success: true, text: data.text, contactLogs: data.contactLogs, cases: data.cases, followUps: data.followUps };
}

/** 排程觸發用：時間驅動的觸發條件要指定這個函式。不含手動補充說明(排程沒有人手動輸入)。 */
function sendDailyReport() {
  var reportEmail = getConfig('ReportEmail');
  if (!reportEmail) return;
  var data = buildDailyReportText('');
  GmailApp.sendEmail(reportEmail, 'AOI 業務日報 - ' + data.today, data.text);
}

/** 前端「確認寄送日報」按鈕用，會把手動補充說明一起帶進信件內容。 */
function handleSendDailyReportNow(body) {
  var reportEmail = getConfig('ReportEmail');
  if (!reportEmail) return { success: false, message: '尚未在 Config 分頁設定 ReportEmail' };
  var data = buildDailyReportText(body.manualNotes || '');
  GmailApp.sendEmail(reportEmail, 'AOI 業務日報 - ' + data.today, data.text);
  return { success: true, message: '已寄出日報到 ' + reportEmail };
}
