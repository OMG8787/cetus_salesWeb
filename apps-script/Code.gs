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
 *   ★ 初始化 setup()：新環境「貼上程式 → 執行 setup → 部署」即可，會自動建立所有分頁、欄位、
 *      預設設定、附件資料夾、管理員帳號與自動喚醒排程（可重複執行，不會刪資料）
 *   4. 共用小工具 (讀寫試算表、雜湊、驗證登入、通用的依欄位更新/刪除列...)
 *   5. 各功能模組：
 *      產品(含CRUD) / 價格紀錄(含CRUD) / 詢價信 /
 *      案件(含查詢修改刪除) / 文件產生(需求單・評估單・報價單) /
 *      客戶(含分類/急迫性+行事曆) / 客戶聯繫紀錄 / 日報
 *
 * 試算表分頁與欄位(詳見 README.md)：
 *   Products      - InternalModel, SupplierModel, Supplier, SupplierContact,
 *                    SupplierContactEmail, Origin, Category, CompatibleGroup, RefPrice, Notes, LastUpdated
 *                    （LastUpdated=上次修改日期，前端用來提醒資料多久沒更新、要不要重新詢價）
 *   PriceHistory  - Date, ProductInternalModel, Supplier, Price, Currency, CaseID, Notes
 *   Cases         - CaseID, CustomerName, EndCustomerName, ProjectContact, ContactPhone,
 *                    Salesperson, FAE, ProductApplication, TestObject, SoftwareName,
 *                    SoftwareCustomization, SoftwareCustomizationNote, Status, CreatedDate,
 *                    RequirementDetails, AttachmentLinksJson,
 *                    EvaluationResult, EvaluationReportHtml, LastUpdated
 *   CCDRequirements - CaseID, CcdIndex, Description, FovLengthMm, FovWidthMm, WdMm,
 *                    AccuracyUm, FlyingSpeedMmS, InspectionSpeedPs, LightingNote
 *                    （一個案件可能對應多列，用 CaseID 關聯）
 *   CaseCompanies - CaseID, CompanyName, Role（一個案件可能牽涉多間公司，例如設備商+終端客戶+其他協力廠，
 *                    用 CaseID 關聯；CustomerName 欄位仍是這個案件的「主要客戶」，這裡是額外的相關公司）
 *   Staff         - Name, Role（業務/FAE 自動完成 + 快速新增用）
 *   Customers     - CompanyName, Contact, Phone, Email, NextFollowUpDate, Category,
 *                    Urgency, Notes, CalendarEventId, HasTransacted, LastTransactionDate
 *                    （Contact/Phone/Email 是主要聯絡人，多個聯絡窗口/電話/信箱存在 CustomerContacts；
 *                    Category 固定四選一：AOI同業資料／器材原廠／機構合作設備商／一般客戶）
 *   CustomerContacts - CompanyName, ContactName, Phone, Email, Title, Notes
 *                    （一間公司可能對應多列，用 CompanyName 關聯，管理多個聯絡窗口）
 *   ContactLogs   - Date, CompanyName, Contact, Method, Summary, Salesperson, CaseID
 *                    （CaseID 選填，標記這筆聯繫是針對哪個案件/專案，同客戶有多案件時用來分開查）
 *   Users         - Username, PasswordHash, Role, DisplayName
 *                    （Role 決定權限，見 PERMISSIONS：admin 可以做任何事／sales 業務／fae 工程）
 *   Config        - Key, Value
 *   Devices       - DeviceId, Username, DeviceLabel, TokenHash, CreatedDate, LastSeenDate
 *                    （「記住這台裝置」用，讓網頁關掉重開不用重新輸入密碼；管理員在「裝置管理」頁可以移除）
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
var SHEET_DEVICES = 'Devices';
var SHEET_CUSTOMER_CONTACTS = 'CustomerContacts';
var SHEET_CASE_COMPANIES = 'CaseCompanies';

