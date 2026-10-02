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
 *      客戶(含分類/急迫性+行事曆) / 客戶聯繫紀錄
 *
 * 試算表分頁與欄位(詳見 README.md)：
 *   Products      - InternalModel, SupplierModel, Supplier, SupplierContact,
 *                    SupplierContactEmail, Origin, Category, CompatibleGroup, RefPrice, Notes, LastUpdated, SourceUrl, Specs
 *                    （LastUpdated=上次修改日期，前端用來提醒資料多久沒更新、要不要重新詢價；
 *                    SourceUrl=資料來源網址，Specs=官網抓到的完整規格(JSON)，之後選型計算可以直接用）
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
 *   Users         - Username, PasswordHash, Role, DisplayName, Phone, Email, Birthday（個人資料可由本人在「個人資料」頁修改）
 *   LoginLogs     - LoginTime, Username, DisplayName, Result, DeviceId, DeviceLabel, LastActive, EndTime, EndReason（登入歷程）
 *                    （Role 決定權限，見 PERMISSIONS：admin 可以做任何事／sales 業務／fae 工程）
 *   Favorites     - Username, InternalModel（每人自己的「常用型號」）
 *   Shortcuts     - Username, Title, Url, OpenOnStart, SortOrder（每人自己的首頁「常用網站」）
 *   Memos         - Owner, OwnerName, Title, Content, Shared, CreatedDate, LastUpdated（備忘錄，預設只有自己看，Shared=是 全站可看）
 *   GigE / USB3 / FA鏡頭 / 遠心鏡頭 - 選型計算用的相機與鏡頭型錄（完整複製自原本的公開型錄，欄位一模一樣，之後直接在這裡編修；
 *                    遠心鏡頭另外多出德鴻官網規格欄位）。標題列由 setup 從型錄複製，不在 SCHEMA 內
 *   Software      - Name（案件「軟體名稱」下拉選單的選項，公司準系統只有幾套；新名稱在案件頁會詢問是否新增）
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
var SHEET_FAVORITES = 'Favorites';
var SHEET_SHORTCUTS = 'Shortcuts';
var SHEET_MEMOS = 'Memos';
var SHEET_SOFTWARE = 'Software';
var SHEET_LOGIN_LOGS = 'LoginLogs';

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
  getLoginOverview:        { auth: true,  fn: handleGetLoginOverview },
  getLoginLogs:            { auth: true,  fn: handleGetLoginLogs },
  forceLogout:             { auth: true,  fn: handleForceLogout },
  clearLoginLogs:          { auth: true,  fn: handleClearLoginLogs },
  setLoginKeep:            { auth: true,  fn: handleSetLoginKeep },
  getProfile:              { auth: true,  fn: handleGetProfile },
  updateProfile:           { auth: true,  fn: handleUpdateProfile },
  changePassword:          { auth: true,  fn: handleChangePassword },

  // 產品(產品搜尋表)
  searchProducts:          { auth: true, fn: handleSearchProducts },
  getProduct:              { auth: true, fn: handleGetProduct },
  addProduct:              { auth: true, fn: handleAddProduct },
  updateProduct:           { auth: true, fn: handleUpdateProduct },
  deleteProduct:           { auth: true, fn: handleDeleteProduct },
  importCatalogProducts:   { auth: true, fn: handleImportCatalogProducts },
  importDehongProducts:    { auth: true, fn: handleImportDehongProducts },
  dedupeData:              { auth: true, fn: handleDedupeData },
  importFlirProducts:      { auth: true, fn: handleImportFlirProducts },
  getCalcCatalog:          { auth: true, fn: handleGetCalcCatalog },
  syncCalcCatalog:         { auth: true, fn: handleSyncCalcCatalog },

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
  getSoftware:             { auth: true, fn: handleGetSoftware },
  addSoftware:             { auth: true, fn: handleAddSoftware },
  deleteSoftware:          { auth: true, fn: handleDeleteSoftware },
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

  // 個人化：常用型號 / 首頁常用網站 / 備忘錄 / 行事曆行程
  getFavorites:            { auth: true, fn: handleGetFavorites },
  toggleFavorite:          { auth: true, fn: handleToggleFavorite },
  getShortcuts:            { auth: true, fn: handleGetShortcuts },
  saveShortcuts:           { auth: true, fn: handleSaveShortcuts },
  getMemos:                { auth: true, fn: handleGetMemos },
  addMemo:                 { auth: true, fn: handleAddMemo },
  updateMemo:              { auth: true, fn: handleUpdateMemo },
  deleteMemo:              { auth: true, fn: handleDeleteMemo },
  getCalendarEvents:       { auth: true, fn: handleGetCalendarEvents },

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
        touchSession_(body._user); // 約每 5 分鐘更新一次「最後使用」
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
SCHEMA[SHEET_PRODUCTS] = ['InternalModel', 'SupplierModel', 'Supplier', 'SupplierContact', 'SupplierContactEmail', 'Origin', 'Category', 'CompatibleGroup', 'RefPrice', 'Notes', 'LastUpdated', 'SourceUrl', 'Specs'];
SCHEMA[SHEET_PRICE_HISTORY] = ['Date', 'ProductInternalModel', 'Supplier', 'Price', 'Currency', 'CaseID', 'Notes'];
SCHEMA[SHEET_CASES] = ['CaseID', 'CustomerName', 'EndCustomerName', 'ProjectContact', 'ContactPhone', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'SoftwareName', 'SoftwareCustomization', 'SoftwareCustomizationNote', 'Status', 'CreatedDate', 'RequirementDetails', 'AttachmentLinksJson', 'EvaluationResult', 'EvaluationReportHtml', 'LastUpdated'];
SCHEMA[SHEET_CCD_REQUIREMENTS] = ['CaseID', 'CcdIndex', 'Description', 'FovLengthMm', 'FovWidthMm', 'WdMm', 'AccuracyUm', 'FlyingSpeedMmS', 'InspectionSpeedPs', 'LightingNote'];
SCHEMA[SHEET_STAFF] = ['Name', 'Role'];
SCHEMA[SHEET_CUSTOMERS] = ['CompanyName', 'Contact', 'Phone', 'Email', 'NextFollowUpDate', 'Category', 'Urgency', 'Notes', 'CalendarEventId', 'HasTransacted', 'LastTransactionDate'];
SCHEMA[SHEET_CONTACT_LOGS] = ['Date', 'CompanyName', 'Contact', 'Method', 'Summary', 'Salesperson', 'CaseID'];
SCHEMA[SHEET_CUSTOMER_CONTACTS] = ['CompanyName', 'ContactName', 'Phone', 'Email', 'Title', 'Notes'];
SCHEMA[SHEET_CASE_COMPANIES] = ['CaseID', 'CompanyName', 'Role'];
SCHEMA[SHEET_USERS] = ['Username', 'PasswordHash', 'Role', 'DisplayName', 'Phone', 'Email', 'Birthday'];
SCHEMA[SHEET_LOGIN_LOGS] = ['LoginTime', 'Username', 'DisplayName', 'Result', 'DeviceId', 'DeviceLabel', 'LastActive', 'EndTime', 'EndReason'];
/** 公司分類固定選項（客戶管理頁下拉選單用，"AOI同業資料" 目前沒有既有資料，先開放選項給之後手動建立）。 */
var CUSTOMER_CATEGORIES = ['AOI同業資料', '器材原廠', '機構合作設備商', '一般客戶'];
/** 帳號角色：admin(管理員，全部功能) / sales(業務) / fae(工程/FAE)。 */
var ROLES = ['admin', 'sales', 'fae'];
SCHEMA[SHEET_CONFIG] = ['Key', 'Value'];
SCHEMA[SHEET_SOFTWARE] = ['Name'];
SCHEMA[SHEET_FAVORITES] = ['Username', 'InternalModel'];
SCHEMA[SHEET_SHORTCUTS] = ['Username', 'Title', 'Url', 'OpenOnStart', 'SortOrder'];
SCHEMA[SHEET_MEMOS] = ['Owner', 'OwnerName', 'Title', 'Content', 'Shared', 'CreatedDate', 'LastUpdated'];
SCHEMA[SHEET_DEVICES] = ['DeviceId', 'Username', 'DeviceLabel', 'TokenHash', 'CreatedDate', 'LastSeenDate', 'LoginTime', 'LastSeenTime'];

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
TEXT_COLUMNS[SHEET_USERS] = ['Username', 'PasswordHash', 'Phone', 'Birthday'];
TEXT_COLUMNS[SHEET_LOGIN_LOGS] = ['LoginTime', 'Username', 'DeviceId', 'LastActive', 'EndTime'];
TEXT_COLUMNS[SHEET_DEVICES] = ['DeviceId', 'Username', 'TokenHash', 'LoginTime', 'LastSeenTime'];
TEXT_COLUMNS[SHEET_PRICE_HISTORY] = ['ProductInternalModel', 'CaseID'];
TEXT_COLUMNS[SHEET_PRODUCTS] = ['InternalModel', 'SupplierModel'];
TEXT_COLUMNS[SHEET_FAVORITES] = ['Username', 'InternalModel'];
TEXT_COLUMNS[SHEET_SHORTCUTS] = ['Username'];
TEXT_COLUMNS[SHEET_MEMOS] = ['Owner'];

/** Config 分頁預設要有的設定（值留空，之後自己填）。 */
var CONFIG_KEYS = [
  ['TemplateDocId_Requirement', '需求單 Google 文件範本 ID（選填，只用 HTML 格式可不填）'],
  ['TemplateDocId_Evaluation', '評估單 Google 文件範本 ID（選填）'],
  ['TemplateDocId_Quote', '報價單 Google 文件範本 ID（選填）'],
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
PERMISSIONS['getLoginOverview'] = ['admin'];
PERMISSIONS['getLoginLogs'] = ['admin'];
PERMISSIONS['forceLogout'] = ['admin'];
PERMISSIONS['clearLoginLogs'] = ['admin'];
PERMISSIONS['setLoginKeep'] = ['admin'];
PERMISSIONS['addStaff'] = ['admin'];
PERMISSIONS['updateStaff'] = ['admin'];
PERMISSIONS['deleteStaff'] = ['admin'];
PERMISSIONS['deleteProduct'] = ['admin', 'sales'];
PERMISSIONS['deleteSoftware'] = ['admin'];
PERMISSIONS['importCatalogProducts'] = ['admin', 'sales'];
PERMISSIONS['importDehongProducts'] = ['admin', 'sales'];
PERMISSIONS['dedupeData'] = ['admin'];
PERMISSIONS['importFlirProducts'] = ['admin', 'sales'];
PERMISSIONS['syncCalcCatalog'] = ['admin', 'sales'];
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
  seedSoftwareFromCases_(log);
  try {
    copyCalcCatalog_(log);
  } catch (e) {
    log.push('選型計算型錄複製失敗（之後可在選型計算頁按「同步型錄」重試）：' + e.message);
  }
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
 * 跟字串比對永遠不相等，傳到前端也會變成 ISO 時間字串。
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
/** 台灣時間 yyyy-MM-dd HH:mm。 */
function nowStr() {
  return Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm');
}

/**
 * 發一個一般工作階段 token（快取最多 6 小時，這是 Apps Script 快取的上限）。
 * 真正「不用一直登入」靠的是 Devices 分頁記住的裝置：token 過期時前端會自動用裝置權杖換新的，使用者看不到。
 * token 裡記下 deviceId，才能知道這是哪一台裝置、被強制登出時馬上失效。
 */
function issueSessionToken_(username, displayName, deviceId) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('token_' + token, JSON.stringify({ username: username, displayName: displayName, deviceId: deviceId || '' }), 21600);
  if (deviceId) CacheService.getScriptCache().remove('revoked_' + deviceId);
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

// ---- 登入歷程（LoginLogs）----
var DEFAULT_LOGIN_KEEP = 20;

function getLoginKeep_() {
  var v = Number(getConfig('LoginLogKeep'));
  return v >= 1 ? v : DEFAULT_LOGIN_KEEP;
}

/** 這台裝置、這個帳號目前「還沒結束」的那一筆登入紀錄（列號），沒有回傳 -1。 */
function findOpenLogRow_(deviceId, username) {
  var data = getSheet(SHEET_LOGIN_LOGS).getDataRange().getValues();
  var h = data[0];
  var dCol = h.indexOf('DeviceId');
  var uCol = h.indexOf('Username');
  var eCol = h.indexOf('EndTime');
  var rCol = h.indexOf('Result');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][dCol] === deviceId && data[i][uCol] === username && !data[i][eCol] && data[i][rCol] === '成功') return i + 1;
  }
  return -1;
}