// ------------------------------------------------------------
// 2. 路由表
// ------------------------------------------------------------
// 之後要新增一個 API 動作：
//   1) 寫 function handleXxx(body) { ... }
//   2) 在下面加一行： xxx: { auth: true, fn: handleXxx },
var ROUTES = {
  login:                   { auth: false, fn: handleLogin },
  resumeSession:           { auth: false, fn: handleResumeSession },
  logoutDevice:            { auth: true,  fn: handleLogoutDevice },
  getDevices:              { auth: true,  fn: handleGetDevices },
  removeDevice:            { auth: true,  fn: handleRemoveDevice },

  // 產品(產品搜尋表)
  searchProducts:          { auth: true, fn: handleSearchProducts },
  getProduct:              { auth: true, fn: handleGetProduct },
  addProduct:              { auth: true, fn: handleAddProduct },
  updateProduct:           { auth: true, fn: handleUpdateProduct },
  deleteProduct:           { auth: true, fn: handleDeleteProduct },
  importCatalogProducts:   { auth: true, fn: handleImportCatalogProducts },

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

  // 人員（業務/FAE 快速新增+自動完成用，含完整 CRUD）
  getStaff:                { auth: true, fn: handleGetStaff },
  addStaff:                { auth: true, fn: handleAddStaff },
  updateStaff:             { auth: true, fn: handleUpdateStaff },
  deleteStaff:             { auth: true, fn: handleDeleteStaff },

  // 帳號管理（僅 admin，見 PERMISSIONS）
  getUsers:                { auth: true, fn: handleGetUsers },
  addUser:                 { auth: true, fn: handleAddUser },
  updateUser:              { auth: true, fn: handleUpdateUser },
  deleteUser:              { auth: true, fn: handleDeleteUser },
  resetUserPassword:       { auth: true, fn: handleResetUserPassword },

  // 文件產生（每種都支援 format: 'html' / 'pdf' / 'docx'）
  generateRequirementDoc:  { auth: true, fn: handleGenerateRequirementDoc },
  generateEvaluationDoc:   { auth: true, fn: handleGenerateEvaluationDoc },
  generateQuoteDoc:        { auth: true, fn: handleGenerateQuoteDoc },

  // 客戶 + 行事曆
  getCustomers:            { auth: true, fn: handleGetCustomers },
  addCustomer:             { auth: true, fn: handleAddCustomer },
  updateCustomer:          { auth: true, fn: handleUpdateCustomer },
  deleteCustomer:          { auth: true, fn: handleDeleteCustomer },

  // 客戶聯絡人（一間公司可以有多個聯絡窗口/電話/信箱）
  getCustomerContacts:     { auth: true, fn: handleGetCustomerContacts },
  addCustomerContact:      { auth: true, fn: handleAddCustomerContact },
  updateCustomerContact:   { auth: true, fn: handleUpdateCustomerContact },
  deleteCustomerContact:   { auth: true, fn: handleDeleteCustomerContact },

  // 客戶聯繫紀錄
  addContactLog:           { auth: true, fn: handleAddContactLog },
  getContactLogs:          { auth: true, fn: handleGetContactLogs },
  updateContactLog:        { auth: true, fn: handleUpdateContactLog },
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
      if (route.auth) {
        body._user = requireAuth(body); // handler 需要知道是誰在操作時用 body._user
        requirePermission_(body.action, body._user); // 依目前(即時查詢)的角色檢查這個動作能不能做
      }
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
// 初始化：新環境只要「貼上程式 → 執行 setup → 部署」
// ------------------------------------------------------------

/**
 * 每個分頁的欄位（第一列標題）。setup() 會照這份建立分頁；
 * 已經存在的分頁只會把缺少的欄位補在最後面，不會動到原本的資料與欄位順序。
 * 之後要加新欄位，改這裡再重新執行一次 setup 就好。
 */
var SCHEMA = {};
SCHEMA[SHEET_PRODUCTS] = ['InternalModel', 'SupplierModel', 'Supplier', 'SupplierContact', 'SupplierContactEmail', 'Origin', 'Category', 'CompatibleGroup', 'RefPrice', 'Notes', 'LastUpdated'];
SCHEMA[SHEET_PRICE_HISTORY] = ['Date', 'ProductInternalModel', 'Supplier', 'Price', 'Currency', 'CaseID', 'Notes'];
SCHEMA[SHEET_CASES] = ['CaseID', 'CustomerName', 'EndCustomerName', 'ProjectContact', 'ContactPhone', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'SoftwareName', 'SoftwareCustomization', 'SoftwareCustomizationNote', 'Status', 'CreatedDate', 'RequirementDetails', 'AttachmentLinksJson', 'EvaluationResult', 'EvaluationReportHtml', 'LastUpdated'];
SCHEMA[SHEET_CCD_REQUIREMENTS] = ['CaseID', 'CcdIndex', 'Description', 'FovLengthMm', 'FovWidthMm', 'WdMm', 'AccuracyUm', 'FlyingSpeedMmS', 'InspectionSpeedPs', 'LightingNote'];
SCHEMA[SHEET_STAFF] = ['Name', 'Role'];
SCHEMA[SHEET_CUSTOMERS] = ['CompanyName', 'Contact', 'Phone', 'Email', 'NextFollowUpDate', 'Category', 'Urgency', 'Notes', 'CalendarEventId', 'HasTransacted', 'LastTransactionDate'];
SCHEMA[SHEET_CONTACT_LOGS] = ['Date', 'CompanyName', 'Contact', 'Method', 'Summary', 'Salesperson', 'CaseID'];
SCHEMA[SHEET_CUSTOMER_CONTACTS] = ['CompanyName', 'ContactName', 'Phone', 'Email', 'Title', 'Notes'];
SCHEMA[SHEET_CASE_COMPANIES] = ['CaseID', 'CompanyName', 'Role'];
SCHEMA[SHEET_USERS] = ['Username', 'PasswordHash', 'Role', 'DisplayName'];
/** 公司分類固定選項（客戶管理頁下拉選單用，"AOI同業資料" 目前沒有既有資料，先開放選項給之後手動建立）。 */
var CUSTOMER_CATEGORIES = ['AOI同業資料', '器材原廠', '機構合作設備商', '一般客戶'];
/** 帳號角色：admin(管理員，全部功能) / sales(業務) / fae(工程/FAE)。 */
var ROLES = ['admin', 'sales', 'fae'];
SCHEMA[SHEET_CONFIG] = ['Key', 'Value'];
SCHEMA[SHEET_DEVICES] = ['DeviceId', 'Username', 'DeviceLabel', 'TokenHash', 'CreatedDate', 'LastSeenDate'];

/**
 * 這些欄位強制設成「純文字」，避免試算表自動轉型：
 * 電話 0912… 會掉開頭的 0、精度 "-2"（只能少）會變成負數、帳號 0001 會變成 1。
 */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET_CASES] = ['ContactPhone', 'CaseID'];
TEXT_COLUMNS[SHEET_CCD_REQUIREMENTS] = ['CaseID', 'AccuracyUm'];
TEXT_COLUMNS[SHEET_CONTACT_LOGS] = ['CaseID'];
TEXT_COLUMNS[SHEET_CASE_COMPANIES] = ['CaseID'];
TEXT_COLUMNS[SHEET_CUSTOMERS] = ['Phone'];
TEXT_COLUMNS[SHEET_USERS] = ['Username', 'PasswordHash'];
TEXT_COLUMNS[SHEET_DEVICES] = ['DeviceId', 'Username', 'TokenHash'];
TEXT_COLUMNS[SHEET_PRICE_HISTORY] = ['ProductInternalModel', 'CaseID'];
TEXT_COLUMNS[SHEET_PRODUCTS] = ['InternalModel', 'SupplierModel'];