function closeOpenLogs_(deviceId, username, reason) {
  var row;
  var guard = 0;
  while ((row = findOpenLogRow_(deviceId, username)) > -1 && guard++ < 20) {
    updateRowFields(SHEET_LOGIN_LOGS, row, { EndTime: nowStr(), EndReason: reason });
  }
}

function appendLoginLog_(username, displayName, result, deviceId, deviceLabel) {
  var now = nowStr();
  appendObjectRow(SHEET_LOGIN_LOGS, {
    LoginTime: now,
    Username: username || '',
    DisplayName: displayName || '',
    Result: result,
    DeviceId: deviceId || '',
    DeviceLabel: deviceLabel || '',
    LastActive: result === '成功' ? now : '',
    EndTime: result === '成功' ? '' : now,
    EndReason: result === '成功' ? '' : '密碼錯誤',
  });
}

/** 每個帳號只保留最近 keep 筆歷程，超過的最舊紀錄刪掉（還在登入中的那筆一定保留）。 */
function trimLoginLogs_(username) {
  var keep = getLoginKeep_();
  var sheet = getSheet(SHEET_LOGIN_LOGS);
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var uCol = h.indexOf('Username');
  var eCol = h.indexOf('EndTime');
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][uCol] === username) rows.push({ row: i + 1, open: !data[i][eCol] });
  }
  var excess = rows.length - keep;
  if (excess <= 0) return 0;
  var toDelete = [];
  for (var k = 0; k < rows.length && toDelete.length < excess; k++) {
    if (!rows[k].open) toDelete.push(rows[k].row);
  }
  toDelete.sort(function (a, b) {
    return b - a;
  });
  toDelete.forEach(function (r) {
    sheet.deleteRow(r);
  });
  return toDelete.length;
}

function handleLogin(body) {
  var username = body.username;
  var password = body.password;
  var user = findUserRow_(username);
  if (!user || user['PasswordHash'] !== sha256(password)) {
    if (username) appendLoginLog_(String(username), '', '失敗', body.deviceId, body.deviceLabel);
    return { success: false, message: '帳號或密碼錯誤' };
  }

  var displayName = user['DisplayName'] || username;
  var token = issueSessionToken_(username, displayName, body.deviceId);
  var result = { success: true, token: token, username: username, displayName: displayName, role: user['Role'] || '' };

  // 前端有傳裝置 ID 的話（「記住這台裝置」），額外發一組長效裝置權杖，讓下次自動登入不用再打密碼
  if (body.deviceId) {
    closeOpenLogs_(body.deviceId, username, '重新登入');
    result.deviceToken = rememberDevice_(body.deviceId, username, body.deviceLabel);
  }
  appendLoginLog_(username, displayName, '成功', body.deviceId, body.deviceLabel);
  trimLoginLogs_(username);
  return result;
}

/**
 * 記住裝置：產生一組長效權杖，雜湊後存進 Devices 分頁（同一裝置同一帳號重複登入會更新同一列，不會一直增加）。
 * 回傳明文權杖給前端存進瀏覽器 cookie，伺服器只留雜湊值，跟密碼的存法一樣。
 */
function rememberDevice_(deviceId, username, deviceLabel) {
  var deviceToken = Utilities.getUuid() + Utilities.getUuid();
  var today = todayStr();
  var now = nowStr();
  var sheet = getSheet(SHEET_DEVICES);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idCol = header.indexOf('DeviceId');
  var userCol = header.indexOf('Username');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === deviceId && data[i][userCol] === username) {
      updateRowFields(SHEET_DEVICES, i + 1, { TokenHash: sha256(deviceToken), DeviceLabel: deviceLabel || data[i][header.indexOf('DeviceLabel')], LastSeenDate: today, LoginTime: now, LastSeenTime: now });
      return deviceToken;
    }
  }
  appendObjectRow(SHEET_DEVICES, { DeviceId: deviceId, Username: username, DeviceLabel: deviceLabel || '', TokenHash: sha256(deviceToken), CreatedDate: today, LastSeenDate: today, LoginTime: now, LastSeenTime: now });
  return deviceToken;
}

/** 前端帶著瀏覽器 cookie 存的 deviceId + deviceToken 來，不用打密碼就換一個新的工作階段 token（使用者完全無感）。 */
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
      updateRowFields(SHEET_DEVICES, i + 1, { LastSeenDate: todayStr(), LastSeenTime: nowStr() });
      var logRow = findOpenLogRow_(body.deviceId, username);
      if (logRow > -1) updateRowFields(SHEET_LOGIN_LOGS, logRow, { LastActive: nowStr() });
      var displayName = user['DisplayName'] || username;
      return { success: true, token: issueSessionToken_(username, displayName, body.deviceId), username: username, displayName: displayName, role: user['Role'] || '' };
    }
  }
  return { success: false, message: '這台裝置的登入紀錄已被移除，請重新輸入帳密登入' };
}

/** 結束一台裝置的登入：關掉歷程、讓這台裝置還在用的 token 馬上失效、刪掉記住的裝置。 */
function endDeviceRow_(sheet, rowNum, reason) {
  var obj = readRowAsObject(SHEET_DEVICES, rowNum);
  closeOpenLogs_(obj['DeviceId'], obj['Username'], reason);
  CacheService.getScriptCache().put('revoked_' + obj['DeviceId'], '1', 21600);
  sheet.deleteRow(rowNum);
}

/** 按「登出」：把這台裝置結束掉，下次要重新輸入帳密。 */
function handleLogoutDevice(body) {
  if (!body.deviceId) return { success: true };
  var sheet = getSheet(SHEET_DEVICES);
  var data = sheet.getDataRange().getValues();
  var header = data[0];
  var idCol = header.indexOf('DeviceId');
  var userCol = header.indexOf('Username');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === body.deviceId && data[i][userCol] === body._user.username) endDeviceRow_(sheet, i + 1, '本人登出');
  }
  closeOpenLogs_(body.deviceId, body._user.username, '本人登出');
  return { success: true };
}

/** 只有 admin 角色能用的管理功能。 */
function requireAdmin_(body) {
  var user = findUserRow_(body._user.username);
  if (!user || user['Role'] !== 'admin') throw new Error('權限不足，只有管理員可以使用這個功能');
}

/** 驗證 token，回傳 { username, displayName, deviceId }；這台裝置被強制登出的話直接擋掉。 */
function requireAuth(body) {
  var token = body.token;
  if (!token) throw new Error('尚未登入');
  var cache = CacheService.getScriptCache();
  var cached = cache.get('token_' + token);
  if (!cached) throw new Error('登入已逾期，請重新登入');
  var user;
  try {
    user = JSON.parse(cached);
  } catch (e) {
    // 舊版登入時快取裡只存帳號字串
    user = { username: cached, displayName: cached };
  }
  if (user.deviceId && cache.get('revoked_' + user.deviceId)) throw new Error('這台裝置已被登出，請重新登入');
  return user;
}

/** 約每 5 分鐘（有操作時）更新這台裝置的「最後使用」，避免每個動作都寫試算表。 */
function touchSession_(user) {
  if (!user || !user.deviceId) return;
  var cache = CacheService.getScriptCache();
  var key = 'touch_' + user.deviceId;
  if (cache.get(key)) return;
  cache.put(key, '1', 300);
  try {
    var now = nowStr();
    var sheet = getSheet(SHEET_DEVICES);
    var data = sheet.getDataRange().getValues();
    var h = data[0];
    for (var i = 1; i < data.length; i++) {
      if (data[i][h.indexOf('DeviceId')] === user.deviceId && data[i][h.indexOf('Username')] === user.username) {
        updateRowFields(SHEET_DEVICES, i + 1, { LastSeenDate: todayStr(), LastSeenTime: now });
        break;
      }
    }
    var logRow = findOpenLogRow_(user.deviceId, user.username);
    if (logRow > -1) updateRowFields(SHEET_LOGIN_LOGS, logRow, { LastActive: now });
  } catch (e) {
    // 更新「最後使用」失敗不影響正常操作
  }
}

// ---- 登入紀錄管理頁（僅 admin）----
function parseTime_(str) {
  var t = String(str || '');
  if (t.length < 16) return null;
  var d = new Date(t.slice(0, 10) + 'T' + t.slice(11, 16) + ':00+08:00');
  return isNaN(d.getTime()) ? null : d;
}

function minutesBetween_(a, b) {
  var x = parseTime_(a);
  var y = parseTime_(b);
  if (!x || !y) return 0;
  return Math.max(0, Math.round((y.getTime() - x.getTime()) / 60000));
}

function handleGetLoginOverview(body) {
  var names = {};
  sheetToObjects(SHEET_USERS).rows.forEach(function (u) {
    names[u['Username']] = u['DisplayName'] || u['Username'];
  });
  var data = sheetToObjects(SHEET_DEVICES);
  var devices = data.rows.map(function (r, i) {
    return {
      RowIndex: i + 2,
      Username: r['Username'],
      DisplayName: names[r['Username']] || r['Username'],
      DeviceLabel: r['DeviceLabel'],
      LoginTime: r['LoginTime'] || r['CreatedDate'],
      LastSeenTime: r['LastSeenTime'] || r['LastSeenDate'],
      IsCurrent: r['DeviceId'] === body._user.deviceId,
    };
  });
  devices.sort(function (a, b) {
    return String(b.LastSeenTime).localeCompare(String(a.LastSeenTime));
  });
  return { success: true, devices: devices, keep: getLoginKeep_(), logCount: sheetToObjects(SHEET_LOGIN_LOGS).rows.length };
}

function handleGetLoginLogs(body) {
  var from = body.from || '0000-00-00';
  var to = body.to || '9999-99-99';
  var kw = String(body.keyword || '').toLowerCase();
  var logs = [];
  sheetToObjects(SHEET_LOGIN_LOGS).rows.forEach(function (r, i) {
    var day = String(r['LoginTime']).slice(0, 10);
    if (day < from || day > to) return;
    if (body.result && r['Result'] !== body.result) return;
    if (kw && [r['Username'], r['DisplayName'], r['DeviceLabel']].join(' ').toLowerCase().indexOf(kw) === -1) return;
    var end = r['EndTime'] || r['LastActive'];
    logs.push({
      RowIndex: i + 2,
      LoginTime: r['LoginTime'],
      Username: r['Username'],
      DisplayName: r['DisplayName'],
      Result: r['Result'],
      DeviceLabel: r['DeviceLabel'],
      LastActive: r['LastActive'],
      EndTime: r['EndTime'],
      EndReason: r['EndReason'],
      Minutes: r['Result'] === '成功' ? minutesBetween_(r['LoginTime'], r['LastActive'] || end) : 0,
      Active: r['Result'] === '成功' && !r['EndTime'],
    });
  });
  logs.sort(function (a, b) {
    return String(b.LoginTime).localeCompare(String(a.LoginTime));
  });

  var summary = {};
  logs.forEach(function (l) {
    var u = summary[l.Username] || (summary[l.Username] = { Username: l.Username, DisplayName: l.DisplayName, Logins: 0, Fails: 0, Minutes: 0, LastLogin: '', LastDevice: '' });
    if (l.DisplayName) u.DisplayName = l.DisplayName;
    if (l.Result === '成功') {
      u.Logins++;
      u.Minutes += l.Minutes;
      if (!u.LastLogin || l.LoginTime > u.LastLogin) {
        u.LastLogin = l.LoginTime;
        u.LastDevice = l.DeviceLabel;
      }
    } else {
      u.Fails++;
    }
  });
  var summaryList = Object.keys(summary).map(function (k) {
    return summary[k];
  });
  summaryList.sort(function (a, b) {
    return b.Minutes - a.Minutes;
  });
  return { success: true, logs: logs, summary: summaryList };
}

/** scope: device(rowIndex) / user(username) / all。永遠不會把「目前正在操作的這台裝置」登出，避免把自己鎖在外面。 */
function handleForceLogout(body) {
  var sheet = getSheet(SHEET_DEVICES);
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var count = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    var isSelf = data[i][h.indexOf('DeviceId')] === body._user.deviceId;
    var match = body.scope === 'all' || (body.scope === 'user' && data[i][h.indexOf('Username')] === body.username) || (body.scope === 'device' && i + 1 === Number(body.rowIndex));
    if (match && !isSelf) {
      endDeviceRow_(sheet, i + 1, '管理員強制登出');
      count++;
    }
  }
  return { success: true, count: count };
}

/** 一鍵清除歷程：刪掉已結束的紀錄與失敗紀錄，還在登入中的保留。 */
function handleClearLoginLogs(body) {
  var sheet = getSheet(SHEET_LOGIN_LOGS);
  var data = sheet.getDataRange().getValues();
  var eCol = data[0].indexOf('EndTime');
  var n = 0;
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][eCol]) {
      sheet.deleteRow(i + 1);
      n++;
    }
  }
  return { success: true, deleted: n };
}

function handleSetLoginKeep(body) {
  var keep = Math.min(Math.max(Math.floor(Number(body.keep)) || DEFAULT_LOGIN_KEEP, 1), 500);
  setConfig('LoginLogKeep', keep);
  var seen = {};
  sheetToObjects(SHEET_LOGIN_LOGS).rows.forEach(function (r) {
    seen[r['Username']] = true;
  });
  Object.keys(seen).forEach(function (u) {
    trimLoginLogs_(u);
  });
  return { success: true, keep: keep, logCount: sheetToObjects(SHEET_LOGIN_LOGS).rows.length };
}

// ---- 個人資料（只能改自己的）----
function handleGetProfile(body) {
  var u = findUserRow_(body._user.username);
  if (!u) return { success: false, message: '帳號不存在' };
  return { success: true, profile: { Username: u['Username'], DisplayName: u['DisplayName'] || u['Username'], Role: u['Role'], Phone: u['Phone'] || '', Email: u['Email'] || '', Birthday: u['Birthday'] || '' } };
}

function handleUpdateProfile(body) {
  var name = String(body.displayName || '').trim();
  if (!name) return { success: false, message: '姓名不能空白' };
  var email = String(body.email || '').trim();
  if (email && (email.indexOf('@') < 1 || email.indexOf('.', email.indexOf('@')) < 0 || email.indexOf(' ') > -1)) return { success: false, message: 'Email 格式不正確' };
  var birthday = String(body.birthday || '').trim();
  if (birthday && !isDateStr(birthday)) return { success: false, message: '生日格式要是 YYYY-MM-DD' };
  var row = findUserRowIndex_(body._user.username);
  if (row === -1) return { success: false, message: '帳號不存在' };
  updateRowFields(SHEET_USERS, row, { DisplayName: name, Phone: String(body.phone || '').trim(), Email: email, Birthday: birthday });
  // 登入中的 token 也換成新姓名，畫面與之後新增的資料才會用新名字
  var cache = CacheService.getScriptCache();
  cache.put('token_' + body.token, JSON.stringify({ username: body._user.username, displayName: name, deviceId: body._user.deviceId || '' }), 21600);
  return { success: true, displayName: name };
}

function handleChangePassword(body) {
  var u = findUserRow_(body._user.username);
  if (!u || u['PasswordHash'] !== sha256(String(body.oldPassword || ''))) return { success: false, message: '目前的密碼不正確' };
  var np = String(body.newPassword || '');
  if (np.length < 6) return { success: false, message: '新密碼至少要 6 個字' };
  updateRowFields(SHEET_USERS, findUserRowIndex_(body._user.username), { PasswordHash: sha256(np) });
  return { success: true };
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
// 選型計算型錄：把原本公開型錄的 4 個分頁（GigE / USB3 / FA鏡頭 / 遠心鏡頭）完整複製到自己的試算表，
// 欄位與內容一模一樣；之後選型計算改讀這 4 個分頁，可以自己直接補資料、修改。
// 只補缺的：公司型號已存在的列完全不動，所以自己改過的內容不會被覆蓋。
// ------------------------------------------------------------
var CALC_SHEETS = [
  { name: 'GigE', kind: 'camera' },
  { name: 'USB3', kind: 'camera' },
  { name: 'FA鏡頭', kind: 'fa' },
  { name: '遠心鏡頭', kind: 'tele' },
];

/** 遠心鏡頭分頁在原本 12 欄之後多出來的德鴻官網規格欄位。 */
var TELE_EXTRA_COLS = ['遠心度', '光學畸變', '光圈', 'MTF>0.3 (LP/MM)', '相機接口', '分辨率(um)', '視野 2/3"', '視野 1"', '視野 1.1"', '視野 1/2"', '視野 1/3"', '資料來源'];

function calcSheetKeyCol_(header) {
  return catalogCol_(header, '公司型號');
}

/** 取得分頁（沒有就建立），確保標題列有 needed 這些欄位（缺的補在最後面）。回傳最新標題列。 */
function ensureCalcSheetColumns_(sheet, needed) {
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var missing = needed.filter(function (c) {
    return header.indexOf(c) === -1;
  });
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, header.length + 1, 1, missing.length).setNumberFormat('@');
    header = header.concat(missing);
  }
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#eef2f7');
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return header;
}

function writeCalcRows_(sheet, header, rows) {
  if (!rows.length) return;
  var values = rows.map(function (r) {
    var out = [];
    for (var i = 0; i < header.length; i++) out.push(r[i] === undefined || r[i] === null ? '' : String(r[i]));
    return out;
  });
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, values.length, header.length);
  range.setNumberFormat('@'); // 文字格式：避免 1/2" 之類被轉成日期、640X480 被亂轉型
  range.setValues(values);
}

/** 從公開型錄複製（只補缺的列）。回傳每個分頁新增的筆數。 */
function copyCalcCatalog_(log) {
  var sheetId = getConfig('CatalogSheetId') || DEFAULT_CATALOG_SHEET_ID;
  var ss = getDb_(false);
  var summary = [];
  CALC_SHEETS.forEach(function (cs) {
    var rows;
    try {
      rows = fetchCatalogTab_(sheetId, cs.name);
    } catch (e) {
      summary.push(cs.name + '失敗：' + e.message);
      return;
    }
    if (rows.length < 2) return;
    var sheet = ss.getSheetByName(cs.name) || ss.insertSheet(cs.name);
    var srcHeader = rows[0].map(String);
    while (srcHeader.length && !String(srcHeader[srcHeader.length - 1]).trim()) srcHeader.pop(); // 去掉來源標題列尾端的空白欄
    var existingCols = sheet.getLastColumn();
    var header = existingCols > 0 ? sheet.getRange(1, 1, 1, existingCols).getValues()[0].map(String) : [];
    var fresh = header.join('') === '';
    if (fresh) {
      sheet.getRange(1, 1, 1, srcHeader.length).setValues([srcHeader]);
      sheet.getRange(1, 1, 1, srcHeader.length).setNumberFormat('@');
      header = srcHeader;
    }
    header = ensureCalcSheetColumns_(sheet, cs.kind === 'tele' ? srcHeader.concat(TELE_EXTRA_COLS) : srcHeader);

    var keyCol = calcSheetKeyCol_(header);
    var have = {};
    if (sheet.getLastRow() > 1 && keyCol > -1) {
      sheet.getRange(2, keyCol + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
        have[String(r[0]).trim().toUpperCase()] = true;
      });
    }
    var srcKey = calcSheetKeyCol_(srcHeader);
    var toAdd = [];
    rows.slice(1).forEach(function (r) {
      var key = srcKey > -1 ? String(r[srcKey]).trim().toUpperCase() : '';
      if (!key || have[key]) return; // 沒有公司型號的列（空白列或雜訊）不複製，已存在的不重複
      // 來源欄位 → 我的分頁欄位（用欄名對應，我的分頁欄位順序被改過也不會錯位）
      var out = [];
      srcHeader.forEach(function (h, i) {
        var idx = header.indexOf(h);
        if (idx > -1) out[idx] = r[i];
      });
      if (key) have[key] = true;
      toAdd.push(out);
    });
    writeCalcRows_(sheet, header, toAdd);
    summary.push(cs.name + ' +' + toAdd.length);
  });
  if (log) log.push('選型計算型錄複製到自己的試算表（' + summary.join('、') + '）；之後選型計算讀這 4 個分頁，可直接編修');
  return summary;
}

function handleSyncCalcCatalog(body) {
  var summary = copyCalcCatalog_(null);
  return { success: true, message: '已同步選型計算型錄（' + summary.join('、') + '）' };
}

/** 選型計算頁用：回傳 4 個分頁的標題列與全部資料列（純文字）。分頁還沒建立就是空的。 */
function handleGetCalcCatalog(body) {
  var ss = getDb_(false);
  var out = {};
  CALC_SHEETS.forEach(function (cs) {
    var sheet = ss.getSheetByName(cs.name);
    var data = sheet && sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
    out[cs.name] = {
      header: data.length ? data[0].map(String) : [],
      rows: data.slice(1).filter(function (r) {
        return r.join('').trim() !== '';
      }).map(function (r) {
        return r.map(String);
      }),
    };
  });
  return { success: true, catalog: out };
}

/** 德鴻官網欄位 → 遠心鏡頭分頁的一列。解析度欄位官網沒有 MP 值，依支援的最大靶面估算（1.1"→20、1"→12、其他→5）。 */
function dehongToTeleRecord_(it) {
  var f = it.fields;
  var best = null;
  var bestSize = 0;
  Object.keys(f).forEach(function (k) {
    if (dehongIsEmptyValue_(f[k])) return;
    var m = k.match(/(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?"/);
    if (!m) return;
    var size = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
    if (size > bestSize) {
      bestSize = size;
      best = m[0];
    }
  });
  function pick(prefix) {
    var found = '';
    Object.keys(f).forEach(function (k) {
      if (k.indexOf(prefix) === 0 && !dehongIsEmptyValue_(f[k])) found = f[k];
    });
    return found;
  }
  var mp = bestSize >= 1.05 ? '20' : bestSize >= 0.95 ? '12' : '5';
  return {
    '原廠名稱': '德鴻',
    '原廠型號': it.title,
    '鏡頭系列': f['解析度'] || '',
    '公司型號': it.title,
    '解析度': best ? mp : '',
    '放大倍率': f['放大倍數'] || '',
    '工作距離': f['物距'] || '',
    '景深': f['景深'] || '',
    '軸': f['軸'] || '',
    '感測器尺寸': best || '',
    '購物連結': DEHONG_BASE + it.url,
    '遠心度': f['遠心度'] || '',
    '光學畸變': f['光學畸變'] || '',
    '光圈': f['光圈'] || '',
    'MTF>0.3 (LP/MM)': f['MTF>0.3 (LP/MM)'] || '',
    '相機接口': f['相機接口'] || '',
    '分辨率(um)': f['分辨率'] || '',
    '視野 2/3"': pick('2/3"'),
    '視野 1"': pick('1" '),
    '視野 1.1"': pick('1.1"'),
    '視野 1/2"': pick('1/2"'),
    '視野 1/3"': pick('1/3"'),
    '資料來源': '德鴻官網',
  };
}

/** 把德鴻遠心鏡頭規格寫進「遠心鏡頭」分頁（公司型號沒有才新增；已有的列只補空白的德鴻欄位）。 */
function appendDehongToTeleSheet_(items) {
  if (!items.length) return 0;
  var ss = getDb_(false);
  var sheet = ss.getSheetByName('遠心鏡頭') || ss.insertSheet('遠心鏡頭');
  var base = ['原廠名稱', '原廠型號', '鏡頭系列', '公司型號', '解析度', '放大倍率', '工作距離', '景深', '軸', '感測器尺寸', '鏡頭類型', '購物連結'];
  var header = ensureCalcSheetColumns_(sheet, sheet.getLastColumn() > 0 ? TELE_EXTRA_COLS : base.concat(TELE_EXTRA_COLS));
  // 欄名可能是「原廠名稱\nOriginal Company」這種中英文連在一起，用關鍵字找欄
  function colOf(name) {
    var exact = header.indexOf(name);
    return exact > -1 ? exact : catalogCol_(header, name);
  }
  var keyCol = colOf('公司型號');
  var rowByKey = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, keyCol + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r, i) {
      rowByKey[String(r[0]).trim().toUpperCase()] = i + 2;
    });
  }
  var toAdd = [];
  var added = 0;
  items.forEach(function (it) {
    var rec = dehongToTeleRecord_(it);
    if (!(Number(rec['放大倍率']) > 0)) return; // 沒有倍率就沒辦法拿來選型
    var key = it.title.toUpperCase();
    if (rowByKey[key] === -1) return; // 這次已經加過同型號
    if (rowByKey[key]) {
      TELE_EXTRA_COLS.forEach(function (c) {
        var col = colOf(c);
        if (col > -1 && rec[c] && !sheet.getRange(rowByKey[key], col + 1).getValue()) sheet.getRange(rowByKey[key], col + 1).setValue(rec[c]);
      });
      return;
    }
    var out = [];
    Object.keys(rec).forEach(function (k) {
      var col = colOf(k);
      if (col > -1) out[col] = rec[k];
    });
    rowByKey[key] = -1;
    toAdd.push(out);
    added++;
  });
  writeCalcRows_(sheet, header, toAdd);
  return added;
}