/** Config 分頁預設要有的設定（值留空，之後自己填）。 */
var CONFIG_KEYS = [
  ['TemplateDocId_Requirement', '需求單 Google 文件範本 ID（選填，只用 HTML 格式可不填）'],
  ['TemplateDocId_Evaluation', '評估單 Google 文件範本 ID（選填）'],
  ['TemplateDocId_Quote', '報價單 Google 文件範本 ID（選填）'],
  ['ReportEmail', '日報收件信箱（選填，多個用逗號分隔）'],
];

var WARM_TRIGGER_MINUTES = 10;

/**
 * 權限矩陣：action(=ROUTES的key) -> 允許操作的角色陣列。
 * 沒有在這裡列出的動作 = 只要有登入(任何角色)就能用，避免漏列導致功能被意外鎖住。
 * 只把「刪除/管理帳號裝置/管理人員清單」這類明確該限制的動作列進來。
 * 之後要調整某個功能給誰用，改這裡就好，不用改 doPost。
 */
var PERMISSIONS = {};
PERMISSIONS['getUsers'] = ['admin'];
PERMISSIONS['addUser'] = ['admin'];
PERMISSIONS['updateUser'] = ['admin'];
PERMISSIONS['deleteUser'] = ['admin'];
PERMISSIONS['resetUserPassword'] = ['admin'];
PERMISSIONS['getDevices'] = ['admin'];
PERMISSIONS['removeDevice'] = ['admin'];
PERMISSIONS['addStaff'] = ['admin'];
PERMISSIONS['updateStaff'] = ['admin'];
PERMISSIONS['deleteStaff'] = ['admin'];
PERMISSIONS['deleteProduct'] = ['admin', 'sales'];
PERMISSIONS['importCatalogProducts'] = ['admin', 'sales'];
PERMISSIONS['deleteCustomer'] = ['admin', 'sales'];
PERMISSIONS['deleteCase'] = ['admin', 'sales'];
PERMISSIONS['deletePriceRecord'] = ['admin', 'sales'];
PERMISSIONS['deleteContactLog'] = ['admin', 'sales'];
PERMISSIONS['deleteCustomerContact'] = ['admin', 'sales'];
PERMISSIONS['deleteCaseAttachment'] = ['admin', 'sales'];

/** 檢查目前使用者能不能做這個動作：即時查 Users 分頁目前的 Role（不是登入當下快取的），改權限馬上生效。 */
function requirePermission_(action, user) {
  var allowedRoles = PERMISSIONS[action];
  if (!allowedRoles) return; // 沒特別限制 = 任何已登入帳號都能用
  var dbUser = findUserRow_(user.username);
  var role = (dbUser && dbUser['Role']) || '';
  if (allowedRoles.indexOf(role) === -1) {
    throw new Error('權限不足，「' + action + '」需要 ' + allowedRoles.join(' 或 ') + ' 身份才能操作');
  }
}

// ------------------------------------------------------------
// 舊資料匯入（data.xlsx）：業務手上舊的 Excel 聯繫紀錄整理進客戶資料表用。
// IMPORT_CUSTOMERS_DATA 是離線用 openpyxl 解析 data.xlsx 產生的結果（55 間公司），
// 放在 ImportData.gs，setup() 一次到位，不用另外上傳檔案。
// importLegacyCustomers_() 是「補洞式」匯入：只新增 Customers 裡還沒有的公司名稱，
// 已存在的公司完全不動，所以可以放心重複執行 setup 不會產生重複資料或覆蓋掉之後手動編輯的內容。
// ------------------------------------------------------------
// IMPORT_CUSTOMERS_DATA 定義在另一個檔案 ImportData.gs（含客戶個資，不放進公開的 GitHub，只在本機保存）。
// Apps Script 專案裡的多個 .gs 檔案共用同一個全域範圍，把 ImportData.gs 也貼進去就會被讀到；沒貼的話會略過匯入。

/** 把 IMPORT_CUSTOMERS_DATA 寫進 Customers（+ 附加聯絡人寫進 CustomerContacts），只補缺的公司，不覆蓋既有資料。 */
function importLegacyCustomers_(log) {
  if (typeof IMPORT_CUSTOMERS_DATA === 'undefined' || !IMPORT_CUSTOMERS_DATA.length) return;

  var existing = {};
  sheetToObjects(SHEET_CUSTOMERS).rows.forEach(function (r) {
    existing[r['CompanyName']] = true;
  });

  var added = 0;
  IMPORT_CUSTOMERS_DATA.forEach(function (c) {
    if (!c.CompanyName || existing[c.CompanyName]) return;
    appendObjectRow(SHEET_CUSTOMERS, {
      CompanyName: c.CompanyName,
      Contact: c.Contact || '',
      Phone: c.Phone || '',
      Email: c.Email || '',
      NextFollowUpDate: '',
      Category: c.Category || '一般客戶',
      Urgency: '中',
      Notes: c.Notes || '',
      CalendarEventId: '',
      HasTransacted: '',
      LastTransactionDate: '',
    });
    existing[c.CompanyName] = true;
    added++;
    (c.ExtraContacts || []).forEach(function (ec) {
      if (!ec.name) return;
      appendObjectRow(SHEET_CUSTOMER_CONTACTS, {
        CompanyName: c.CompanyName,
        ContactName: ec.name,
        Phone: ec.phone || '',
        Email: ec.email || '',
        Title: '',
        Notes: '（從 data.xlsx 匯入的其他聯絡窗口）',
      });
    });
  });

  if (added && log) log.push('匯入舊資料：新增 ' + added + ' 間客戶公司資料（來源 data.xlsx，已存在的公司名稱不會重複匯入）');
}

/**
 * 【新環境第一次使用】在 Apps Script 編輯器上方選「setup」→ 按「執行」。
 * 第一次會跳出授權視窗，全部同意即可。可以重複執行，不會刪資料，只會補缺的東西。
 * 完成後看下方「執行紀錄」，會列出做了什麼，以及第一次建立的管理員帳號密碼。
 */