// ------------------------------------------------------------
// 從德鴻視覺官網（twdehong.com）抓產品規格：遠心鏡頭 / 機器視覺鏡頭 / 光源 / 光源控制器
// 官網是 Joomla + K2，分類列表頁(每頁 50 筆)已經直接列出每個產品的規格欄位，不用逐筆進內頁。
// 只抓公開的型號與規格，不抓價格（官網沒有，價格要自己詢價）。重複執行安全：已存在的型號不會新增，
// 只會幫已存在、但還沒有規格的產品補上 Specs / SourceUrl。
// 還沒抓的：相機（要逐系列進內頁）、FA 鏡頭（系列頁）、光學棱鏡。
// ------------------------------------------------------------
var DEHONG_BASE = 'https://twdehong.com';
var DEHONG_RUN_LIMIT_MS = 5 * 60 * 1000;

/** 網址路徑第 3 段（/index.php/<區>/...）決定分類。 */
function dehongKind_(url) {
  var seg = decodeURIComponent(String(url).split('/')[2] || '');
  if (seg === 'light-source') return { category: '光源', label: '光源' };
  if (seg === 'control-products') return { category: '調光器', label: '光源控制器' };
  if (['wtl', 'wtl-x', 'special-lens', '機器視覺鏡頭', '高分辨率遠心鏡頭'].indexOf(seg) > -1) return { category: '鏡頭', label: '遠心鏡頭' };
  if (seg === '光學棱鏡') return { category: '其他', label: '光學棱鏡' };
  if (seg === 'optical-products') return { category: '鏡頭', label: '遠心鏡頭' };
  return null;
}

function htmlDecode_(str) {
  return String(str || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
    .replace(/&amp;/g, '&')
    .trim();
}

/** 解析 K2 分類列表頁：回傳 [{url, title, fields:{標籤:值}}]。 */
function parseDehongItems_(html) {
  var items = [];
  var blocks = html.split(/<div[^>]*class="catItemView/);
  for (var i = 1; i < blocks.length; i++) {
    var blk = blocks[i];
    var m = blk.match(/<h3 class="catItemTitle">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!m) continue;
    var fields = {};
    var re = /catItemExtraFieldsLabel">([\s\S]*?)<\/span>\s*<span class="catItemExtraFieldsValue">([\s\S]*?)<\/span>/g;
    var f;
    while ((f = re.exec(blk)) !== null) fields[htmlDecode_(f[1])] = htmlDecode_(f[2]);
    items.push({ url: m[1], title: htmlDecode_(m[2]), fields: fields });
  }
  return items;
}

/** K2 商品內頁 → {url, title, fields}（欄位來自「附加資訊」；沒有的話改用規格表）。分類列表沒列出的商品用這個補抓。 */
function parseDehongItemPage_(html, url) {
  var t = html.match(/<h2 class="itemTitle">\s*([\s\S]*?)\s*<\/h2>/);
  var title = t ? htmlDecode_(t[1]) : '';
  if (!title) {
    var pt = html.match(/<title>([\s\S]*?)<\/title>/);
    title = pt ? htmlDecode_(pt[1]).replace(/^.*?\s-\s/, '').trim() : '';
  }
  var fields = {};
  var re = /itemExtraFieldsLabel">([\s\S]*?)<\/span>\s*<span class="itemExtraFieldsValue">([\s\S]*?)<\/span>/g;
  var f;
  while ((f = re.exec(html)) !== null) fields[htmlDecode_(f[1]).replace(/[:：]\s*$/, '')] = htmlDecode_(f[2]);
  if (!Object.keys(fields).length) fields = parseDehongSpecPairs_(html);
  return { url: url, title: title, fields: fields };
}

function fetchDehongPage_(path) {
  var url = path.indexOf('http') === 0 ? path : DEHONG_BASE + encodeURI(decodeURI(path));
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' ' + path);
  return res.getContentText('UTF-8');
}

function dehongIsEmptyValue_(v) {
  return !v || /^(NA|N\/A|--+|-|無)$/i.test(v);
}

function dehongSpecSummary_(fields) {
  var parts = [];
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    if (dehongIsEmptyValue_(v)) return;
    if (k === '解析度' && v === 'WTL') return; // 型號系列代碼，不是解析度
    parts.push(k + ' ' + v);
  });
  return parts.join('，');
}


// ---- 第二階段：相機（表格）、FA 鏡頭系列頁、液態鏡頭、重複資料檢查 ----

/** 解析頁面裡所有 <table>：回傳 [ [ [儲存格文字...] ...列 ] ...表格 ]。 */
function parseHtmlTables_(html) {
  var tables = [];
  var tre = /<table[\s\S]*?<\/table>/gi;
  var m;
  while ((m = tre.exec(html)) !== null) {
    var rows = [];
    var rre = /<tr[\s\S]*?<\/tr>/gi;
    var r;
    while ((r = rre.exec(m[0])) !== null) {
      var cells = [];
      var cre = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      var c;
      while ((c = cre.exec(r[0])) !== null) cells.push(htmlDecode_(c[1]).replace(/\s+/g, ' '));
      if (cells.join('')) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function headerCol_(header, keywords) {
  for (var i = 0; i < header.length; i++) {
    for (var k = 0; k < keywords.length; k++) {
      if (String(header[i]).toLowerCase().indexOf(keywords[k].toLowerCase()) > -1) return i;
    }
  }
  return -1;
}

/** 相機規格表 → [{model, w, h, fps, sensor, iface, color, shutter, pixel, size, type}]；不是相機表就回傳空陣列。 */
function parseDehongCameraRows_(rows) {
  var h = rows[0];
  var iModel = headerCol_(h, ['型號', '型号']);
  var iRes = headerCol_(h, ['分辨率', '解析度']);
  if (iModel < 0 || iRes < 0) return [];
  var iFps = headerCol_(h, ['幀', '帧']);
  var iSensor = headerCol_(h, ['傳感器', '感光', '感測器', '感测器']);
  var iIface = headerCol_(h, ['接口', '介面']);
  var iColor = headerCol_(h, ['黑白', 'Mono']);
  var iShutter = headerCol_(h, ['快門', '快门']);
  var iPixel = headerCol_(h, ['Pixel']);
  var iSize = headerCol_(h, ['規格']);
  var iType = headerCol_(h, ['類型']);
  var out = [];
  rows.slice(1).forEach(function (r) {
    var model = String(r[iModel] || '').trim();
    var res = String(r[iRes] || '').match(/(\d{3,5})\D+?(\d{3,5})/);
    if (!model || !res) return;
    var colorText = iColor > -1 ? r[iColor] : '';
    var base = model.replace(/\(.*?\)/g, '');
    var color = /彩色|Color/i.test(colorText) ? '彩色' : /黑白|Mono/i.test(colorText) ? '黑白' : /M$/i.test(base) ? '黑白' : /C$/i.test(base) ? '彩色' : '';
    out.push({
      model: model,
      w: Number(res[1]),
      h: Number(res[2]),
      fps: iFps > -1 ? parseFloat(String(r[iFps]).replace(/[^0-9.]/g, '')) || '' : '',
      sensor: iSensor > -1 ? String(r[iSensor] || '').trim() : '',
      iface: iIface > -1 ? String(r[iIface] || '').trim() : '',
      color: color,
      shutter: iShutter > -1 ? String(r[iShutter] || '').trim() : '',
      pixel: iPixel > -1 ? String(r[iPixel] || '').trim() : '',
      size: iSize > -1 ? String(r[iSize] || '').trim() : '',
      type: iType > -1 ? String(r[iType] || '').trim() : '',
    });
  });
  return out;
}

function cameraBrand_(model) {
  if (/^MV-(CA|CE|CS|CU|CH|CL|CB|CC|ID|SC)/i.test(model)) return 'Hikrobot 海康威視';
  if (/^BFS-/i.test(model)) return 'FLIR';
  if (/^(ala|aca|a2a|boa)/i.test(model)) return 'Basler';
  if (/^(MV-)?(G|U|SU|EM)[A-Z]*\d/i.test(model)) return 'MindVision 邁德威視';
  return '德鴻代理品牌';
}

function normSensor_(name) {
  return String(name || '').toUpperCase().replace(/SONY|ON\s*SEMI|ONSEMI|CMOSIS|TELEDYNE|\s|-/g, '');
}

/** 找出相機頁面：從官網首頁出發，收集 industrial-camera / hk 底下的分類頁（海康、FLIR、Basler…）。 */
function discoverDehongCameraCats_(indexHtml, itemLinks) {
  var found = {};
  var queued = {};
  var queue = ['/index.php/hk', '/index.php/industrial-camera'];
  queue.forEach(function (q) {
    queued[q] = true;
  });
  var re = /href="(\/index\.php\/(?:industrial-camera|hk)\/itemlist\/category\/[^"#]+)"/g;
  var m;
  while ((m = re.exec(indexHtml)) !== null) {
    if (!queued[m[1]]) {
      queued[m[1]] = true;
      queue.push(m[1]);
    }
  }
  var guard = 0;
  while (queue.length && guard++ < 80) {
    var path = queue.shift();
    if (found[path]) continue;
    found[path] = true;
    try {
      var html = fetchDehongPage_(path);
      var sub = /href="(\/index\.php\/(?:industrial-camera|hk)\/itemlist\/category\/[^"#]+)"/g;
      var x;
      while ((x = sub.exec(html)) !== null) {
        if (!found[x[1]] && !queued[x[1]]) {
          queued[x[1]] = true;
          queue.push(x[1]);
        }
      }
      var itemRe = /href="(\/index\.php\/(?:industrial-camera|hk)\/item\/[^"#]+)"/g;
      var y;
      while ((y = itemRe.exec(html)) !== null) if (itemLinks) itemLinks[y[1]] = true;
    } catch (e) {
      // 單一分類抓不到就略過
    }
  }
  return Object.keys(found);
}

/** 讀自己的相機分頁，建立「感測器型號 → 像元尺寸/感測器尺寸」對照，沒給像元尺寸的相機可以借用同一顆感測器的資料。 */
function buildSensorLookup_() {
  var lookup = {};
  ['GigE', 'USB3'].forEach(function (name) {
    var sheet = getDb_(false).getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    var data = sheet.getDataRange().getValues();
    var h = data[0];
    var iName = catalogCol_(h, '感測器型號');
    var iPix = catalogCol_(h, '像元尺寸');
    var iSize = catalogCol_(h, '感測器尺寸');
    if (iName < 0 || iPix < 0) return;
    data.slice(1).forEach(function (r) {
      var key = normSensor_(r[iName]);
      if (key && String(r[iPix]).trim() && !lookup[key]) lookup[key] = { pixel: String(r[iPix]).trim(), size: iSize > -1 ? String(r[iSize]).trim() : '' };
    });
  });
  return lookup;
}

/**
 * 常見感測器的像元尺寸（µm）。官網沒有給、自己的型錄也查不到時才用，寫入時會在「資料來源」標註「依感測器型號推定，請核對」，
 * 方便你對照原廠規格書確認。不在這張表裡的感測器就留空，選型計算會略過（填上像元尺寸後自動加入）。
 */
var SENSOR_PIXEL_UM = {
  IMX250: 3.45, IMX252: 3.45, IMX253: 3.45, IMX255: 3.45, IMX264: 3.45, IMX265: 3.45, IMX267: 3.45, IMX273: 3.45, IMX296: 3.45, IMX297: 3.45, IMX304: 3.45, IMX342: 3.45,
  IMX174: 5.86, IMX249: 5.86, IMX178: 2.4, IMX183: 2.4, IMX226: 1.85, IMX290: 2.9, IMX430: 9, IMX432: 9, IMX411: 3.76, IMX455: 3.76, IMX540: 2.74, IMX545: 2.74,
  PYTHON300: 4.8, PYTHON500: 4.8, PYTHON1300: 4.8, PYTHON2000: 4.8, PYTHON5000: 4.8,
  CMV2000: 5.5, CMV4000: 5.5, MT9P031: 2.2, EV76C560: 5.3, EV76C661: 5.3, EV76C570: 5.3, ICX274: 4.4, ICX618: 5.6,
  XGS5000: 3.2, XGS12000: 3.2, GMAX0505: 2.5, GMAX2505: 2.5,
};

function inferPixelSize_(sensor) {
  var key = normSensor_(sensor);
  var names = Object.keys(SENSOR_PIXEL_UM).sort(function (a, b) {
    return b.length - a.length;
  });
  for (var i = 0; i < names.length; i++) if (key.indexOf(names[i]) === 0) return SENSOR_PIXEL_UM[names[i]];
  return '';
}

/** 把相機寫進「GigE」「USB3」分頁。像元尺寸依序：官網表格 → 自己型錄同款感測器 → 常見感測器對照（標註請核對）→ 留空（選型會略過，填上就自動加入）。 */
function appendDehongCamerasToSheets_(cams) {
  var ss = getDb_(false);
  var lookup = buildSensorLookup_();
  var plan = { GigE: [], USB3: [] };
  var skippedNoPixel = [];
  cams.forEach(function (c) {
    if (!c.iface) c.iface = /^BFS-U3/i.test(c.model) ? 'USB3.0' : /^BFS-(PGE|GE)/i.test(c.model) ? 'GigE' : ''; // FLIR 的表格沒有介面欄，從型號判斷
    var sheetName = /USB/i.test(c.iface) ? 'USB3' : /GigE/i.test(c.iface) ? 'GigE' : '';
    if (!sheetName) return; // Camera Link 等不在選型範圍
    var pixel = c.pixel;
    var size = c.size;
    var hit = lookup[normSensor_(c.sensor)];
    var srcName = c.sourceName || '德鴻官網';
    var source = srcName;
    if (!pixel && hit) {
      pixel = hit.pixel;
      if (!size) size = hit.size;
      source = srcName + '（像元尺寸取自自己型錄的同款感測器）';
    }
    if (!pixel) {
      var guess = inferPixelSize_(c.sensor);
      if (guess) {
        pixel = String(guess);
        source = srcName + '（像元尺寸依感測器型號推定，請核對）';
      }
    }
    if (pixel && /^[0-9.]+$/.test(pixel)) pixel = pixel + '*' + pixel + 'μm';
    plan[sheetName].push({ cam: c, pixel: pixel, size: size, source: source });
  });

  var added = 0;
  Object.keys(plan).forEach(function (sheetName) {
    if (!plan[sheetName].length) return;
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    var header = ensureCalcSheetColumns_(sheet, sheet.getLastColumn() > 0 ? ['資料來源'] : ['原廠名稱', '原廠型號', '公司型號', '畫素', '黑白/彩色', '感測器類型', '感測器型號', '像元尺寸', '感測器尺寸', '曝光方式', '解析度', '偵率', '資料介面', '購物連結', '資料來源']);
    function colOf(name) {
      var ex = header.indexOf(name);
      return ex > -1 ? ex : catalogCol_(header, name);
    }
    var keyCol = colOf('公司型號');
    var have = {};
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, keyCol + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
        have[String(r[0]).trim().toUpperCase()] = true;
      });
    }
    var rowsOut = [];
    plan[sheetName].forEach(function (p) {
      var key = p.cam.model.toUpperCase();
      if (have[key]) return;
      have[key] = true;
      if (!p.pixel) skippedNoPixel.push(p.cam.model);
      var rec = {
        '原廠名稱': p.cam.brand || cameraBrand_(p.cam.model),
        '原廠型號': p.cam.model,
        '公司型號': p.cam.model,
        '畫素': String(Math.round((p.cam.w * p.cam.h) / 10000)),
        '黑白/彩色': p.cam.color,
        '感測器類型': p.cam.type,
        '感測器型號': p.cam.sensor,
        '像元尺寸': p.pixel,
        '感測器尺寸': p.size,
        '曝光方式': p.cam.shutter ? p.cam.shutter + (/快門$/.test(p.cam.shutter) ? '' : '快門') : '',
        '解析度': p.cam.w + 'X' + p.cam.h,
        '偵率': String(p.cam.fps),
        '資料介面': p.cam.iface,
        '購物連結': p.cam.link || DEHONG_BASE,
        '資料來源': p.source + (p.pixel ? '' : '（缺像元尺寸，填上才會納入選型）'),
      };
      var out = [];
      Object.keys(rec).forEach(function (k) {
        var col = colOf(k);
        if (col > -1) out[col] = rec[k];
      });
      rowsOut.push(out);
    });
    writeCalcRows_(sheet, header, rowsOut);
    added += rowsOut.length;
  });
  return { added: added, skippedNoPixel: skippedNoPixel };
}

/** K2 商品內頁的規格表（兩欄「欄位 / 值」，有時是三欄「分類 / 欄位 / 值」）→ {欄位: 值}。 */
function parseDehongSpecPairs_(html) {
  var out = {};
  parseHtmlTables_(html).forEach(function (rows) {
    var hasModel = rows.some(function (r) {
      return r.length >= 2 && r[r.length - 2] === '型號';
    });
    if (!hasModel) return;
    rows.forEach(function (r) {
      if (r.length < 2) return;
      var k = String(r[r.length - 2]).trim();
      var v = String(r[r.length - 1]).trim();
      if (k && v && !out.hasOwnProperty(k)) out[k] = v;
    });
  });
  return out;
}

/** 抓相機、FA 鏡頭系列、液態鏡頭，回傳要放進 Products 的資料列與選型相機清單。 */
function crawlDehongExtras_(indexHtml, errors, pagesRef) {
  var products = [];
  var cams = [];
  var seenCam = {};

  var camItemLinks = {};
  discoverDehongCameraCats_(indexHtml, camItemLinks).forEach(function (path) {
    var html;
    try {
      html = fetchDehongPage_(path);
    } catch (e) {
      errors.push(path + '（' + e.message + '）');
      return;
    }
    pagesRef.n++;
    parseHtmlTables_(html).forEach(function (rows) {
      parseDehongCameraRows_(rows).forEach(function (c) {
        if (seenCam[c.model.toUpperCase()]) return;
        seenCam[c.model.toUpperCase()] = true;
        cams.push(c);
        var spec = [c.color, c.shutter && c.shutter + '快門', c.iface, c.w + '×' + c.h, c.fps && c.fps + 'fps', c.sensor && '感測器 ' + c.sensor, c.pixel && '像元 ' + c.pixel + 'μm', c.size && '靶面 ' + c.size].filter(Boolean).join('，');
        products.push({
          InternalModel: c.model,
          SupplierModel: c.model,
          Category: '相機',
          Notes: '德鴻官網 相機（' + cameraBrand_(c.model) + '）；' + spec,
          SourceUrl: DEHONG_BASE + path,
          Specs: JSON.stringify({ 品牌: cameraBrand_(c.model), 解析度: c.w + 'x' + c.h, 幀率: c.fps, 感測器: c.sensor, 介面: c.iface, 黑白彩色: c.color, 快門: c.shutter, 像元尺寸: c.pixel, 靶面: c.size }),
        });
      });
    });
  });


  // 相機內頁（K2 商品頁）：海康讀碼器/智慧相機與舊款 MV-GE 系列，規格是「欄位 / 值」的兩欄表格
  Object.keys(camItemLinks).forEach(function (link) {
    var html;
    try {
      html = fetchDehongPage_(link);
    } catch (e) {
      errors.push(link + '（' + e.message + '）');
      return;
    }
    pagesRef.n++;
    var f = parseDehongSpecPairs_(html);
    var model = String(f['型號'] || parseDehongItemPage_(html, link).title || '').trim();
    if (!model || seenCam[model.toUpperCase()]) return;
    seenCam[model.toUpperCase()] = true;
    var isReader = /^MV-(ID|SC)/i.test(model);
    var res = String(f['解析度@幀率'] || f['解析度'] || '').match(/(\d{3,5})\D+?(\d{3,5})/);
    var fpsM = String(f['解析度@幀率'] || '').match(/@\s*([0-9.]+)/) || String(f['**處理幀率'] || '').match(/([0-9.]+)/);
    var nums = String(f['像元尺寸'] || '').match(/[0-9.]+/g);
    var pixel = nums && nums.length ? nums[0] + '*' + (nums[1] || nums[0]) + 'μm' : '';
    var sensorText = String(f['感測器'] || f['感測器類型'] || '').replace(/[”″]/g, '"');
    var sizeM = String(f['靶面尺寸'] || sensorText).match(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?"/);
    var colorText = String(f['相機類型'] || f['黑白/彩色'] || '');
    var color = /彩色|Color/i.test(colorText) ? '彩色' : /黑白|Mono/i.test(colorText) ? '黑白' : '';
    var iface = String(f['資料介面'] || '') || (!isReader && /^(MV-)?G[EM]/i.test(model) ? 'GigE' : '');
    products.push({
      InternalModel: model,
      SupplierModel: model,
      Category: '相機',
      Notes: '德鴻官網 ' + (isReader ? '海康讀碼器/智慧相機' : '相機（' + cameraBrand_(model) + '）') + '；' + dehongSpecSummary_(f),
      SourceUrl: DEHONG_BASE + link,
      Specs: JSON.stringify(f),
    });
    if (!isReader && res && iface) {
      cams.push({
        model: model,
        w: Number(res[1]),
        h: Number(res[2]),
        fps: fpsM ? parseFloat(fpsM[1]) : '',
        sensor: '',
        iface: iface,
        color: color,
        shutter: String(f['快門類型'] || '').replace(/全域/, '全局'),
        pixel: pixel ? pixel.replace(/μm$/, '') : '',
        size: sizeM ? sizeM[0] : '',
        type: /CMOS/i.test(sensorText) ? 'CMOS' : /CCD/i.test(sensorText) ? 'CCD' : '',
      });
    }
  });

  // FA 鏡頭：官網只有系列頁（例如 1" 5MP），沒有單一型號，內部型號留空請自己補
  try {
    var faHtml = fetchDehongPage_('/index.php/fa-cctv-lens');
    pagesRef.n++;
    var faLinks = {};
    var lr = /href="(\/index\.php\/fa-cctv-lens\/item\/[^"#]+)"/g;
    var lm;
    while ((lm = lr.exec(faHtml)) !== null) faLinks[lm[1]] = true;
    Object.keys(faLinks).forEach(function (link) {
      var html;
      try {
        html = fetchDehongPage_(link);
      } catch (e) {
        errors.push(link + '（' + e.message + '）');
        return;
      }
      pagesRef.n++;
      var title = htmlDecode_((html.match(/<h2 class="itemTitle">([\s\S]*?)<\/h2>/) || html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/\s*-.*$/, '').trim();
      var specRow = null;
      parseHtmlTables_(html).forEach(function (rows) {
        if (!specRow && rows.length > 1 && headerCol_(rows[0], ['焦距']) > -1 && headerCol_(rows[0], ['F/NO']) > -1) specRow = { h: rows[0], r: rows[1] };
      });
      if (!title) return;
      var fields = {};
      if (specRow) specRow.h.forEach(function (name, i) {
        fields[name] = specRow.r[i];
      });
      products.push({
        InternalModel: '',
        SupplierModel: 'DHC FA ' + title,
        Category: '鏡頭',
        Notes: '德鴻官網 DHC FA 鏡頭系列（官網沒有單一型號，請補內部型號）；' + dehongSpecSummary_(fields),
        SourceUrl: DEHONG_BASE + link,
        Specs: JSON.stringify(fields),
      });
    });
  } catch (e) {
    errors.push('FA 鏡頭（' + e.message + '）');
  }

  // 液態鏡頭：頁面直接列出兩張型號表（FA 型 / 遠心型）
  try {
    var liquidHtml = fetchDehongPage_('/index.php/liquid-lens');
    pagesRef.n++;
    parseHtmlTables_(liquidHtml).forEach(function (rows) {
      if (rows.length < 2 || headerCol_(rows[0], ['型號']) !== 0 || headerCol_(rows[0], ['推薦使用工作距離']) < 0) return;
      rows.slice(1).forEach(function (r) {
        var model = String(r[0] || '').trim();
        if (!model) return;
        var fields = {};
        rows[0].forEach(function (name, i) {
          if (name !== '查看詳情') fields[name] = r[i];
        });
        products.push({
          InternalModel: model,
          SupplierModel: model,
          Category: '鏡頭',
          Notes: '德鴻官網 液態鏡頭；' + dehongSpecSummary_(fields),
          SourceUrl: DEHONG_BASE + '/index.php/liquid-lens',
          Specs: JSON.stringify(fields),
        });
      });
    });
  } catch (e) {
    errors.push('液態鏡頭（' + e.message + '）');
  }
  return { products: products, cams: cams };
}

// ---- 重複資料檢查 / 排除 ----
function normKey_(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
}

/** 同一張表裡依 keyFn 分組，找出重複的列。回傳 [{key, rows:[列號...]}]（列號由小到大）。 */
function findDuplicateGroups_(data, keyFn) {
  var groups = {};
  for (var i = 1; i < data.length; i++) {
    var k = keyFn(data[i]);
    if (!k) continue;
    (groups[k] = groups[k] || []).push(i + 1);
  }
  return Object.keys(groups)
    .filter(function (k) {
      return groups[k].length > 1;
    })
    .map(function (k) {
      return { key: k, rows: groups[k] };
    });
}

/** 保留資料最完整的那一列，把其他重複列有填、保留列空白的欄位補進去，再刪掉多的列。回傳刪除筆數。 */
function mergeDuplicateGroups_(sheet, data, groups) {
  var toDelete = [];
  groups.forEach(function (g) {
    var best = g.rows[0];
    var bestScore = -1;
    g.rows.forEach(function (rn) {
      var row = data[rn - 1];
      var score = row.filter(function (v) {
        return String(v).trim() !== '';
      }).length;
      if (score > bestScore) {
        bestScore = score;
        best = rn;
      }
    });
    var keeper = data[best - 1].slice();
    g.rows.forEach(function (rn) {
      if (rn === best) return;
      data[rn - 1].forEach(function (v, c) {
        if (String(keeper[c]).trim() === '' && String(v).trim() !== '') keeper[c] = v;
      });
      toDelete.push(rn);
    });
    sheet.getRange(best, 1, 1, keeper.length).setValues([keeper]);
  });
  toDelete.sort(function (a, b) {
    return b - a;
  });
  toDelete.forEach(function (rn) {
    sheet.deleteRow(rn);
  });
  return toDelete.length;
}

/** apply=false 只檢查回報；apply=true 才真的合併刪除。產品與選型計算 4 個分頁自動處理，客戶只回報（因為案件用公司名稱關聯）。 */
function handleDedupeData(body) {
  var apply = !!body.apply;
  var ss = getDb_(false);
  var report = [];
  var removed = 0;

  var targets = [{ name: SHEET_PRODUCTS, keyOf: function (h) {
    var iM = h.indexOf('InternalModel');
    var iS = h.indexOf('SupplierModel');
    return function (r) {
      return normKey_(r[iM]) || normKey_(r[iS]);
    };
  } }];
  CALC_SHEETS.forEach(function (cs) {
    targets.push({ name: cs.name, keyOf: function (h) {
      var i = calcSheetKeyCol_(h);
      return function (r) {
        return i > -1 ? normKey_(r[i]) : '';
      };
    } });
  });

  targets.forEach(function (t) {
    var sheet = ss.getSheetByName(t.name);
    if (!sheet || sheet.getLastRow() < 3) return;
    var data = sheet.getDataRange().getValues();
    var groups = findDuplicateGroups_(data, t.keyOf(data[0].map(String)));
    if (!groups.length) return;
    var extra = groups.reduce(function (n, g) {
      return n + g.rows.length - 1;
    }, 0);
    report.push({ sheet: t.name, groups: groups.length, extra: extra, examples: groups.slice(0, 5).map(function (g) {
      return g.key + '（' + g.rows.length + ' 筆）';
    }) });
    if (apply) removed += mergeDuplicateGroups_(sheet, data, groups);
  });

  var cust = [];
  var cs = ss.getSheetByName(SHEET_CUSTOMERS);
  if (cs && cs.getLastRow() > 2) {
    var cdata = cs.getDataRange().getValues();
    var ci = cdata[0].indexOf('CompanyName');
    var cg = findDuplicateGroups_(cdata, function (r) {
      return String(r[ci]).replace(/[\s()（）]|股份有限公司|有限公司|\(股\)|公司$/g, '').toUpperCase();
    });
    cust = cg.map(function (g) {
      return g.rows.map(function (rn) {
        return cdata[rn - 1][ci];
      }).join(' / ');
    });
  }
  return { success: true, apply: apply, report: report, removed: removed, customerSuspects: cust };
}

/**
 * opts.stage：'lists'（K2 分類列表，每次最多讀 DEHONG_CHUNK_MS 毫秒，回傳 nextOffset 讓前端接著呼叫）
 *           或 'extras'（相機表格、FA 系列、液態鏡頭）。分段執行才不會因為單次執行太久被 Apps Script 中斷。
 */
var DEHONG_CHUNK_MS = 150 * 1000;

function importDehongProducts_(log, opts) {
  opts = opts || { stage: 'lists', offset: 0 };
  var stage = opts.stage || 'lists';
  var offset = Number(opts.offset) || 0;
  var started = new Date().getTime();
  var indexHtml = fetchDehongPage_('/index.php');
  var catSet = {};
  var re = /href="(\/index\.php\/[^"#]*itemlist\/category\/[^"#]+)"/g;
  var m;
  while ((m = re.exec(indexHtml)) !== null) {
    if (dehongKind_(m[1])) catSet[m[1]] = true;
  }
  // 首頁選單沒有列出全部分類（例如光學產品底下的 CHL 鏡頭），再從各大類的首頁補抓
  ['/index.php/optical-products', '/index.php/special-lens', '/index.php/wtl', '/index.php/wtl-x', '/index.php/light-source', '/index.php/control-products', '/index.php/機器視覺鏡頭', '/index.php/高分辨率遠心鏡頭', '/index.php/光學棱鏡'].forEach(function (top) {
    try {
      var topHtml = fetchDehongPage_(top);
      var tm;
      var tre = /href="(\/index\.php\/[^"#]*itemlist\/category\/[^"#]+)"/g;
      while ((tm = tre.exec(topHtml)) !== null) if (dehongKind_(tm[1])) catSet[tm[1]] = true;
    } catch (e) {
      // 單一大類頁面抓不到就略過，其餘照常
    }
  });
  var cats = Object.keys(catSet).sort();
  var totalCats = cats.length;
  var nextOffset = totalCats;
  var doneLists = true;

  var existing = sheetToObjects(SHEET_PRODUCTS).rows;
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['Specs'] };
    });
  });

  var seen = {};
  var itemLinks = {};
  var teleItems = [];
  var newRows = [];
  var added = 0;
  var enriched = 0;
  var pages = 0;
  var incomplete = false;
  var errors = [];

  for (var c = offset; stage === 'lists' && c < cats.length; c++) {
    if (c > offset && new Date().getTime() - started > DEHONG_CHUNK_MS) {
      nextOffset = c;
      doneLists = false;
      break;
    }
    var start = 0;
    while (true) {
      var items;
      var lastListHtml = '';
      try {
        lastListHtml = fetchDehongPage_(cats[c] + (start ? '?start=' + start : ''));
        items = parseDehongItems_(lastListHtml);
      } catch (e) {
        errors.push(cats[c] + '（' + e.message + '）');
        break;
      }
      pages++;
      var listHtml = lastListHtml;
      var ir = /href="(\/index\.php\/[^"#]*\/item\/[^"#]+)"/g;
      var im;
      while ((im = ir.exec(listHtml)) !== null) itemLinks[decodeURIComponent(im[1])] = im[1];
      items.forEach(function (it) {
        var kind = dehongKind_(it.url);
        if (!kind || !it.title || seen[it.url]) return;
        seen[it.url] = true;
        var key = it.title.toUpperCase();
        if (kind.label === '遠心鏡頭') teleItems.push(it);
        var specsJson = JSON.stringify(it.fields);
        var hit = byModel[key];
        if (hit) {
          if (!hit.specs) {
            updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: specsJson, SourceUrl: DEHONG_BASE + it.url });
            hit.specs = specsJson;
            enriched++;
          }
          return;
        }
        newRows.push({
          InternalModel: it.title,
          SupplierModel: it.title,
          Supplier: '德鴻',
          SupplierContact: '陳小姐',
          SupplierContactEmail: 'TWDH@twdehong.com',
          Origin: '台灣',
          Category: kind.category,
          Notes: '德鴻官網 ' + kind.label + '；' + dehongSpecSummary_(it.fields),
          LastUpdated: todayStr(),
          SourceUrl: DEHONG_BASE + it.url,
          Specs: specsJson,
        });
        byModel[key] = { row: -1, specs: specsJson };
        added++;
      });
      if (items.length < 50) break;
      start += 50;
    }
  }

  // 分類列表沒有直接列出、只出現在連結裡的商品：逐一進內頁補抓
  if (stage === 'lists') {
    var seenDecoded = {};
    Object.keys(seen).forEach(function (u) {
      seenDecoded[decodeURIComponent(u)] = true;
    });
    Object.keys(itemLinks).forEach(function (dec) {
      if (seenDecoded[dec] || !dehongKind_(dec) || dec.indexOf('/fa-cctv-lens/') > -1) return;
      if (new Date().getTime() - started > DEHONG_CHUNK_MS + 60000) return;
      try {
        var it2 = parseDehongItemPage_(fetchDehongPage_(itemLinks[dec]), itemLinks[dec]);
        pages++;
        if (!it2.title) return;
        var kind2 = dehongKind_(it2.url);
        seen[it2.url] = true;
        var key2 = it2.title.toUpperCase();
        if (kind2.label === '遠心鏡頭') teleItems.push(it2);
        if (byModel[key2]) return;
        newRows.push({
          InternalModel: it2.title,
          SupplierModel: it2.title,
          Supplier: '德鴻',
          SupplierContact: '陳小姐',
          SupplierContactEmail: 'TWDH@twdehong.com',
          Origin: '台灣',
          Category: kind2.category,
          Notes: '德鴻官網 ' + kind2.label + '；' + (Object.keys(it2.fields).length ? dehongSpecSummary_(it2.fields) : '官網只有型號與圖片，沒有規格表'),
          LastUpdated: todayStr(),
          SourceUrl: DEHONG_BASE + it2.url,
          Specs: JSON.stringify(it2.fields),
        });
        byModel[key2] = { row: -1, specs: '1' };
        added++;
      } catch (e) {
        errors.push(dec + '（' + e.message + '）');
      }
    });
  }

  // 第二階段：相機表格、FA 鏡頭系列、液態鏡頭（頁面內容是表格，不是 K2 商品列表）
  var camAdded = { added: 0, skippedNoPixel: [] };
  var extraCount = 0;
  if (stage === 'extras') {
    var pagesRef = { n: 0 };
    var extra = crawlDehongExtras_(indexHtml, errors, pagesRef);
    pages += pagesRef.n;
    extra.products.forEach(function (rec) {
      var key = (rec.InternalModel || rec.SupplierModel).toUpperCase();
      var hit = byModel[key];
      if (hit) {
        if (!hit.specs && hit.row > 0) {
          updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: rec.Specs, SourceUrl: rec.SourceUrl });
          hit.specs = rec.Specs;
          enriched++;
        }
        return;
      }
      rec.Supplier = '德鴻';
      rec.SupplierContact = '陳小姐';
      rec.SupplierContactEmail = 'TWDH@twdehong.com';
      rec.Origin = rec.Category === '相機' ? '' : '台灣';
      rec.LastUpdated = todayStr();
      newRows.push(rec);
      byModel[key] = { row: -1, specs: rec.Specs };
      added++;
      extraCount++;
    });
    camAdded = appendDehongCamerasToSheets_(extra.cams);
  }

  // 一次寫入全部新產品（逐筆 appendRow 一千多筆會超過執行時間上限）
  if (newRows.length) {
    var sheet = getSheet(SHEET_PRODUCTS);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var values = newRows.map(function (obj) {
      return header.map(function (h) {
        return obj.hasOwnProperty(h) ? obj[h] : '';
      });
    });
    var startRow = sheet.getLastRow() + 1;
    var range = sheet.getRange(startRow, 1, values.length, header.length);
    range.setNumberFormat('@');
    range.setValues(values);
  }

  var teleAdded = appendDehongToTeleSheet_(teleItems);
  var msg = '德鴻官網匯入：新增 ' + added + ' 筆產品（含相機/FA 鏡頭系列/液態鏡頭 ' + extraCount + ' 筆）、替 ' + enriched + ' 筆既有產品補上規格；選型計算分頁：遠心鏡頭 +' + teleAdded + '、相機 +' + camAdded.added + '（共讀取 ' + pages + ' 頁；官網沒有價格，底價請自己詢價後填入）';
  if (camAdded.skippedNoPixel.length) msg += '；' + camAdded.skippedNoPixel.length + ' 款相機官網沒有像元尺寸、也查不到同款感測器，已寫進相機分頁但像元尺寸留空，選型計算會略過，請補上像元尺寸後才會納入';
  if (errors.length) msg += '；失敗：' + errors.slice(0, 3).join('、');
  if (log) log.push(msg);
  return { added: added, enriched: enriched, teleAdded: teleAdded, camAdded: camAdded.added, incomplete: !doneLists, done: doneLists, nextOffset: nextOffset, totalCats: totalCats, pages: pages, skippedNoPixel: camAdded.skippedNoPixel.length, errors: errors.slice(0, 3), message: msg };
}