function setup() {
  var log = [];
  var ss = getDb_(true, log);

  Object.keys(SCHEMA).forEach(function (name) {
    ensureSheet_(ss, name, SCHEMA[name], TEXT_COLUMNS[name] || [], log);
  });

  importLegacyCustomers_(log);
  try {
    importCatalogProducts_(log);
  } catch (e) {
    log.push('型錄匯入失敗（可以之後在「產品搜尋」頁按「匯入型錄產品」重試）：' + e.message);
  }

  // 試算表新建時附的空白「工作表1 / Sheet1」，沒有資料就刪掉
  ['工作表1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) {
      ss.deleteSheet(s);
      log.push('移除空白分頁「' + n + '」');
    }
  });

  CONFIG_KEYS.forEach(function (kv) {
    if (getConfig(kv[0]) === null) {
      getSheet(SHEET_CONFIG).appendRow([kv[0], '']);
      log.push('Config 新增設定「' + kv[0] + '」：' + kv[1]);
    }
  });

  var folderId = getOrCreateAttachmentsFolderId();
  log.push('案件附件資料夾：https://drive.google.com/drive/folders/' + folderId);

  var usersSheet = getSheet(SHEET_USERS);
  if (usersSheet.getLastRow() < 2) {
    var password = randomPassword_(10);
    appendObjectRow(SHEET_USERS, { Username: 'admin', PasswordHash: sha256(password), Role: 'admin', DisplayName: '管理員' });
    log.push('★ 已建立管理員帳號 ── 帳號：admin　密碼：' + password + '（請記下來，登入後可到 Users 分頁新增其他人）');
  }

  installWarmTrigger_();
  log.push('已設定每 ' + WARM_TRIGGER_MINUTES + ' 分鐘自動喚醒一次（keepWarm），減少第一次操作的等待時間');

  log.push('資料庫試算表：' + ss.getUrl());
  log.push('✔ 初始化完成。下一步：右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」→ 存取權選「所有人」→ 部署，把網址貼到前端 config.js 的 API_URL');
  log.forEach(function (line) {
    Logger.log(line);
  });
  return log.join('\n');
}

/** 定時觸發用：碰一下試算表跟快取，讓 Apps Script 保持「熱」的狀態，網頁操作比較不會卡好幾秒。 */
function keepWarm() {
  getDb_(false).getSheets().length;
  CacheService.getScriptCache().get('warm');
}

/** 綁在試算表時，打開試算表會多一個「AOI 系統」選單，可以直接在試算表裡執行初始化。 */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('AOI 系統').addItem('初始化 / 檢查分頁（setup）', 'setup').addToUi();
  } catch (e) {
    // 不是從試算表開啟（例如獨立的 Apps Script 專案）就略過
  }
}

/**
 * 取得資料庫試算表：
 *   - 程式綁在試算表上（從試算表「擴充功能 → Apps Script」建立）→ 用那份試算表
 *   - 獨立的 Apps Script 專案 → 用 setup 建立的試算表（ID 存在指令碼屬性 SPREADSHEET_ID）
 * createIfMissing = true 時（setup 用），找不到就自動新建一份。
 */
function getDb_(createIfMissing, log) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      if (!createIfMissing) throw new Error('資料庫試算表打不開（可能被刪除或沒有權限），請重新執行 setup');
    }
  }
  if (!createIfMissing) throw new Error('找不到資料庫試算表，請先在 Apps Script 編輯器執行 setup');
  var created = SpreadsheetApp.create('AOI系統資料庫');
  props.setProperty('SPREADSHEET_ID', created.getId());
  if (log) log.push('已建立新的資料庫試算表「AOI系統資料庫」');
  return created;
}

/** 建立分頁或補齊欄位，並把標題列加粗、凍結、指定純文字欄位。 */
function ensureSheet_(ss, name, columns, textColumns, log) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    log.push('建立分頁「' + name + '」');
  }
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var missing = columns.filter(function (c) {
    return header.indexOf(c) === -1;
  });
  if (missing.length) {
    // 標題列全空（新分頁）就從第 1 欄開始寫，否則接在最後一欄後面
    var startCol = header.join('') === '' ? 1 : lastCol + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    if (header.join('') !== '') log.push('分頁「' + name + '」補上欄位：' + missing.join('、'));
    header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  }

  var headerRange = sheet.getRange(1, 1, 1, header.length);
  headerRange.setFontWeight('bold').setBackground('#eef2f7');
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);

  var dataRows = sheet.getMaxRows() - 1;
  textColumns.forEach(function (c) {
    var idx = header.indexOf(c);
    if (idx > -1 && dataRows > 0) sheet.getRange(2, idx + 1, dataRows, 1).setNumberFormat('@');
  });
  return sheet;
}

function installWarmTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepWarm') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(WARM_TRIGGER_MINUTES).create();
}

/** 產生隨機密碼（用 UUID 的亂數，去掉容易看錯的 0/O、1/l/I）。 */
function randomPassword_(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  var out = '';
  for (var i = 0; i < len; i++) out += chars.charAt((bytes[i] + 256) % chars.length);
  return out;
}

// ------------------------------------------------------------
// 4. 共用小工具
// ------------------------------------------------------------

function getSheet(name) {
  var sheet = getDb_(false).getSheetByName(name);
  if (!sheet) throw new Error('找不到分頁: ' + name + '，請在 Apps Script 編輯器執行一次 setup 自動建立。');
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
/** 發一個 6 小時的一般工作階段 token（帳密登入、裝置自動登入都用這個）。 */
function issueSessionToken_(username, displayName) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('token_' + token, JSON.stringify({ username: username, displayName: displayName }), 21600); // 6 小時
  return token;
}

function findUserRow_(username) {
  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var uCol = header.indexOf('Username');
  for (var i = 1; i < data.length; i++) {
    if (data[i][uCol] === username) return rowToObject(header, data[i]);
  }
  return null;
}