function handleImportDehongProducts(body) {
  var r = importDehongProducts_(null, { stage: body.stage === 'extras' ? 'extras' : 'lists', offset: body.offset });
  return { success: true, added: r.added, enriched: r.enriched, teleAdded: r.teleAdded, camAdded: r.camAdded, done: r.done, nextOffset: r.nextOffset, totalCats: r.totalCats, pages: r.pages, skippedNoPixel: r.skippedNoPixel, errors: r.errors, message: r.message };
}

// ------------------------------------------------------------
// FLIR 官網爬蟲
//  ① www.flir.com/en-asia：熱像機器視覺相機、研發/科學相機、研發鏡頭、多相機視覺系統（規格表在商品頁的 <table>）
//  ② FLIR 的可見光工業相機（Blackfly S、Oryx、Chameleon3、Grasshopper3、Firefly、Flea3、Dragonfly S、Forge…）
//     已經轉由 Teledyne Vision Solutions 銷售，flir.com 上已經沒有這些商品頁，改讀
//     www.teledynevisionsolutions.com 每個型號頁內嵌的規格資料（JSON-LD：解析度、像元尺寸、靶面、介面…），
//     可以直接進選型計算的 GigE / USB3 分頁。
// 只抓公開規格，不抓價格。FLIR 官網沒有光源類產品。
// ------------------------------------------------------------
var FLIR_BASE = 'https://www.flir.com';
var TELEDYNE_BASE = 'https://www.teledynevisionsolutions.com';
var FLIR_THERMAL_CATS = [
  { path: '/en-asia/browse/thermal-machine-vision/thermal-machine-vision-cameras/', category: '相機', label: '熱像機器視覺相機' },
  { path: '/en-asia/browse/research--science/research--science-cameras/', category: '相機', label: '研發/科學相機' },
  { path: '/en-asia/browse/research--science/rd-lenses/', category: '鏡頭', label: '研發鏡頭' },
  { path: '/en-asia/browse/continuous-monitoring/multicamera-vision-systems/', category: '相機', label: '多相機視覺系統' },
];
var FLIR_SKIP_PRODUCT = /housing|warranty|cable|power-supply|charger|battery|filter-holder|software|image-streaming|transport-case|\bcase\b|mount|bracket|window/i;
var TELEDYNE_FAMILIES = [
  'blackfly-s-usb3', 'blackfly-s-gige', 'blackfly-s-board-level', 'blackfly-usb3', 'blackfly-gige', 'oryx-10gige',
  'chameleon3-usb3', 'firefly-dl', 'flea3-usb3', 'grasshopper3-usb3', 'grasshopper3-gige', 'dragonfly-s-usb3', 'forge-5gige',
];
var FLIR_CHUNK_MS = 150 * 1000;

function fetchUrl_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' ' + url);
  return res.getContentText('UTF-8');
}

/** FLIR 商品頁的規格表：群組標題列(1 欄) + 「欄位 / 值」(2 欄) → {欄位: 值}。服務據點電話表會被略過。 */
function parseFlirSpecs_(html) {
  var out = {};
  parseHtmlTables_(html).forEach(function (rows) {
    if (!rows.length || /Service Center/i.test(rows[0].join(' '))) return;
    rows.forEach(function (r) {
      if (r.length !== 2) return;
      var k = String(r[0]).trim();
      var v = String(r[1]).trim();
      if (k && v && !out.hasOwnProperty(k)) out[k] = v;
    });
  });
  return out;
}

function flirSpecSummary_(fields) {
  var parts = [];
  Object.keys(fields).forEach(function (k) {
    var v = fields[k];
    if (parts.length >= 10 || !v || v.length > 70) return;
    if (/^(Contents|Packaging|EMC|Humidity|Encapsulation|Housing)/i.test(k)) return;
    parts.push(k + ' ' + v);
  });
  return parts.join('，');
}

function flirModelFromUrl_(path, title) {
  var slug = decodeURIComponent(path.replace(/\/+$/, '').split('/').pop()).replace(/\?.*$/, '');
  if (/^[a-z0-9_.-]{2,14}$/i.test(slug)) return 'FLIR ' + slug.toUpperCase();
  return htmlDecode_(String(title || slug)).replace(/\s*\|\s*Flir\s*$/i, '').trim();
}

/** 熱像相機 / 研發鏡頭等：flir.com/en-asia 的分類頁 → 商品頁 → 規格表 → Products（不進選型計算，熱像機的像元尺寸與可見光相機不同）。 */
function importFlirThermal_() {
  var existing = sheetToObjects(SHEET_PRODUCTS).rows;
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['Specs'] };
    });
  });
  var newRows = [];
  var enriched = 0;
  var errors = [];
  var pages = 0;
  var seen = {};
  FLIR_THERMAL_CATS.forEach(function (cat) {
    var html;
    try {
      html = fetchUrl_(FLIR_BASE + cat.path);
      pages++;
    } catch (e) {
      errors.push(cat.path + '（' + e.message + '）');
      return;
    }
    var links = {};
    var re = /href="(\/en-asia\/products\/[^"#?]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var slug = m[1].split('/').filter(Boolean).pop();
      if (cat.category === '相機' && FLIR_SKIP_PRODUCT.test(slug)) continue;
      if (/^(t\d{6}|\d{7})/i.test(slug) && cat.category === '相機') continue; // 配件料號
      links[m[1]] = true;
    }
    Object.keys(links).forEach(function (link) {
      if (seen[link]) return;
      seen[link] = true;
      var pageHtml;
      try {
        pageHtml = fetchUrl_(FLIR_BASE + link);
        pages++;
      } catch (e) {
        errors.push(link + '（' + e.message + '）');
        return;
      }
      var tm = pageHtml.match(/<title>([\s\S]*?)<\/title>/);
      var title = tm ? htmlDecode_(tm[1]) : '';
      var fields = parseFlirSpecs_(pageHtml);
      var model = flirModelFromUrl_(link, title);
      var key = model.toUpperCase();
      var specsJson = JSON.stringify(fields);
      var hit = byModel[key];
      if (hit) {
        if (!hit.specs && hit.row > 0 && Object.keys(fields).length) {
          updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: specsJson, SourceUrl: FLIR_BASE + link });
          hit.specs = specsJson;
          enriched++;
        }
        return;
      }
      newRows.push({
        InternalModel: model,
        SupplierModel: model,
        Supplier: 'FLIR (Teledyne FLIR)',
        Origin: '美國',
        Category: cat.category,
        Notes: 'FLIR 官網 ' + cat.label + '；' + (title ? title.replace(/\s*\|\s*Flir\s*$/i, '') + '；' : '') + flirSpecSummary_(fields),
        LastUpdated: todayStr(),
        SourceUrl: FLIR_BASE + link,
        Specs: specsJson,
      });
      byModel[key] = { row: -1, specs: specsJson };
    });
  });
  var added = writeProductRows_(newRows);
  return { added: added, enriched: enriched, pages: pages, errors: errors };
}

/** 一次把整批新產品寫進 Products（文字格式，避免型號被轉成日期或數字）。 */
function writeProductRows_(newRows) {
  if (!newRows.length) return 0;
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = newRows.map(function (obj) {
    return header.map(function (h) {
      return obj.hasOwnProperty(h) ? obj[h] : '';
    });
  });
  var range = sheet.getRange(sheet.getLastRow() + 1, 1, values.length, header.length);
  range.setNumberFormat('@');
  range.setValues(values);
  return values.length;
}

/** Teledyne 型號頁內嵌的 JSON-LD → {規格名: 值}。 */
function parseTeledyneProps_(html) {
  var out = {};
  var re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      continue;
    }
    var nodes = Array.isArray(data) ? data : [data];
    nodes.forEach(function (n) {
      (n && n.additionalProperty ? n.additionalProperty : []).forEach(function (pv) {
        if (pv && pv.name && pv.value != null && !out.hasOwnProperty(pv.name)) out[pv.name] = String(pv.value);
      });
    });
  }
  return out;
}

function teledyneInterface_(dataInterface, family) {
  var t = String(dataInterface || '') + ' ' + family;
  if (/usb/i.test(t)) return 'USB3.0';
  if (/gig|ethernet|base-?t|poe/i.test(t)) return 'GigE';
  return String(dataInterface || '');
}

/**
 * FLIR 可見光工業相機（Teledyne Vision Solutions）。每次最多處理 FLIR_CHUNK_MS，回傳 nextOffset，前端接著呼叫到 done。
 * 同時寫進 Products 與選型計算的 GigE / USB3 分頁（有像元尺寸才會被選型使用）。
 */