function handleLogin(body) {
  var username = body.username;
  var password = body.password;
  var user = findUserRow_(username);
  if (!user || user['PasswordHash'] !== sha256(password)) {
    return { success: false, message: '帳號或密碼錯誤' };
  }

  var displayName = user['DisplayName'] || username;
  var token = issueSessionToken_(username, displayName);
  var result = { success: true, token: token, username: username, displayName: displayName, role: user['Role'] || '' };

  // 前端有傳裝置 ID 的話（「記住這台裝置」），額外發一組長效裝置權杖，讓下次自動登入不用再打密碼
  if (body.deviceId) {
    result.deviceToken = rememberDevice_(body.deviceId, username, body.deviceLabel);
  }
  return result;
}

/**
 * 記住裝置：產生一組長效權杖，雜湊後存進 Devices 分頁（同一裝置同一帳號重複登入會更新同一列，不會一直增加）。
 * 回傳明文權杖給前端存進瀏覽器 cookie，伺服器只留雜湊值，跟密碼的存法一樣。
 */
function rememberDevice_(deviceId, username, deviceLabel) {
  var deviceToken = Utilities.getUuid() + Utilities.getUuid();
  var today = todayStr();
  var sheet = getSheet(SHEET_DEVICES);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idCol = header.indexOf('DeviceId');
  var userCol = header.indexOf('Username');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === deviceId && data[i][userCol] === username) {
      updateRowFields(SHEET_DEVICES, i + 1, { TokenHash: sha256(deviceToken), DeviceLabel: deviceLabel || data[i][header.indexOf('DeviceLabel')], LastSeenDate: today });
      return deviceToken;
    }
  }
  appendObjectRow(SHEET_DEVICES, { DeviceId: deviceId, Username: username, DeviceLabel: deviceLabel || '', TokenHash: sha256(deviceToken), CreatedDate: today, LastSeenDate: today });
  return deviceToken;
}

/** 前端帶著瀏覽器 cookie 存的 deviceId + deviceToken 來，不用打密碼就換一個新的 6 小時工作階段 token。 */
function handleResumeSession(body) {
  if (!body.deviceId || !body.deviceToken) return { success: false, message: '缺少裝置資訊' };

  var sheet = getSheet(SHEET_DEVICES);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idCol = header.indexOf('DeviceId');
  var hashCol = header.indexOf('TokenHash');
  var userCol = header.indexOf('Username');
  var tokenHash = sha256(body.deviceToken);

  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === body.deviceId && data[i][hashCol] === tokenHash) {
      var username = data[i][userCol];
      var user = findUserRow_(username);
      if (!user) return { success: false, message: '帳號不存在，請重新登入' }; // 帳號被刪除
      sheet.getRange(i + 1, header.indexOf('LastSeenDate') + 1).setValue(todayStr());
      var displayName = user['DisplayName'] || username;
      return { success: true, token: issueSessionToken_(username, displayName), username: username, displayName: displayName, role: user['Role'] || '' };
    }
  }
  return { success: false, message: '這台裝置的登入紀錄已被移除，請重新輸入帳密登入' };
}

/** 登入頁按「登出」：把這台裝置從 Devices 分頁刪掉，下次要重新輸入帳密。 */
function handleLogoutDevice(body) {
  if (!body.deviceId) return { success: true };
  var sheet = getSheet(SHEET_DEVICES);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idCol = header.indexOf('DeviceId');
  var userCol = header.indexOf('Username');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === body.deviceId && data[i][userCol] === body._user.username) sheet.deleteRow(i + 1);
  }
  return { success: true };
}

/** 只有 admin 角色能管理裝置清單，其他角色一律拒絕。 */
function requireAdmin_(body) {
  var user = findUserRow_(body._user.username);
  if (!user || user['Role'] !== 'admin') throw new Error('權限不足，只有管理員可以使用這個功能');
}

/** 管理員頁面：列出所有人記住的裝置，方便踢除遺失的手機/電腦。不回傳權杖雜湊，避免外洩。 */
function handleGetDevices(body) {
  requireAdmin_(body);
  var data = sheetToObjects(SHEET_DEVICES);
  var devices = data.rows.map(function (r, i) {
    return { RowIndex: i + 2, DeviceId: r['DeviceId'], Username: r['Username'], DeviceLabel: r['DeviceLabel'], CreatedDate: r['CreatedDate'], LastSeenDate: r['LastSeenDate'] };
  });
  devices.sort(function (a, b) {
    return new Date(b['LastSeenDate']) - new Date(a['LastSeenDate']);
  });
  return { success: true, devices: devices };
}

/** 管理員頁面：移除一台裝置，該裝置下次打開網頁會被踢回登入頁。 */
function handleRemoveDevice(body) {
  requireAdmin_(body);
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_DEVICES).deleteRow(body.rowIndex);
  return { success: true };
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
// 帳號管理（僅 admin，見 PERMISSIONS：新增/修改/刪除帳號、重設密碼）
// 不回傳 PasswordHash 給前端，避免外洩雜湊值。
// ------------------------------------------------------------
function stripPasswordHash_(row) {
  var copy = Object.assign({}, row);
  delete copy.PasswordHash;
  return copy;
}

function handleGetUsers(body) {
  var data = sheetToObjects(SHEET_USERS);
  var users = data.rows.map(function (r, i) {
    return stripPasswordHash_(Object.assign({ RowIndex: i + 2 }, r));
  });
  return { success: true, users: users, roles: ROLES };
}

function handleAddUser(body) {
  if (!body.username) return { success: false, message: '帳號為必填' };
  if (findUserRow_(body.username)) return { success: false, message: '此帳號已存在' };
  var password = body.password || randomPassword_(10);
  appendObjectRow(SHEET_USERS, {
    Username: body.username,
    PasswordHash: sha256(password),
    Role: body.role || 'sales',
    DisplayName: body.displayName || body.username,
  });
  return { success: true, password: body.password ? undefined : password };
}

function findUserRowIndex_(username) {
  var sheet = getSheet(SHEET_USERS);
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('Username');
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === username) return i + 1;
  }
  return -1;
}

/** 修改角色/顯示名稱，不能改帳號本身(Username)，避免跟裝置/工作階段的對應關係亂掉。 */
function handleUpdateUser(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  var fields = Object.assign({}, body.fields);
  delete fields.Username;
  delete fields.PasswordHash;
  updateRowFields(SHEET_USERS, body.rowIndex, fields);
  return { success: true };
}

function handleDeleteUser(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  var sheet = getSheet(SHEET_USERS);
  if (sheet.getLastRow() - 1 <= 1) return { success: false, message: '至少要保留一個帳號，無法刪除' };
  sheet.deleteRow(body.rowIndex);
  return { success: true };
}

function handleResetUserPassword(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  var password = body.password || randomPassword_(10);
  updateRowFields(SHEET_USERS, body.rowIndex, { PasswordHash: sha256(password) });
  return { success: true, password: password };
}

// ------------------------------------------------------------
// 產品搜尋表 (CRUD)
// ------------------------------------------------------------
function handleSearchProducts(body) {
  var keyword = String(body.keyword || '').toLowerCase();
  var data = sheetToObjects(SHEET_PRODUCTS);
  data.rows.forEach(function (r, i) {
    r.RowIndex = i + 2;
  });
  var results = data.rows.filter(function (r) {
    if (!keyword) return true;
    return data.header.some(function (h) {
      return String(r[h] || '').toLowerCase().indexOf(keyword) > -1;
    });
  });

  // 每個產品的詢價次數(= 價格紀錄筆數)，前端可以拿來排序看哪些是熱門產品
  var counts = {};
  var lastDates = {};
  sheetToObjects(SHEET_PRICE_HISTORY).rows.forEach(function (h) {
    var key = h['ProductInternalModel'];
    counts[key] = (counts[key] || 0) + 1;
    if (!lastDates[key] || String(h['Date']) > lastDates[key]) lastDates[key] = String(h['Date']);
  });
  results.forEach(function (r) {
    r.InquiryCount = counts[r['InternalModel']] || 0;
    r.LastInquiryDate = lastDates[r['InternalModel']] || '';
  });
  return { success: true, products: results };
}

function handleGetProduct(body) {
  var internalModel = body.internalModel;
  var data = sheetToObjects(SHEET_PRODUCTS);
  var product = null;
  data.rows.forEach(function (r, i) {
    r.RowIndex = i + 2;
    // 內部型號還沒填的產品(例如從型錄匯入的)用 rowIndex 找
    if (body.rowIndex ? r.RowIndex === Number(body.rowIndex) : String(r['InternalModel']) === String(internalModel)) product = r;
  });
  if (!product) return { success: false, message: '查無此產品' };
  internalModel = product['InternalModel'];

  var group = product['CompatibleGroup'];
  var compatibleProducts = data.rows.filter(function (r) {
    return group && r['CompatibleGroup'] === group && r['InternalModel'] !== internalModel;
  });

  var priceHistory = internalModel ? handleGetPriceHistory({ internalModel: internalModel }).history : [];

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
    LastUpdated: todayStr(),
  });
  return { success: true };
}

function handleUpdateProduct(body) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = body.rowIndex ? Number(body.rowIndex) : findProductRowIndex(header, body.internalModel);
  if (rowNum === -1 || rowNum < 2 || rowNum > sheet.getLastRow()) return { success: false, message: '查無此產品' };
  var fields = Object.assign({}, body.fields);
  if (fields.InternalModel !== undefined) {
    fields.InternalModel = String(fields.InternalModel).trim();
    var dup = findProductRowIndex(header, fields.InternalModel);
    if (fields.InternalModel && dup > -1 && dup !== rowNum) return { success: false, message: '此內部型號已被其他產品使用' };
  }
  fields.LastUpdated = todayStr();
  updateRowFields(SHEET_PRODUCTS, rowNum, fields);
  return { success: true };
}

function handleDeleteProduct(body) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = body.rowIndex ? Number(body.rowIndex) : findProductRowIndex(header, body.internalModel);
  if (rowNum > sheet.getLastRow()) rowNum = -1;
  if (rowNum === -1) return { success: false, message: '查無此產品' };
  sheet.deleteRow(rowNum);
  return { success: true };
}

// ------------------------------------------------------------
// 從「選型計算」型錄(公開 Google 試算表)匯入產品：分頁 GigE / USB3 / FA鏡頭 / 遠心鏡頭
// 只補缺的：已存在(內部型號相同，或 原廠+原廠型號 相同)的不動。價格型錄裡沒有，匯入後 RefPrice 為空，
// 產品頁會提醒補價格、補內部型號，並顯示上次修改日期。型錄 ID 存在 Config 的 CatalogSheetId（沒設就用預設那份）。
// ------------------------------------------------------------
var DEFAULT_CATALOG_SHEET_ID = '1Enn6Yr6bOtlpWUSoy_Hd00VKWQh-0m4x';
var CATALOG_TABS = [
  { tab: 'GigE', category: '相機', kind: 'camera', label: 'GigE' },
  { tab: 'USB3', category: '相機', kind: 'camera', label: 'USB3.0' },
  { tab: 'FA鏡頭', category: '鏡頭', kind: 'fa', label: 'FA鏡頭' },
  { tab: '遠心鏡頭', category: '鏡頭', kind: 'tele', label: '遠心鏡頭' },
];

function fetchCatalogTab_(sheetId, tab) {
  var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tab);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('讀取型錄分頁「' + tab + '」失敗(HTTP ' + res.getResponseCode() + ')，確認型錄試算表是「知道連結的人可檢視」');
  return Utilities.parseCsv(res.getContentText('UTF-8'));
}