function importFlirVisible_(offset) {
  var started = new Date().getTime();
  var tasks = [];
  var errors = [];
  TELEDYNE_FAMILIES.forEach(function (slug) {
    try {
      var html = fetchUrl_(TELEDYNE_BASE + '/products/' + slug + '/');
      var seen = {};
      var re = /\?model=([^&"#]+)/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        var model = decodeURIComponent(m[1]);
        if (!seen[model]) {
          seen[model] = true;
          tasks.push({ family: slug, model: model });
        }
      }
    } catch (e) {
      errors.push(slug + '（' + e.message + '）');
    }
  });

  var existing = sheetToObjects(SHEET_PRODUCTS).rows;
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['Specs'] };
    });
  });

  var newRows = [];
  var cams = [];
  var enriched = 0;
  var pages = tasks.length ? TELEDYNE_FAMILIES.length : 0;
  var i = offset;
  for (; i < tasks.length; i++) {
    if (i > offset && new Date().getTime() - started > FLIR_CHUNK_MS) break;
    var t = tasks[i];
    var props;
    try {
      props = parseTeledyneProps_(fetchUrl_(TELEDYNE_BASE + '/products/' + t.family + '/?model=' + encodeURIComponent(t.model)));
      pages++;
    } catch (e) {
      errors.push(t.model + '（' + e.message + '）');
      continue;
    }
    var link = TELEDYNE_BASE + '/products/' + t.family + '/?model=' + encodeURIComponent(t.model);
    var key = t.model.toUpperCase();
    var specsJson = JSON.stringify(props);
    var res = String(props['Resolution'] || '').match(/(\d{3,5})\D+?(\d{3,5})/);
    var iface = teledyneInterface_(props['Data Interface'], t.family);
    var fmt = String(props['Sensor Format'] || '').replace(/["”]/g, '');
    var spec = [props['Spectrum'], props['Shutter type'], iface, res ? res[1] + '×' + res[2] : '', props['Max Frame Rate Standard'] && props['Max Frame Rate Standard'] + 'fps', props['Sensor Model'] && '感測器 ' + props['Sensor Model'], props['Pixel Size'] && '像元 ' + props['Pixel Size'] + 'μm', fmt && '靶面 ' + fmt + '"', props['Lens Mount']].filter(Boolean).join('，');
    var hit = byModel[key];
    if (hit) {
      if (!hit.specs && hit.row > 0) {
        updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: specsJson, SourceUrl: link });
        hit.specs = specsJson;
        enriched++;
      }
    } else {
      newRows.push({
        InternalModel: t.model,
        SupplierModel: t.model,
        Supplier: 'FLIR (Teledyne Vision Solutions)',
        Origin: '美國',
        Category: '相機',
        Notes: 'FLIR 工業相機（' + t.family + '）；' + spec,
        LastUpdated: todayStr(),
        SourceUrl: link,
        Specs: specsJson,
      });
      byModel[key] = { row: -1, specs: specsJson };
    }
    if (res && iface) {
      cams.push({
        model: t.model,
        brand: 'FLIR',
        sourceName: 'FLIR/Teledyne 官網',
        link: link,
        w: Number(res[1]),
        h: Number(res[2]),
        fps: parseFloat(props['Max Frame Rate Standard']) || '',
        sensor: String(props['Sensor Model'] || ''),
        iface: iface,
        color: /color/i.test(props['Spectrum'] || '') ? '彩色' : /mono/i.test(props['Spectrum'] || '') ? '黑白' : '',
        shutter: /global/i.test(props['Shutter type'] || '') ? '全局' : /rolling/i.test(props['Shutter type'] || '') ? '卷簾' : '',
        pixel: String(props['Pixel Size'] || ''),
        size: fmt ? fmt + '"' : '',
        type: String(props['Sensor Type'] || ''),
      });
    }
  }
  var added = writeProductRows_(newRows);
  var camRes = appendDehongCamerasToSheets_(cams);
  var done = i >= tasks.length;
  return { added: added, enriched: enriched, camAdded: camRes.added, skippedNoPixel: camRes.skippedNoPixel.length, done: done, nextOffset: i, total: tasks.length, pages: pages, errors: errors.slice(0, 3) };
}

function handleImportFlirProducts(body) {
  var r = body.stage === 'visible' ? importFlirVisible_(Number(body.offset) || 0) : importFlirThermal_();
  r.success = true;
  if (r.done === undefined) r.done = true;
  return r;
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
    software: handleGetSoftware({}).software.map(function (s) {
      return s.Name;
    }),
  };
}

// ------------------------------------------------------------
// 軟體名稱清單（案件的「軟體名稱」用下拉選單，避免同一套軟體被打成好幾種寫法）
// ------------------------------------------------------------
function handleGetSoftware(body) {
  var rows = sheetToObjects(SHEET_SOFTWARE).rows.map(function (r, i) {
    return { RowIndex: i + 2, Name: String(r['Name']) };
  });
  return { success: true, software: rows };
}

function handleAddSoftware(body) {
  var name = String(body.name || '').trim();
  if (!name) return { success: false, message: '軟體名稱不能空白' };
  var exists = sheetToObjects(SHEET_SOFTWARE).rows.some(function (r) {
    return String(r['Name']).toLowerCase() === name.toLowerCase();
  });
  if (!exists) appendObjectRow(SHEET_SOFTWARE, { Name: name });
  return { success: true, added: !exists };
}

function handleDeleteSoftware(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  getSheet(SHEET_SOFTWARE).deleteRow(body.rowIndex);
  return { success: true };
}

/** setup 時把既有案件裡用過的軟體名稱補進清單（只補沒有的），舊資料不用重打。 */
function seedSoftwareFromCases_(log) {
  var have = {};
  sheetToObjects(SHEET_SOFTWARE).rows.forEach(function (r) {
    have[String(r['Name']).toLowerCase()] = true;
  });
  var added = 0;
  sheetToObjects(SHEET_CASES).rows.forEach(function (r) {
    var n = String(r['SoftwareName'] || '').trim();
    if (n && !have[n.toLowerCase()]) {
      appendObjectRow(SHEET_SOFTWARE, { Name: n });
      have[n.toLowerCase()] = true;
      added++;
    }
  });
  if (added && log) log.push('軟體名稱清單：從既有案件補進 ' + added + ' 個名稱');
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
// 個人化功能：常用型號、首頁常用網站、備忘錄、行事曆行程
// 資料都用 Username 綁在個人身上（備忘錄勾「分享」才讓全站看到），一律用登入者本人，不接受前端指定別人。
// ------------------------------------------------------------
function deleteRowsWhere_(sheetName, colName, value) {
  var sheet = getSheet(sheetName);
  var data = sheet.getDataRange().getValues();
  var col = data[0].indexOf(colName);
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][col]) === String(value)) sheet.deleteRow(i + 1);
  }
}

function handleGetFavorites(body) {
  var me = body._user.username;
  var favorites = sheetToObjects(SHEET_FAVORITES).rows
    .filter(function (r) {
      return r['Username'] === me;
    })
    .map(function (r) {
      return String(r['InternalModel']);
    });
  return { success: true, favorites: favorites };
}

function handleToggleFavorite(body) {
  if (!body.internalModel) return { success: false, message: '缺少內部型號（沒有內部型號的產品請先補上再加常用）' };
  var me = body._user.username;
  var sheet = getSheet(SHEET_FAVORITES);
  var data = sheet.getDataRange().getValues();
  var uCol = data[0].indexOf('Username');
  var mCol = data[0].indexOf('InternalModel');
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][uCol] === me && String(data[i][mCol]) === String(body.internalModel)) {
      sheet.deleteRow(i + 1);
      return { success: true, favorite: false };
    }
  }
  appendObjectRow(SHEET_FAVORITES, { Username: me, InternalModel: String(body.internalModel) });
  return { success: true, favorite: true };
}

function handleGetShortcuts(body) {
  var me = body._user.username;
  var rows = sheetToObjects(SHEET_SHORTCUTS).rows.filter(function (r) {
    return r['Username'] === me;
  });
  rows.sort(function (a, b) {
    return Number(a['SortOrder']) - Number(b['SortOrder']);
  });
  return {
    success: true,
    shortcuts: rows.map(function (r) {
      return { Title: r['Title'], Url: r['Url'], OpenOnStart: r['OpenOnStart'] === '是' };
    }),
  };
}

/** 整批覆蓋自己的常用網站清單。只接受 http/https 網址（沒寫開頭就補 https://），避免存進 javascript: 之類的連結。 */
function handleSaveShortcuts(body) {
  var me = body._user.username;
  var list = body.shortcuts || [];
  var cleaned = [];
  for (var i = 0; i < list.length; i++) {
    var url = String(list[i].Url || '').trim();
    if (!url) continue;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    if (!/^https?:\/\//i.test(url)) return { success: false, message: '只能加入 http / https 網址：' + url };
    cleaned.push({ Title: String(list[i].Title || '').trim() || url, Url: url, OpenOnStart: list[i].OpenOnStart ? '是' : '' });
  }
  deleteRowsWhere_(SHEET_SHORTCUTS, 'Username', me);
  cleaned.forEach(function (c, idx) {
    appendObjectRow(SHEET_SHORTCUTS, { Username: me, Title: c.Title, Url: c.Url, OpenOnStart: c.OpenOnStart, SortOrder: idx + 1 });
  });
  return { success: true, count: cleaned.length };
}

/** 自己的備忘錄 + 別人勾了「分享」的備忘錄。 */
function handleGetMemos(body) {
  var me = body._user.username;
  var rows = [];
  sheetToObjects(SHEET_MEMOS).rows.forEach(function (r, i) {
    var mine = r['Owner'] === me;
    if (!mine && r['Shared'] !== '是') return;
    rows.push({
      RowIndex: i + 2,
      Title: r['Title'],
      Content: r['Content'],
      Shared: r['Shared'] === '是',
      OwnerName: r['OwnerName'] || r['Owner'],
      IsMine: mine,
      CreatedDate: r['CreatedDate'],
      LastUpdated: r['LastUpdated'],
    });
  });
  rows.sort(function (a, b) {
    return String(b.LastUpdated).localeCompare(String(a.LastUpdated));
  });
  return { success: true, memos: rows };
}

function handleAddMemo(body) {
  if (!String(body.title || '').trim() && !String(body.content || '').trim()) return { success: false, message: '標題或內容至少要填一個' };
  var today = todayStr();
  appendObjectRow(SHEET_MEMOS, {
    Owner: body._user.username,
    OwnerName: body._user.displayName || body._user.username,
    Title: body.title || '',
    Content: body.content || '',
    Shared: body.shared ? '是' : '',
    CreatedDate: today,
    LastUpdated: today,
  });
  return { success: true };
}

/** 備忘錄只有建立者（或 admin）能改、刪；別人分享給大家的只能看。 */
function checkMemoOwner_(body) {
  var rowNum = Number(body.rowIndex);
  var sheet = getSheet(SHEET_MEMOS);
  if (!rowNum || rowNum < 2 || rowNum > sheet.getLastRow()) throw new Error('查無此備忘錄');
  var memo = readRowAsObject(SHEET_MEMOS, rowNum);
  var user = findUserRow_(body._user.username);
  var isAdmin = user && user['Role'] === 'admin';
  if (memo['Owner'] !== body._user.username && !isAdmin) throw new Error('只有備忘錄的建立者可以修改或刪除');
  return rowNum;
}

function handleUpdateMemo(body) {
  var rowNum = checkMemoOwner_(body);
  var f = body.fields || {};
  var fields = { LastUpdated: todayStr() };
  if (f.Title !== undefined) fields.Title = f.Title;
  if (f.Content !== undefined) fields.Content = f.Content;
  if (f.Shared !== undefined) fields.Shared = f.Shared ? '是' : '';
  updateRowFields(SHEET_MEMOS, rowNum, fields);
  return { success: true };
}

function handleDeleteMemo(body) {
  var rowNum = checkMemoOwner_(body);
  getSheet(SHEET_MEMOS).deleteRow(rowNum);
  return { success: true };
}

/** 讀取執行者(部署網頁應用程式的那個 Google 帳號)預設行事曆，從今天起 days 天內的行程。 */
function handleGetCalendarEvents(body) {
  var days = Math.min(Math.max(Number(body.days) || 7, 1), 60);
  try {
    var start = new Date(todayStr() + 'T00:00:00+08:00');
    var end = new Date(start.getTime() + days * 86400000);
    var events = CalendarApp.getDefaultCalendar().getEvents(start, end).map(function (ev) {
      return {
        Id: ev.getId(),
        Title: ev.getTitle(),
        Start: Utilities.formatDate(ev.getStartTime(), 'GMT+8', ev.isAllDayEvent() ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm"),
        End: Utilities.formatDate(ev.getEndTime(), 'GMT+8', ev.isAllDayEvent() ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm"),
        AllDay: ev.isAllDayEvent(),
        Location: ev.getLocation() || '',
      };
    });
    return { success: true, events: events };
  } catch (err) {
    return { success: false, message: '讀取行事曆失敗：' + err.message + '（需要授權日曆權限，請在 Apps Script 重新執行一次 setup 並同意授權）' };
  }
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
// 客戶聯繫紀錄
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

/** date：只看某一天；companyName：只看某間公司(客戶管理頁的聯繫紀錄列表用)，兩個都可以不給。 */
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