/** 用欄名關鍵字找欄位（型錄欄名是「中文+英文」連在一起，例如「畫素Pixels」）。 */
function catalogCol_(header, keyword) {
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).replace(/\s+/g, '').indexOf(keyword) > -1) return i;
  }
  return -1;
}

function catalogSpec_(kind, header, row) {
  function v(keyword) {
    var i = catalogCol_(header, keyword);
    return i > -1 ? String(row[i] || '').trim() : '';
  }
  var parts = [];
  if (kind === 'camera') {
    if (v('畫素')) parts.push(v('畫素') + '萬畫素');
    ['黑白/彩色', 'SensorType', 'PixelSize', 'DataInterface'].forEach(function (k) {
      if (v(k)) parts.push(v(k));
    });
    if (v('FPS')) parts.push(v('FPS') + 'fps');
  } else if (kind === 'fa') {
    if (v('解析度')) parts.push(v('解析度') + 'MP');
    if (v('焦距')) parts.push('焦距' + v('焦距') + 'mm');
    if (v('SensorSize')) parts.push('靶面' + v('SensorSize'));
    if (v('LensType')) parts.push(v('LensType') + '接口');
    if (v('FocusWD')) parts.push('最近對焦' + v('FocusWD') + 'mm');
  } else {
    if (v('MAG')) parts.push('倍率' + v('MAG') + 'x');
    if (v('WD')) parts.push('WD' + v('WD') + 'mm');
    if (v('解析度')) parts.push('解析度' + v('解析度'));
    if (v('DOF')) parts.push('景深' + v('DOF'));
    if (v('Coaxial')) parts.push(v('Coaxial'));
    if (v('SensorSize')) parts.push('靶面' + v('SensorSize'));
  }
  return parts.join('，');
}

function importCatalogProducts_(log) {
  var sheetId = getConfig('CatalogSheetId') || DEFAULT_CATALOG_SHEET_ID;
  var existing = sheetToObjects(SHEET_PRODUCTS).rows;
  var byInternal = {};
  var bySupplierModel = {};
  existing.forEach(function (r) {
    if (r['InternalModel']) byInternal[String(r['InternalModel'])] = true;
    if (r['SupplierModel']) bySupplierModel[r['Supplier'] + '|' + r['SupplierModel']] = true;
  });

  var today = todayStr();
  var added = 0;
  var missingInternal = 0;
  var skippedTabs = [];
  CATALOG_TABS.forEach(function (t) {
    var rows;
    try {
      rows = fetchCatalogTab_(sheetId, t.tab);
    } catch (e) {
      skippedTabs.push(t.tab + '（' + e.message + '）');
      return;
    }
    if (rows.length < 2) return;
    var header = rows[0];
    var iSupplier = catalogCol_(header, '原廠名稱');
    var iOrigModel = catalogCol_(header, '原廠型號');
    var iName = catalogCol_(header, '公司型號');
    rows.slice(1).forEach(function (row) {
      var supplier = iSupplier > -1 ? String(row[iSupplier] || '').trim() : '';
      var origModel = iOrigModel > -1 ? String(row[iOrigModel] || '').trim() : '';
      var internal = iName > -1 ? String(row[iName] || '').trim() : '';
      if (!internal && !origModel) return; // 空白列
      if (internal && byInternal[internal]) return;
      if (origModel && bySupplierModel[supplier + '|' + origModel]) return;
      appendObjectRow(SHEET_PRODUCTS, {
        InternalModel: internal,
        SupplierModel: origModel,
        Supplier: supplier,
        Category: t.category,
        Notes: t.label + '；' + catalogSpec_(t.kind, header, row),
        LastUpdated: today,
      });
      if (internal) byInternal[internal] = true;
      if (origModel) bySupplierModel[supplier + '|' + origModel] = true;
      if (!internal) missingInternal++;
      added++;
    });
  });

  var msg = '型錄匯入：新增 ' + added + ' 筆產品（型錄沒有價格與供應商聯絡資料；其中 ' + missingInternal + ' 筆缺內部型號，產品頁會提醒補資料）';
  if (skippedTabs.length) msg += '；略過：' + skippedTabs.join('、');
  if (log) log.push(msg);
  return { added: added, missingInternal: missingInternal, skipped: skippedTabs, message: msg };
}

function handleImportCatalogProducts(body) {
  var r = importCatalogProducts_(null);
  return { success: true, added: r.added, missingInternal: r.missingInternal, message: r.message };
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

/** 客戶是不是已經存在（精確比對公司名稱），案件一定要掛在一個已存在的客戶底下。 */
function customerExists_(companyName) {
  if (!companyName) return false;
  var data = sheetToObjects(SHEET_CUSTOMERS);
  return data.rows.some(function (r) {
    return r['CompanyName'] === companyName;
  });
}

function handleCreateCase(body) {
  if (!body.customerName) return { success: false, message: '請先選擇客戶（客戶名稱為必填）' };
  if (!customerExists_(body.customerName)) {
    return { success: false, message: '「' + body.customerName + '」不在客戶資料表中，請先在「客戶管理」建立這間客戶，或用畫面上的建議清單挑選' };
  }

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
  saveCaseCompaniesForCase(caseId, body.relatedCompanies || []);
  return { success: true, caseId: caseId };
}

/**
 * 查詢案件清單：可用 status 篩選、keyword 模糊搜尋(案件編號/客戶/業務/FAE)、
 * 或 companyName 精確篩選「這間公司相關的案件」(是主要客戶，或是 CaseCompanies 裡的相關公司)——
 * 客戶管理頁「新增聯繫紀錄」選案件、或同客戶有多個案件時用這個。
 */
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
  if (body.companyName) {
    var relatedCaseIds = {};
    sheetToObjects(SHEET_CASE_COMPANIES).rows.forEach(function (r) {
      if (r['CompanyName'] === body.companyName) relatedCaseIds[r['CaseID']] = true;
    });
    rows = rows.filter(function (r) {
      return r['CustomerName'] === body.companyName || relatedCaseIds[r['CaseID']];
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
  caseObj = Object.assign({}, caseObj, {
    CcdRequirements: getCcdRequirementsForCase(body.caseId),
    RelatedCompanies: getCaseCompaniesForCase(body.caseId),
  });
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

  if (body.fields) {
    // 客戶名稱有改的話，一樣要是已存在的客戶，不能改成一個不存在的名字
    if (body.fields.CustomerName && !customerExists_(body.fields.CustomerName)) {
      return { success: false, message: '「' + body.fields.CustomerName + '」不在客戶資料表中，請先在「客戶管理」建立這間客戶，或用畫面上的建議清單挑選' };
    }
    updateRowFields(SHEET_CASES, rowNum, body.fields);
  }
  var luCol = header.indexOf('LastUpdated');
  if (luCol > -1) sheet.getRange(rowNum, luCol + 1).setValue(Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'));

  // body.ccdRequirements / body.relatedCompanies 有給的話（例如案件編輯畫面按儲存修改）就整批覆蓋掉
  if (body.ccdRequirements) saveCcdRequirementsForCase(body.caseId, body.ccdRequirements);
  if (body.relatedCompanies) saveCaseCompaniesForCase(body.caseId, body.relatedCompanies);

  return { success: true };
}

function handleDeleteCase(body) {
  var sheet = getSheet(SHEET_CASES);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = findCaseRowIndex(header, body.caseId);
  if (rowNum === -1) return { success: false, message: '查無此案件' };
  sheet.deleteRow(rowNum);
  deleteCcdRowsForCase(body.caseId);
  deleteCaseCompanyRowsForCase(body.caseId);
  return { success: true };
}

// ------------------------------------------------------------
// 案件相關公司（一個案件可能牽涉多間公司，例如設備商 + 終端客戶 + 其他協力廠一起做同一台機台）
// 存法跟 CCDRequirements 同一套：獨立分頁、CaseID 關聯，一個案件對應多列。
// CustomerName 欄位仍是這個案件的「主要客戶」，這裡存的是除了主要客戶以外的相關公司。
// ------------------------------------------------------------
function deleteCaseCompanyRowsForCase(caseId) {
  var sheet = getSheet(SHEET_CASE_COMPANIES);
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('CaseID');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === caseId) sheet.deleteRow(i + 1);
  }
}

function saveCaseCompaniesForCase(caseId, companies) {
  deleteCaseCompanyRowsForCase(caseId);
  (companies || []).forEach(function (c) {
    if (!c.CompanyName) return;
    appendObjectRow(SHEET_CASE_COMPANIES, { CaseID: caseId, CompanyName: c.CompanyName, Role: c.Role || '' });
  });
}

function getCaseCompaniesForCase(caseId) {
  return sheetToObjects(SHEET_CASE_COMPANIES).rows.filter(function (r) {
    return r['CaseID'] === caseId;
  });
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
  var rows = data.rows.map(function (r, i) {
    return Object.assign({ RowIndex: i + 2 }, r);
  });
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

function handleUpdateStaff(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  updateRowFields(SHEET_STAFF, body.rowIndex, body.fields);
  return { success: true };
}

function handleDeleteStaff(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_STAFF).deleteRow(body.rowIndex);
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
    HasTransacted: body.hasTransacted ? '是' : '',
    LastTransactionDate: body.lastTransactionDate || '',
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
// 客戶聯絡人（一間公司可以有多個聯絡窗口，各自的姓名/電話/Email 都不一樣）
// Customers 分頁的 Contact/Phone/Email 仍是「主要聯絡人」，這裡是額外/其他聯絡窗口。
// ------------------------------------------------------------
function handleGetCustomerContacts(body) {
  var data = sheetToObjects(SHEET_CUSTOMER_CONTACTS);
  var rows = data.rows.map(function (r, i) {
    return Object.assign({ RowIndex: i + 2 }, r);
  });
  if (body.companyName) {
    rows = rows.filter(function (r) {
      return r['CompanyName'] === body.companyName;
    });
  }
  return { success: true, contacts: rows };
}

function handleAddCustomerContact(body) {
  if (!body.companyName || !body.contactName) return { success: false, message: '公司名稱與聯絡人姓名為必填' };
  appendObjectRow(SHEET_CUSTOMER_CONTACTS, {
    CompanyName: body.companyName,
    ContactName: body.contactName,
    Phone: body.phone || '',
    Email: body.email || '',
    Title: body.title || '',
    Notes: body.notes || '',
  });
  return { success: true };
}

function handleUpdateCustomerContact(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  updateRowFields(SHEET_CUSTOMER_CONTACTS, body.rowIndex, body.fields);
  return { success: true };
}

function handleDeleteCustomerContact(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_CUSTOMER_CONTACTS).deleteRow(body.rowIndex);
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
    CaseID: body.caseId || '',
  });
  return { success: true };
}

/** date：只看某一天(日報用)；companyName：只看某間公司(客戶管理頁的聯繫紀錄列表用)，兩個都可以不給。 */
function handleGetContactLogs(body) {
  var data = sheetToObjects(SHEET_CONTACT_LOGS);
  var rows = data.rows.map(function (r, i) {
    return Object.assign({ RowIndex: i + 2 }, r);
  });
  if (body.date) {
    rows = rows.filter(function (r) {
      return r['Date'] === body.date;
    });
  }
  if (body.companyName) {
    rows = rows.filter(function (r) {
      return r['CompanyName'] === body.companyName;
    });
  }
  rows.sort(function (a, b) {
    return new Date(b['Date']) - new Date(a['Date']);
  });
  return { success: true, logs: rows };
}

function handleUpdateContactLog(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  updateRowFields(SHEET_CONTACT_LOGS, body.rowIndex, body.fields);
  return { success: true };
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
