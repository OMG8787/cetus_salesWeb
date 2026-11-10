// ============================================================
// Code.gs - 單一檔案版：整個 Apps Script 後端都在這裡，貼上這一個檔案就好。
// 章節順序：【核心】→ 客服機器人（BOT 設定）→ 員工助理 → 文案製作
// 每一章開頭都有「===== 以下來自 xxx =====」的分隔線。
// ============================================================

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
 *                    Brand, Interface, Resolution, PixelSize, SensorSize, FPS, Mount, FocalLength, Magnification, WD, DOF, FocusWD, EffectivePixels（有效像素，例如 30萬）
 *                    （LastUpdated=上次修改日期，前端用來提醒資料多久沒更新、要不要重新詢價；
 *                    SourceUrl=資料來源網址，Specs=官網抓到的完整規格(JSON)；
 *                    後 12 欄是「選型規格」：相機/鏡頭的型號、價格、規格都放在 Products 這一張表，選型計算直接從這裡讀，
 *                    不再另外維護 GigE/USB3/FA鏡頭/遠心鏡頭 分頁（舊分頁只在 setup 時併進來一次））
 *   PriceHistory  - Date, ProductInternalModel, Supplier, Price, Currency, CaseID, Notes
 *   Cases         - CaseID, CustomerName, EndCustomerName, ProjectContact, ContactPhone,
 *                    Salesperson, FAE, ProductApplication, TestObject, SoftwareName,
 *                    SoftwareCustomization, SoftwareCustomizationNote, Status, CreatedDate,
 *                    RequirementDetails, AttachmentLinksJson,
 *                    EvaluationResult, EvaluationReportHtml, LastUpdated, Urgency（案件緊急程度：高/中/低）
 *   CCDRequirements - CaseID, CcdIndex, Description, FovLengthMm, FovWidthMm, WdMm,
 *                    AccuracyUm, FlyingSpeedMmS, InspectionSpeedPs, LightingNote
 *                    （一個案件可能對應多列，用 CaseID 關聯）
 *   CaseCompanies - CaseID, CompanyName, Role（一個案件可能牽涉多間公司，例如設備商+終端客戶+其他協力廠，
 *                    用 CaseID 關聯；CustomerName 欄位仍是這個案件的「主要客戶」，這裡是額外的相關公司）
 *   Staff         - Name, Role（業務/FAE 自動完成 + 快速新增用）
 *   Customers     - CompanyName, Contact, Phone, Email, NextFollowUpDate, Category,
 *                    Urgency, Notes, CalendarEventId, HasTransacted, LastTransactionDate,
 *                    NextFollowUpNote（下次追蹤說明：這次進度到哪、下次要做什麼）, NextFollowUpTime（預約時間 HH:mm，沒有就是整天）, CompanyPhone（公司電話；Phone 是聯繫人電話）, TaxId（統一編號）, Address（公司地址）
 *                    （Contact/Phone/Email 是主要聯絡人，多個聯絡窗口/電話/信箱存在 CustomerContacts；
 *                    Category 固定四選一：AOI同業資料／器材原廠／機構合作設備商／一般客戶）
 *   CustomerContacts - CompanyName, ContactName, Phone, Email, Title, Notes
 *                    （一間公司可能對應多列，用 CompanyName 關聯，管理多個聯絡窗口）
 *   ContactLogs   - Date, CompanyName, Contact, Method, Summary, Salesperson, CaseID, CreatedAt, Changes
 *                    （CreatedAt = 記錄時間 yyyy-MM-dd HH:mm；Changes = 這次改了哪些客戶資料 / 追蹤日，一行一項。
 *                    Method 為「資料修改」「改期」的是系統自動記下的修改紀錄，不是實際聯繫，工作日報會略過）
 *                    （CaseID 選填，標記這筆聯繫是針對哪個案件/專案，同客戶有多案件時用來分開查）
 *   Users         - Username, PasswordHash, Role, DisplayName, Phone, Email, Birthday, Perms, ResetHash / ResetExpires / ResetRequestedAt（忘記密碼：臨時密碼的雜湊、到期時間、申請時間）, MustChange（是 = 登入後必須先改密碼）（個人資料可由本人在「個人資料」頁修改；
 *                    Role = admin 系統管理員 / editor 編輯者 / viewer 查看 / limited 特定（Perms = 各功能區塊的 view / edit JSON）；舊角色 sales / fae 可一鍵遷移）
 *   LoginLogs     - LoginTime, Username, DisplayName, Result, DeviceId, DeviceLabel, LastActive, EndTime, EndReason（登入歷程）
 *                    （Role 決定權限，見 PERMISSIONS：admin 可以做任何事／sales 業務／fae 工程）
 *   Favorites     - Username, InternalModel（每人自己的「常用型號」）
 *   Shortcuts     - Username, Title, Url, OpenOnStart, SortOrder（每人自己的首頁「常用網站」）
 *   Memos         - Owner, OwnerName, Title, Content, Shared, CreatedDate, LastUpdated, LinkType, LinkId, NeedBlock（備忘錄，預設只有自己看，Shared=是 全站可看；
 *                    機器人通知 Owner=SYSTEM、LinkType=csHandoff 等，NeedBlock=bot 表示只有有「BOT 設定」權限的人看得到，刪除通知 = 恢復機器人；
 *                    CreatedAt = 通知產生的時間（毫秒）、AckBy / AckAt = 誰、何時回覆或處理了（沒填 = 每頁右下角會一直跳提醒）
 *   GigE / USB3 / FA鏡頭 / 遠心鏡頭 - 【舊分頁，已停用】選型計算改讀 Products；setup 會把這些分頁裡的資料併進 Products（只補空欄位），之後可自行刪除
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
var SHEET_CAL = 'CalEvents';
var SHEET_TODOS = 'Todos';
var SHEET_GROUPS = 'UserGroups';
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
  requestPasswordReset:    { auth: false, fn: handleRequestPasswordReset },
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
  deleteProducts:          { auth: true, fn: handleDeleteProducts },
  importCatalogProducts:   { auth: true, fn: handleImportCatalogProducts },
  importDehongProducts:    { auth: true, fn: handleImportDehongProducts },
  dedupeData:              { auth: true, fn: handleDedupeData },
  importFlirProducts:      { auth: true, fn: handleImportFlirProducts },
  importBaslerProducts:    { auth: true, fn: handleImportBaslerProducts },
  importMindvisionProducts: { auth: true, fn: handleImportMindvisionProducts },
  importMyutronProducts:   { auth: true, fn: handleImportMyutronProducts },
  importCetusProducts:     { auth: true, fn: handleImportCetusProducts },
  fillEffectivePixels:     { auth: true, fn: handleFillEffectivePixels },
  dbStatus:                { auth: true,  fn: handleDbStatus },
  dbTrim:                  { auth: true,  fn: handleDbTrim },
  getCalcCatalog:          { auth: true, fn: handleGetCalcCatalog },
  syncCalcCatalog:         { auth: true, fn: handleSyncCalcCatalog },

  // 價格紀錄
  addPriceRecord:          { auth: true, fn: handleAddPriceRecord },
  getPriceHistory:         { auth: true, fn: handleGetPriceHistory },
  updatePriceRecord:       { auth: true, fn: handleUpdatePriceRecord },
  deletePriceRecord:       { auth: true, fn: handleDeletePriceRecord },

  // 詢價信
  generateInquiryDraft:    { auth: true, fn: handleGenerateInquiryDraft },
  getProductsExport:       { auth: true, fn: handleGetProductsExport },
  writeProductCopy:        { auth: true, fn: handleWriteProductCopy },
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
  renameCase:              { auth: true, fn: handleRenameCase },
  closeCase:               { auth: true, fn: handleCloseCase },
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
  getResetSettings:        { auth: true, fn: handleGetResetSettings },
  saveResetSettings:       { auth: true, fn: handleSaveResetSettings },
  migrateRoles:            { auth: true, fn: handleMigrateRoles },

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
  // 個人工作區：行事曆 / 工作清單（每個帳號獨立，可分享給別人「只能查看」）與群組
  calGetEvents:            { auth: true, fn: handleCalGetEvents },
  calSaveEvent:            { auth: true, fn: handleCalSaveEvent },
  calDeleteEvent:          { auth: true, fn: handleCalDeleteEvent },
  todoGet:                 { auth: true, fn: handleTodoGet },
  todoSave:                { auth: true, fn: handleTodoSave },
  todoSetStatus:           { auth: true, fn: handleTodoSetStatus },
  todoDelete:              { auth: true, fn: handleTodoDelete },
  getShareTargets:         { auth: true, fn: handleGetShareTargets },
  groupGetAll:             { auth: true, fn: handleGroupGetAll },
  groupSave:               { auth: true, fn: handleGroupSave },
  groupDelete:             { auth: true, fn: handleGroupDelete },
  wsGetSettings:           { auth: true, fn: handleWsGetSettings },
  wsSaveSettings:          { auth: true, fn: handleWsSaveSettings },

  // 文件產生（每種都支援 format: 'html' / 'pdf' / 'docx'）
  generateRequirementDoc:  { auth: true, fn: handleGenerateRequirementDoc },
  generateEvaluationDoc:   { auth: true, fn: handleGenerateEvaluationDoc },
  generateQuoteDoc:        { auth: true, fn: handleGenerateQuoteDoc },

  // 客戶 + 行事曆
  getCustomers:            { auth: true, fn: handleGetCustomers },
  addCustomer:             { auth: true, fn: handleAddCustomer },
  updateCustomer:          { auth: true, fn: handleUpdateCustomer },
  saveFollowUp:            { auth: true, fn: handleSaveFollowUp },
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
var WS_ACTOR_ = ''; // 這一次執行是誰在操作（客戶「下次追蹤」會寫進他自己的行事曆）

function doPost(e) {
  var result;
  try {
    var body = JSON.parse(e.postData.contents);
    var route = getRoute_(body.action);

    if (!route) {
      result = { success: false, message: '未知的操作: ' + body.action };
    } else {
      if (route.auth) {
        body._user = requireAuth(body); // handler 需要知道是誰在操作時用 body._user
        WS_ACTOR_ = body._user.username;
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
SCHEMA[SHEET_PRODUCTS] = ['InternalModel', 'SupplierModel', 'Supplier', 'SupplierContact', 'SupplierContactEmail', 'Origin', 'Category', 'CompatibleGroup', 'RefPrice', 'Notes', 'LastUpdated', 'SourceUrl', 'Specs', 'Brand', 'Interface', 'Resolution', 'PixelSize', 'SensorSize', 'FPS', 'Mount', 'FocalLength', 'Magnification', 'WD', 'DOF', 'FocusWD', 'EffectivePixels'];
SCHEMA[SHEET_PRICE_HISTORY] = ['Date', 'ProductInternalModel', 'Supplier', 'Price', 'Currency', 'CaseID', 'Notes'];
SCHEMA[SHEET_CASES] = ['CaseID', 'CustomerName', 'EndCustomerName', 'ProjectContact', 'ContactPhone', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'SoftwareName', 'SoftwareCustomization', 'SoftwareCustomizationNote', 'Status', 'CreatedDate', 'RequirementDetails', 'AttachmentLinksJson', 'EvaluationResult', 'EvaluationReportHtml', 'LastUpdated', 'Urgency', 'CloseResult', 'CloseDate', 'CloseAmount', 'CloseNote', 'OrderItems'];
SCHEMA[SHEET_CCD_REQUIREMENTS] = ['CaseID', 'CcdIndex', 'Description', 'FovLengthMm', 'FovWidthMm', 'WdMm', 'AccuracyUm', 'FlyingSpeedMmS', 'InspectionSpeedPs', 'LightingNote'];
SCHEMA[SHEET_STAFF] = ['Name', 'Role'];
SCHEMA[SHEET_CUSTOMERS] = ['CompanyName', 'Contact', 'Phone', 'Email', 'NextFollowUpDate', 'Category', 'Urgency', 'Notes', 'CalendarEventId', 'HasTransacted', 'LastTransactionDate', 'NextFollowUpNote', 'NextFollowUpTime', 'CompanyPhone', 'TaxId', 'Address', 'Website'];
SCHEMA[SHEET_CONTACT_LOGS] = ['Date', 'CompanyName', 'Contact', 'Method', 'Summary', 'Salesperson', 'CaseID', 'CreatedAt', 'Changes'];
SCHEMA[SHEET_CUSTOMER_CONTACTS] = ['CompanyName', 'ContactName', 'Phone', 'Email', 'Title', 'Notes'];
SCHEMA[SHEET_CASE_COMPANIES] = ['CaseID', 'CompanyName', 'Role'];
SCHEMA[SHEET_USERS] = ['Username', 'PasswordHash', 'Role', 'DisplayName', 'Phone', 'Email', 'Birthday', 'Perms', 'ResetHash', 'ResetExpires', 'ResetRequestedAt', 'MustChange'];
SCHEMA[SHEET_LOGIN_LOGS] = ['LoginTime', 'Username', 'DisplayName', 'Result', 'DeviceId', 'DeviceLabel', 'LastActive', 'EndTime', 'EndReason'];
/** 公司分類固定選項（客戶管理頁下拉選單用，"AOI同業資料" 目前沒有既有資料，先開放選項給之後手動建立）。 */
var CUSTOMER_CATEGORIES = ['AOI同業資料', '器材原廠', '機構合作設備商', '一般客戶'];
SCHEMA[SHEET_CONFIG] = ['Key', 'Value'];
SCHEMA[SHEET_SOFTWARE] = ['Name'];
SCHEMA[SHEET_FAVORITES] = ['Username', 'InternalModel'];
SCHEMA[SHEET_SHORTCUTS] = ['Username', 'Title', 'Url', 'OpenOnStart', 'SortOrder'];
SCHEMA[SHEET_MEMOS] = ['Owner', 'OwnerName', 'Title', 'Content', 'Shared', 'CreatedDate', 'LastUpdated', 'LinkType', 'LinkId', 'NeedBlock', 'ShareMode', 'ShareWith', 'CreatedAt', 'AckBy', 'AckAt'];
SCHEMA[SHEET_CAL] = ['ID', 'Owner', 'Title', 'StartDate', 'StartTime', 'EndDate', 'EndTime', 'AllDay', 'Location', 'Notes', 'ShareMode', 'ShareWith', 'Source', 'RefKey', 'CreatedAt', 'UpdatedAt'];
SCHEMA[SHEET_TODOS] = ['ID', 'Owner', 'Title', 'Notes', 'DueDate', 'Priority', 'Status', 'ShareMode', 'ShareWith', 'CreatedAt', 'UpdatedAt', 'DoneAt'];
SCHEMA[SHEET_GROUPS] = ['ID', 'Name', 'Members', 'CreatedBy'];
SCHEMA[SHEET_DEVICES] = ['DeviceId', 'Username', 'DeviceLabel', 'TokenHash', 'CreatedDate', 'LastSeenDate', 'LoginTime', 'LastSeenTime'];

/**
 * 這些欄位強制設成「純文字」，避免試算表自動轉型：
 * 電話 0912… 會掉開頭的 0、精度 "-2"（只能少）會變成負數、帳號 0001 會變成 1。
 */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET_CASES] = ['ContactPhone', 'CaseID'];
TEXT_COLUMNS[SHEET_CCD_REQUIREMENTS] = ['CaseID', 'AccuracyUm'];
TEXT_COLUMNS[SHEET_CONTACT_LOGS] = ['CaseID', 'CreatedAt'];
TEXT_COLUMNS[SHEET_CASE_COMPANIES] = ['CaseID'];
TEXT_COLUMNS[SHEET_CUSTOMERS] = ['Phone', 'NextFollowUpTime', 'CompanyPhone', 'TaxId']; // 預約時間 HH:mm 一定要純文字，不然 Sheets 會轉成時間值
TEXT_COLUMNS[SHEET_CUSTOMER_CONTACTS] = ['Phone'];
TEXT_COLUMNS['BotLeads'] =['UserId', 'Name', 'Company', 'Phone', 'Email', 'Note']; // 客人填的內容：存成純文字，開頭是 = + - @ 也不會被當成公式執行
TEXT_COLUMNS[SHEET_USERS] =['Username', 'PasswordHash', 'Phone', 'Birthday', 'ResetHash'];
TEXT_COLUMNS[SHEET_LOGIN_LOGS] = ['LoginTime', 'Username', 'DeviceId', 'LastActive', 'EndTime'];
TEXT_COLUMNS[SHEET_DEVICES] = ['DeviceId', 'Username', 'TokenHash', 'LoginTime', 'LastSeenTime'];
TEXT_COLUMNS[SHEET_PRICE_HISTORY] = ['ProductInternalModel', 'CaseID'];
TEXT_COLUMNS[SHEET_PRODUCTS] = ['InternalModel', 'SupplierModel', 'Brand', 'Interface', 'Resolution', 'PixelSize', 'SensorSize', 'FPS', 'Mount', 'FocalLength', 'Magnification', 'WD', 'DOF', 'FocusWD', 'EffectivePixels'];
TEXT_COLUMNS[SHEET_FAVORITES] = ['Username', 'InternalModel'];
TEXT_COLUMNS[SHEET_SHORTCUTS] = ['Username'];
TEXT_COLUMNS[SHEET_MEMOS] = ['Owner', 'ShareWith'];
TEXT_COLUMNS[SHEET_CAL] = ['Owner', 'StartDate', 'StartTime', 'EndDate', 'EndTime', 'ShareWith', 'RefKey'];
TEXT_COLUMNS[SHEET_TODOS] = ['Owner', 'DueDate', 'ShareWith'];
TEXT_COLUMNS[SHEET_GROUPS] = ['Members'];

/** Config 分頁預設要有的設定（值留空，之後自己填）。 */
var CONFIG_KEYS = [
  ['TemplateDocId_Requirement', '需求單 Google 文件範本 ID（選填，只用 HTML 格式可不填）'],
  ['TemplateDocId_Evaluation', '評估單 Google 文件範本 ID（選填）'],
  ['TemplateDocId_Quote', '報價單 Google 文件範本 ID（選填）'],
];

var WARM_TRIGGER_MINUTES = 10;

// ------------------------------------------------------------
// 權限：四種角色 + 功能區塊
//   admin   系統管理員：全部功能，可刪除，管理帳號與系統設定（至少保留一位）
//   editor  編輯者：全部業務功能可新增 / 修改，不能刪除、不能管理帳號
//   viewer  查看：全部業務功能唯讀
//   limited 特定：只開放被勾選的功能區塊，每個區塊各自選「查看」或「編輯」，不能刪除
//   sales / fae  舊角色（還沒執行「遷移舊角色」前維持原本的權限；sales 可刪除客戶 / 案件 / 產品等，fae 不行；不能用 BOT 設定與文案製作）
// 每個後端動作都在 ACTION_PERM 登記「屬於哪個功能區塊、需要什麼等級」，伺服器端一律檢查，不能只靠畫面隱藏按鈕。
// ------------------------------------------------------------
var ROLES = ['admin', 'editor', 'viewer', 'limited'];
var ROLE_LABELS = { admin: '系統管理員', editor: '編輯者', viewer: '查看', limited: '特定', sales: '業務（舊角色）', fae: '工程（舊角色）' };
/** 「特定」角色可以個別開放的功能區塊。 */
var PERM_BLOCKS = [
  { key: 'products', label: '產品與詢價（產品搜尋、選型計算、報價系統）' },
  { key: 'cases', label: '案件管理' },
  { key: 'customers', label: '客戶與行事曆（客戶、聯絡人、聯繫紀錄）' },
  { key: 'files', label: '檔案製作（評估報告、行銷宣傳）' },
  { key: 'copy', label: '文案製作' },
  { key: 'bot', label: 'BOT 設定（客服機器人、員工助理）' },
];
var PERM_LEVELS = ['view', 'edit'];
/** 必須先改密碼的帳號，改好之前只能做這幾件事。 */
var MUST_CHANGE_ALLOWED = ['changePassword', 'logoutDevice', 'getProfile'];

/**
 * action → [區塊, 等級]。等級：r 查看 / w 新增修改 / d 刪除（只有系統管理員）。
 * 區塊：'*' = 任何登入帳號（個人資料、常用型號…）；'admin' = 只有系統管理員。
 * 沒登記的動作一律當成「只有系統管理員」，避免漏列變成大家都能用。
 * 新模組（Bot.gs、Copy.gs）的動作在它們自己的 botPerms_() / copyPerms_() 登記。
 */
var ACTION_PERM = {
  // 個人
  logoutDevice: ['*', 'r'], getProfile: ['*', 'r'], updateProfile: ['*', 'w'], changePassword: ['*', 'w'],
  getFavorites: ['*', 'r'], toggleFavorite: ['*', 'w'], getShortcuts: ['*', 'r'], saveShortcuts: ['*', 'w'],
  getMemos: ['*', 'r'], addMemo: ['*', 'w'], updateMemo: ['*', 'w'], deleteMemo: ['*', 'w'],
  getCalendarEvents: ['*', 'r'], getStaff: ['*', 'r'], getSoftware: ['*', 'r'],
  // 個人工作區：登入就能用自己的；分享給別人的只能看，改 / 刪只有擁有者（管理員可處理他人的）
  calGetEvents: ['*', 'r'], calSaveEvent: ['*', 'w'], calDeleteEvent: ['*', 'w'],
  todoGet: ['*', 'r'], todoSave: ['*', 'w'], todoSetStatus: ['*', 'w'], todoDelete: ['*', 'w'], getShareTargets: ['*', 'r'],
  groupGetAll: ['admin', 'r'], groupSave: ['admin', 'w'], groupDelete: ['admin', 'd'], wsGetSettings: ['admin', 'r'], wsSaveSettings: ['admin', 'w'],
  // 只有系統管理員
  getResetSettings: ['admin', 'r'], saveResetSettings: ['admin', 'w'],
  getUsers: ['admin', 'r'], addUser: ['admin', 'w'], updateUser: ['admin', 'w'], deleteUser: ['admin', 'd'], resetUserPassword: ['admin', 'w'], migrateRoles: ['admin', 'w'],
  getLoginOverview: ['admin', 'r'], getLoginLogs: ['admin', 'r'], forceLogout: ['admin', 'w'], clearLoginLogs: ['admin', 'd'], setLoginKeep: ['admin', 'w'],
  addStaff: ['admin', 'w'], updateStaff: ['admin', 'w'], deleteStaff: ['admin', 'd'], deleteSoftware: ['admin', 'd'],
  dbStatus: ['admin', 'r'], dbTrim: ['admin', 'w'], dedupeData: ['admin', 'w'],
  // 產品與詢價
  getProductsExport: ['products', 'r'], writeProductCopy: ['products', 'r'],
  searchProducts: ['products', 'r'], getProduct: ['products', 'r'], getCalcCatalog: ['products', 'r'], getPriceHistory: ['products', 'r'], generateQuoteDoc: ['products', 'r'],
  addProduct: ['products', 'w'], updateProduct: ['products', 'w'], deleteProduct: ['products', 'd'], deleteProducts: ['products', 'd'],
  importCatalogProducts: ['products', 'w'], importDehongProducts: ['products', 'w'], importFlirProducts: ['products', 'w'], importBaslerProducts: ['products', 'w'],
  importMindvisionProducts: ['products', 'w'], importMyutronProducts: ['products', 'w'], importCetusProducts: ['products', 'w'], fillEffectivePixels: ['products', 'w'], syncCalcCatalog: ['products', 'w'],
  addPriceRecord: ['products', 'w'], updatePriceRecord: ['products', 'w'], deletePriceRecord: ['products', 'd'],
  generateInquiryDraft: ['products', 'w'], createGmailDraft: ['products', 'w'],
  // 案件
  getCases: ['cases', 'r'], getCase: ['cases', 'r'], getCasesPageData: ['cases', 'r'], getCaseImages: ['cases', 'r'], generateRequirementDoc: ['cases', 'r'],
  createCase: ['cases', 'w'], updateCase: ['cases', 'w'], renameCase: ['cases', 'w'], closeCase: ['cases', 'w'], uploadCaseAttachment: ['cases', 'w'], addSoftware: ['cases', 'w'], generateEvaluationDoc: ['cases', 'w'],
  deleteCase: ['cases', 'd'], deleteCaseAttachment: ['cases', 'd'],
  // 客戶與行事曆
  getCustomers: ['customers', 'r'], getCustomerContacts: ['customers', 'r'], getContactLogs: ['customers', 'r'],
  addCustomer: ['customers', 'w'], updateCustomer: ['customers', 'w'], saveFollowUp: ['customers', 'w'], addCustomerContact: ['customers', 'w'], updateCustomerContact: ['customers', 'w'],
  addContactLog: ['customers', 'w'], updateContactLog: ['customers', 'w'],
  deleteCustomer: ['customers', 'd'], deleteCustomerContact: ['customers', 'd'], deleteContactLog: ['customers', 'd'],
};

/** 舊版「只有這些角色能做」的限制（舊角色 sales / fae 還沒遷移前沿用，行為跟以前一模一樣）。 */
var LEGACY_PERMISSIONS = {
  deleteProduct: ['sales'], deleteProducts: ['sales'], importCatalogProducts: ['sales'], importDehongProducts: ['sales'], importFlirProducts: ['sales'],
  importBaslerProducts: ['sales'], importMindvisionProducts: ['sales'], importMyutronProducts: ['sales'], importCetusProducts: ['sales'], fillEffectivePixels: ['sales'], syncCalcCatalog: ['sales'],
  deleteCustomer: ['sales'], deleteCase: ['sales'], renameCase: ['sales'], deletePriceRecord: ['sales'], deleteContactLog: ['sales'],
  deleteCustomerContact: ['sales'], deleteCaseAttachment: ['sales'],
};

/** 某個動作要的權限；核心表找不到再問新模組。找不到回傳 null。 */
function permFor_(action) {
  if (ACTION_PERM[action]) return ACTION_PERM[action];
  try {
    if (typeof botPerms_ === 'function') {
      var t1 = botPerms_();
      if (t1 && t1[action]) return t1[action];
    }
    if (typeof copyPerms_ === 'function') {
      var t2 = copyPerms_();
      if (t2 && t2[action]) return t2[action];
    }
    if (typeof prospectPerms_ === 'function') {
      var t3 = prospectPerms_();
      if (t3 && t3[action]) return t3[action];
    }
  } catch (e) {
    // 模組出錯不影響其他動作的權限判斷
  }
  return null;
}

/** 這個帳號各功能區塊的等級：{ products: 'edit'|'view'|'none', ... }，以及能不能刪除。給畫面隱藏選單 / 按鈕用（真正的檢查在伺服器）。 */
function accessOf_(dbUser) {
  var role = (dbUser && dbUser['Role']) || '';
  var blocks = {};
  var canDelete = false;
  PERM_BLOCKS.forEach(function (b) {
    var lv = 'none';
    if (role === 'admin' || role === 'editor') lv = 'edit';
    else if (role === 'viewer') lv = 'view';
    else if (role === 'limited') {
      var p = parsePerms_(dbUser['Perms']);
      lv = p[b.key] === 'edit' ? 'edit' : p[b.key] === 'view' ? 'view' : 'none';
    } else if (role === 'sales' || role === 'fae') {
      lv = b.key === 'bot' || b.key === 'copy' ? 'none' : 'edit';
    }
    blocks[b.key] = lv;
  });
  if (role === 'admin' || role === 'sales') canDelete = true; // 舊角色 sales 沿用原本的刪除權限
  return { role: role, roleLabel: ROLE_LABELS[role] || role, blocks: blocks, canDelete: canDelete, isAdmin: role === 'admin' };
}

function parsePerms_(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    var o = JSON.parse(String(raw));
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

/** 檢查目前使用者能不能做這個動作：即時查 Users 分頁目前的角色與權限（不是登入當下快取的），改權限、改角色下一次操作就生效。 */
function requirePermission_(action, user) {
  var dbUser = findUserRow_(user.username);
  var role = (dbUser && dbUser['Role']) || '';
  if (!dbUser) throw new Error('帳號已不存在，請重新登入');
  var perm = permFor_(action);
  // 使用臨時密碼（或管理員重設）登入的帳號：改好密碼之前，伺服器端擋掉其他所有動作（不只是畫面導向）
  if (String(dbUser['MustChange']) === '是' && MUST_CHANGE_ALLOWED.indexOf(action) < 0) {
    throw new Error('請先更新密碼：你目前使用的是臨時密碼，到「個人資料」設定新密碼後才能繼續使用');
  }
  var denied = function (why) {
    throw new Error('權限不足：' + (why || '你的角色（' + (ROLE_LABELS[role] || role || '未設定') + '）不能執行這個操作'));
  };

  if (role === 'admin') return;
  if (!perm) return denied('這個動作只有系統管理員可以執行');
  var block = perm[0];
  var level = perm[1];
  if (block === '*') return;
  if (block === 'admin') return denied('只有系統管理員可以執行這個操作');

  // 舊角色：維持原本的限制，新功能（BOT 設定、文案製作）不開放
  if (role === 'sales' || role === 'fae') {
    if (block === 'bot' || block === 'copy') return denied('舊角色不能使用這個功能，請系統管理員到「帳號管理」遷移成新角色');
    var allowed = LEGACY_PERMISSIONS[action];
    if (allowed && allowed.indexOf(role) === -1) return denied('需要 ' + allowed.join(' 或 ') + ' 身份才能操作');
    return;
  }

  if (level === 'd') return denied('刪除只有系統管理員可以執行');
  if (role === 'editor') return;
  if (role === 'viewer') {
    if (level === 'r') return;
    return denied('你的角色是「查看」，只能查看資料，不能新增或修改');
  }
  if (role === 'limited') {
    var lv = parsePerms_(dbUser['Perms'])[block];
    var label = (PERM_BLOCKS.filter(function (b) { return b.key === block; })[0] || {}).label || block;
    if (lv === 'edit') return;
    if (lv === 'view' && level === 'r') return;
    if (lv === 'view') return denied('「' + label + '」你只有查看權限，不能新增或修改');
    return denied('你沒有「' + label + '」的權限');
  }
  return denied();
}

/** 路由查詢：核心 ROUTES 找不到再問選用的新模組（Bot.gs / Copy.gs，沒貼上這些檔案就略過）。 */
function getRoute_(action) {
  if (ROUTES[action]) return ROUTES[action];
  if (typeof botRoutes_ === 'function') {
    var t1 = botRoutes_();
    if (t1 && t1[action]) return t1[action];
  }
  if (typeof copyRoutes_ === 'function') {
    var t2 = copyRoutes_();
    if (t2 && t2[action]) return t2[action];
  }
  if (typeof prospectRoutes_ === 'function') {
    var t3 = prospectRoutes_();
    if (t3 && t3[action]) return t3[action];
  }
  return null;
}

// ------------------------------------------------------------
// 舊資料匯入（data.xlsx）：業務手上舊的 Excel 聯繫紀錄整理進客戶資料表用。
// IMPORT_CUSTOMERS_DATA 是離線用 openpyxl 解析 data.xlsx 產生的結果（55 間公司），
// 放在 ImportData.gs，setup() 一次到位，不用另外上傳檔案。
// importLegacyCustomers_() 是「補洞式」匯入：只新增 Customers 裡還沒有的公司名稱，
// 已存在的公司只更新「資料表裡仍是上次匯入舊值」的欄位（資料裡的 Prev），所以重複執行 setup 不會產生重複資料或覆蓋手動編輯的內容。
// ------------------------------------------------------------
// IMPORT_CUSTOMERS_DATA 定義在另一個檔案 ImportData.gs（含客戶個資，不放進公開的 GitHub，只在本機保存）。
// Apps Script 專案裡的多個 .gs 檔案共用同一個全域範圍，把 ImportData.gs 也貼進去就會被讀到；沒貼的話會略過匯入。

/** 把 IMPORT_CUSTOMERS_DATA 寫進 Customers（+ 附加聯絡人寫進 CustomerContacts），只補缺的公司，不覆蓋既有資料。 */
function importLegacyCustomers_(log) {
  if (typeof IMPORT_CUSTOMERS_DATA === 'undefined' || !IMPORT_CUSTOMERS_DATA.length) return;

  var existing = {};
  sheetToObjects(SHEET_CUSTOMERS).rows.forEach(function (r, i) {
    existing[r['CompanyName']] = { row: i + 2, data: r };
  });

  var added = 0;
  var updated = 0;
  var kept = 0;
  IMPORT_CUSTOMERS_DATA.forEach(function (c) {
    if (!c.CompanyName) return;
    var ex = existing[c.CompanyName];
    if (ex) {
      // 已存在的公司：只有「資料表裡還是上次匯入的舊值（或空白）」的欄位才更新，手動改過的絕不覆蓋
      var prev = c.Prev || {};
      var fields = {};
      Object.keys(prev).forEach(function (f) {
        var cur = String(ex.data[f] || '');
        if (cur === '' || cur === String(prev[f])) fields[f] = c[f] || '';
        else kept++;
      });
      if (Object.keys(fields).length) {
        updateRowFields(SHEET_CUSTOMERS, ex.row, fields);
        updated++;
      }
      return;
    }
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
    existing[c.CompanyName] = { row: 0, data: {} };
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

  if (log && (added || updated || kept)) {
    log.push('匯入舊資料：新增 ' + added + ' 間客戶、更新 ' + updated + ' 間（來源 data.xlsx / 客戶.xlsx；已存在的公司只更新沒被手動改過的欄位）' + (kept ? '，' + kept + ' 個欄位因為已被手動修改而保留不動' : ''));
  }
}

/**
 * 修復電話欄位：整欄設成純文字；已經被 Sheets 當成數字吃掉開頭 0 的補回來。
 *  - 數字格式的 8～9 位數（例如 987496694、47631366）一定是掉了 0 → 補 0；
 *  - 文字格式但剛好是 9 位數且 9 開頭（例如 932680670）一定是手機掉了 0 → 補 0；
 *  其他（已經有 0、括號、加號、分機等）不動。
 */
function repairPhoneColumns_(log) {
  var targets = [[SHEET_CUSTOMERS, 'Phone'], [SHEET_CUSTOMERS, 'CompanyPhone'], [SHEET_CUSTOMER_CONTACTS, 'Phone'], [SHEET_CASES, 'ContactPhone'], [SHEET_USERS, 'Phone']];
  var fixed = 0;
  targets.forEach(function (t) {
    var sheet = getDb_(false).getSheetByName(t[0]);
    if (!sheet || sheet.getLastRow() < 2) return;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var idx = header.indexOf(t[1]);
    if (idx < 0) return;
    var n = sheet.getLastRow() - 1;
    var range = sheet.getRange(2, idx + 1, n, 1);
    var vals = range.getValues();
    var out = vals.map(function (r) {
      var v = r[0];
      if (v === '' || v == null) return [''];
      var str = typeof v === 'number' ? String(Math.round(v)) : String(v).trim();
      var fix = false;
      if (typeof v === 'number' && /^[1-9]\d{7,8}$/.test(str)) fix = true;
      else if (typeof v !== 'number' && /^9\d{8}$/.test(str)) fix = true;
      if (fix) {
        str = '0' + str;
        fixed++;
      }
      return [str];
    });
    sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    range.setValues(out);
  });
  if (fixed && log) log.push('修復電話欄位：補回 ' + fixed + ' 筆被吃掉的開頭 0');
}

/**
 * 【新環境第一次使用】在 Apps Script 編輯器上方選「setup」→ 按「執行」。
 * 第一次會跳出授權視窗，全部同意即可。可以重複執行，不會刪資料，只會補缺的東西。
 * 完成後看下方「執行紀錄」，會列出做了什麼，以及第一次建立的管理員帳號密碼。
 */
/** 核心資料表 + 選用模組（Bot.gs、Copy.gs，沒貼上就略過）的資料表欄位。 */
function allSchemas_() {
  var schema = Object.assign({}, SCHEMA);
  var text = Object.assign({}, TEXT_COLUMNS);
  var mods = [];
  if (typeof botSchema_ === 'function') mods.push(botSchema_());
  if (typeof copySchema_ === 'function') mods.push(copySchema_());
  mods.forEach(function (m) {
    Object.assign(schema, m.schema || {});
    Object.keys(m.text || {}).forEach(function (k) {
      text[k] = m.text[k];
    });
  });
  return { schema: schema, text: text };
}

function setup() {
  var log = [];
  var ss = getDb_(true, log);

  var all = allSchemas_();
  Object.keys(all.schema).forEach(function (name) {
    ensureSheet_(ss, name, all.schema[name], all.text[name] || [], log);
  });
  if (typeof botSetup_ === 'function') {
    try {
      botSetup_(log);
    } catch (e) {
      log.push('BOT 設定初始化失敗：' + e.message);
    }
  }

  try {
    repairPhoneColumns_(log);
  } catch (e) {
    log.push('修復電話開頭 0 失敗：' + e.message);
  }
  try {
    wsMigrateFollowUps_(log);
  } catch (e) {
    log.push('遷移客戶追蹤到內建行事曆失敗：' + e.message);
  }
  importLegacyCustomers_(log);
  seedSoftwareFromCases_(log);
  try {
    repairDehongCloak(log);
  } catch (e) {
    log.push('修復備註混淆碼失敗：' + e.message);
  }
  try {
    normalizeSupplierNames(log);
  } catch (e) {
    log.push('統一供應商名稱失敗：' + e.message);
  }
  try {
    migrateLegacyCalcSheets_(log);
  } catch (e) {
    log.push('舊型錄分頁整併失敗（之後可在選型計算頁按「同步型錄」重試）：' + e.message);
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

// ------------------------------------------------------------
// 資料庫管理：容量檢視 + 釋放空白儲存格（僅 admin）
// Google 試算表上限是「每個檔案 1,000 萬個儲存格」（列 × 欄，空白的也算）。新增工作表預設 1000 列 × 26 欄 = 26,000 格，
// 所以沒資料的工作表也佔空間。dbTrim 把每個工作表最後一筆資料後面多出來的空白列刪掉（保留 20 列緩衝、至少 21 列），不動資料與欄位。
// ------------------------------------------------------------
var DB_CELL_LIMIT = 10000000;
var DB_KEEP_SPARE_ROWS = 20;

/** 這個工作表「資料最後一列 + 緩衝」要保留的列數（至少 21 列）。 */
function dbKeepRows_(sheet) {
  return Math.max(sheet.getLastRow() + DB_KEEP_SPARE_ROWS, DB_KEEP_SPARE_ROWS + 1);
}

function dbSheetInfo_(sheet) {
  var maxRows = sheet.getMaxRows();
  var maxCols = sheet.getMaxColumns();
  var keep = dbKeepRows_(sheet);
  return {
    name: sheet.getName(),
    dataRows: Math.max(0, sheet.getLastRow() - 1),
    maxRows: maxRows,
    maxCols: maxCols,
    cells: maxRows * maxCols,
    releasable: maxRows > keep ? (maxRows - keep) * maxCols : 0,
  };
}

function handleDbStatus(body) {
  var sheets = getDb_(false).getSheets().map(dbSheetInfo_);
  var total = 0;
  var releasable = 0;
  sheets.forEach(function (s) {
    total += s.cells;
    releasable += s.releasable;
  });
  sheets.sort(function (a, b) {
    return b.cells - a.cells;
  });
  return { success: true, sheets: sheets, totalCells: total, limit: DB_CELL_LIMIT, percent: Math.round((total / DB_CELL_LIMIT) * 10000) / 100, releasable: releasable };
}

function handleDbTrim(body) {
  return withLock_(function () {
    var released = 0;
    var trimmed = 0;
    getDb_(false).getSheets().forEach(function (sheet) {
      var keep = dbKeepRows_(sheet);
      var max = sheet.getMaxRows();
      if (max > keep) {
        released += (max - keep) * sheet.getMaxColumns();
        sheet.deleteRows(keep + 1, max - keep);
        trimmed++;
      }
    });
    SpreadsheetApp.flush();
    var st = handleDbStatus(body);
    st.released = released;
    st.trimmedSheets = trimmed;
    return st;
  });
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

/**
 * 寫入鎖：同一時間只讓一個請求寫資料，避免兩個人同時新增時算到同一列（後寫的蓋掉先寫的）。
 * 可以巢狀呼叫（外層已經拿到鎖時直接執行），等太久（30 秒）會丟出錯誤請使用者稍後再試。
 */
var LOCK_DEPTH_ = 0;
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('系統忙碌中（其他人正在寫入資料），請稍後再試一次');
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    lock.releaseLock();
  }
}

/** 列數不夠就自動補列（釋放空白儲存格 dbTrim 之後，工作表可能剛好只剩幾列空白）。lastNeededRow = 這次寫入要用到的最後一列。 */
function ensureRows_(sheet, lastNeededRow) {
  var max = sheet.getMaxRows();
  if (lastNeededRow > max) sheet.insertRowsAfter(max, Math.max(100, lastNeededRow - max));
}

/** 這個分頁要強制純文字的欄位（核心分頁 + 選用模組的分頁）。 */
function textColsFor_(sheetName) {
  if (TEXT_COLUMNS[sheetName]) return TEXT_COLUMNS[sheetName];
  return allSchemas_().text[sheetName] || [];
}

function appendObjectRow(sheetName, obj) {
  return withLock_(function () {
    var sheet = getSheet(sheetName);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = header.map(function (h) {
      return obj.hasOwnProperty(h) ? obj[h] : '';
    });
    // 電話、編號這類文字欄位要先把儲存格設成「純文字」再寫入，不然 0912... 會被 Sheets 當數字吃掉開頭的 0
    var target = sheet.getLastRow() + 1;
    ensureRows_(sheet, target);
    textColsFor_(sheetName).forEach(function (c) {
      var i = header.indexOf(c);
      if (i > -1) sheet.getRange(target, i + 1).setNumberFormat('@');
    });
    sheet.getRange(target, 1, 1, row.length).setValues([row]);
    return target;
  });
}

/** 依欄位名稱更新某一列的部分欄位。fields = {欄位名: 新值}。 */
function updateRowFields(sheetName, rowNum, fields) {
  var sheet = getSheet(sheetName);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var textCols = textColsFor_(sheetName);
  Object.keys(fields || {}).forEach(function (key) {
    var col = header.indexOf(key);
    if (col < 0) return;
    var cell = sheet.getRange(rowNum, col + 1);
    if (textCols.indexOf(key) > -1) cell.setNumberFormat('@'); // 電話等文字欄位：先設純文字再寫，避免開頭的 0 消失
    cell.setValue(fields[key]);
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
  var pwOk = !!user && user['PasswordHash'] === sha256(password);
  var viaReset = !pwOk && !!user && resetPasswordValid_(user, password);
  if (!pwOk && !viaReset) {
    if (username) appendLoginLog_(String(username), '', '失敗', body.deviceId, body.deviceLabel);
    return { success: false, message: '帳號或密碼錯誤' };
  }
  var userRow = findUserRowIndex_(username);
  if (viaReset) {
    // 用忘記密碼的臨時密碼登入：臨時密碼正式取代舊密碼（只能用一次），而且必須馬上改成自己的密碼
    updateRowFields(SHEET_USERS, userRow, { PasswordHash: sha256(password), ResetHash: '', ResetExpires: '', ResetRequestedAt: '', MustChange: '是' });
    user['MustChange'] = '是';
  } else if (user['ResetHash'] || user['ResetRequestedAt']) {
    updateRowFields(SHEET_USERS, userRow, { ResetHash: '', ResetExpires: '', ResetRequestedAt: '' }); // 想起密碼了：作廢還沒用的臨時密碼
  }

  var displayName = user['DisplayName'] || username;
  var token = issueSessionToken_(username, displayName, body.deviceId);
  var result = { success: true, token: token, username: username, displayName: displayName, role: user['Role'] || '', access: accessOf_(user), mustChange: String(user['MustChange']) === '是' };

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
      return { success: true, token: issueSessionToken_(username, displayName, body.deviceId), username: username, displayName: displayName, role: user['Role'] || '', access: accessOf_(user), mustChange: String(user['MustChange']) === '是' };
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
  return { success: true, profile: { Username: u['Username'], DisplayName: u['DisplayName'] || u['Username'], Role: u['Role'], RoleLabel: ROLE_LABELS[u['Role']] || u['Role'], Phone: u['Phone'] || '', Email: u['Email'] || '', Birthday: u['Birthday'] || '' }, access: accessOf_(u), mustChange: String(u['MustChange']) === '是' };
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
  if (np === String(body.oldPassword || '')) return { success: false, message: '新密碼不能和目前的密碼一樣' };
  updateRowFields(SHEET_USERS, findUserRowIndex_(body._user.username), { PasswordHash: sha256(np), MustChange: '', ResetHash: '', ResetExpires: '', ResetRequestedAt: '' });
  return { success: true };
}

// ------------------------------------------------------------
// 忘記密碼
//  ・登入頁輸入帳號 → 帳號有登記 Email：產生臨時密碼（30 分鐘內有效、只能用一次）寄到該 Email；原本的密碼在臨時密碼被使用之前仍然有效
//  ・帳號沒登記 Email：不寄密碼，只寄通知給管理員（Config 的 ResetNotifyUsers 指定，沒設定 = 所有有 Email 的管理員）；
//    管理員驗證本人身分後，到「帳號管理」按「重設密碼」，親自把新密碼告訴本人
//  ・用臨時密碼 / 管理員重設的密碼登入後（MustChange），伺服器擋掉其他所有動作，一定要先改成自己的密碼
//  ・不論帳號存在與否、有沒有 Email，回應都一樣（不讓人猜帳號）；每個帳號每分鐘 1 次、每小時 3 次，全系統每小時 30 次
// ------------------------------------------------------------
var RESET_TEMP_MINUTES = 30;

function resetPasswordValid_(user, password) {
  var hash = String(user['ResetHash'] || '');
  var exp = Number(user['ResetExpires']) || 0;
  return !!hash && !!password && exp > Date.now() && hash === sha256(password);
}

function validEmail_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}

/** 忘記密碼通知要寄給哪些管理員（有 Email 的才寄）：Config ResetNotifyUsers（逗號分隔帳號）；沒設定 = 全部管理員。 */
function resetNotifyAdmins_() {
  var picked = String(getConfig('ResetNotifyUsers') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  return sheetToObjects(SHEET_USERS).rows.filter(function (u) {
    return u['Role'] === 'admin' && (!picked.length || picked.indexOf(String(u['Username'])) > -1);
  });
}

function sendResetMail_(to, subject, text) {
  GmailApp.sendEmail(to, subject, text, { name: 'AOI 系統' });
}

function handleRequestPasswordReset(body) {
  var generic = { success: true, message: '已受理。若帳號存在：有登記 Email 的，臨時密碼會寄到該 Email（30 分鐘內有效，也請看垃圾信件匣）；沒有登記 Email 的，已通知管理員，驗證身分後會親自告知新密碼。' };
  var username = String(body.username || '').trim();
  if (!username || username.length > 60) return { success: false, message: '請輸入帳號' };
  var cache = CacheService.getScriptCache();
  if (cache.get('pwr_cool_' + username)) return { success: false, message: '剛剛已經申請過了，請等 1 分鐘再試（也請檢查垃圾信件匣）' };
  var hourKey = 'pwr_hr_' + username;
  if (Number(cache.get(hourKey) || 0) >= 3) return { success: false, message: '申請次數太多了（每小時最多 3 次），請稍後再試，或直接聯絡管理員' };
  var allKey = 'pwr_all';
  if (Number(cache.get(allKey) || 0) >= 30) return { success: false, message: '系統忙碌中，請稍後再試，或直接聯絡管理員' };
  cache.put('pwr_cool_' + username, '1', 60);
  cache.put(hourKey, String(Number(cache.get(hourKey) || 0) + 1), 3600);
  cache.put(allKey, String(Number(cache.get(allKey) || 0) + 1), 3600);

  var user = findUserRow_(username);
  if (!user) return generic;
  var row = findUserRowIndex_(username);
  var email = String(user['Email'] || '').trim();
  var name = user['DisplayName'] || username;

  if (validEmail_(email)) {
    var temp = randomPassword_(10);
    updateRowFields(SHEET_USERS, row, { ResetHash: sha256(temp), ResetExpires: Date.now() + RESET_TEMP_MINUTES * 60000, ResetRequestedAt: nowStr() });
    try {
      sendResetMail_(
        email,
        '【AOI 系統】臨時密碼',
        name + ' 您好，\n\n' +
          '有人（應該是您）在 AOI 系統申請忘記密碼。您的臨時密碼是：\n\n    ' + temp + '\n\n' +
          '・臨時密碼 ' + RESET_TEMP_MINUTES + ' 分鐘內有效，只能使用一次。\n' +
          '・用帳號「' + username + '」加這組臨時密碼登入後，系統會要求您立刻設定新密碼。\n' +
          '・如果不是您申請的，請忽略這封信；您原本的密碼不受影響，臨時密碼過期後自動失效。'
      );
      return generic;
    } catch (e) {
      updateRowFields(SHEET_USERS, row, { ResetHash: '', ResetExpires: '' }); // 寄不出去的臨時密碼不留著，改走管理員處理
    }
  }
  // 沒有 Email（或寄信失敗）：通知管理員，由管理員驗證後親自告知新密碼
  updateRowFields(SHEET_USERS, row, { ResetRequestedAt: nowStr() });
  resetNotifyAdmins_().forEach(function (a) {
    if (!validEmail_(a['Email'])) return;
    try {
      sendResetMail_(
        String(a['Email']).trim(),
        '【AOI 系統】' + name + ' 申請忘記密碼',
        (a['DisplayName'] || a['Username']) + ' 您好，\n\n' +
          '帳號「' + username + '」（' + name + '）剛剛在登入頁申請忘記密碼，但這個帳號' + (validEmail_(email) ? '的 Email 寄信失敗' : '沒有登記 Email') + '。\n\n' +
          '請先用電話或當面確認是本人，再到「帳號管理」按該帳號的「重設密碼」取得新密碼，親自告訴本人。\n' +
          '本人用新密碼登入後，系統會強制他立刻改成自己的密碼。\n\n' +
          '如果不是本人申請，可以不用處理。'
      );
    } catch (e2) {
      Logger.log('忘記密碼通知寄給管理員失敗：' + e2.message);
    }
  });
  return generic;
}

function handleGetResetSettings(body) {
  var picked = String(getConfig('ResetNotifyUsers') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var admins = sheetToObjects(SHEET_USERS).rows.filter(function (u) { return u['Role'] === 'admin'; }).map(function (u) {
    return { username: String(u['Username']), name: String(u['DisplayName'] || u['Username']), hasEmail: validEmail_(u['Email']) };
  });
  return { success: true, admins: admins, selected: picked.filter(function (u) { return admins.some(function (a) { return a.username === u; }); }) };
}

function handleSaveResetSettings(body) {
  var admins = sheetToObjects(SHEET_USERS).rows.filter(function (u) { return u['Role'] === 'admin'; }).map(function (u) { return String(u['Username']); });
  var list = (Array.isArray(body.usernames) ? body.usernames : []).map(String).filter(function (u, i, a) { return admins.indexOf(u) > -1 && a.indexOf(u) === i; });
  setConfig('ResetNotifyUsers', list.join(','));
  return { success: true, selected: list };
}

// ------------------------------------------------------------
// 帳號管理（僅 admin，見 PERMISSIONS：新增/修改/刪除帳號、重設密碼）
// 不回傳 PasswordHash 給前端，避免外洩雜湊值。
// ------------------------------------------------------------
function stripPasswordHash_(row) {
  var copy = Object.assign({}, row);
  delete copy.PasswordHash;
  delete copy.ResetHash; // 臨時密碼的雜湊也不給前端
  delete copy.ResetExpires;
  return copy;
}

/** 整理「特定」角色的權限：只留已知的功能區塊，值只能是 view / edit。 */
function cleanPerms_(raw) {
  var src = parsePerms_(raw);
  var out = {};
  PERM_BLOCKS.forEach(function (b) {
    if (src[b.key] === 'view' || src[b.key] === 'edit') out[b.key] = src[b.key];
  });
  return out;
}

function handleGetUsers(body) {
  var data = sheetToObjects(SHEET_USERS);
  var users = data.rows.map(function (r, i) {
    var u = stripPasswordHash_(Object.assign({ RowIndex: i + 2 }, r));
    u.RoleLabel = ROLE_LABELS[u.Role] || u.Role;
    u.PermsObj = cleanPerms_(u.Perms);
    u.IsSelf = u.Username === body._user.username;
    u.ResetPending = !!String(r['ResetRequestedAt'] || ''); // 有人申請了忘記密碼、還沒處理（沒登記 Email 的要管理員重設）
    u.MustChange = String(r['MustChange']) === '是';
    return u;
  });
  return { success: true, users: users, roles: ROLES, roleLabels: ROLE_LABELS, blocks: PERM_BLOCKS, legacyCount: users.filter(function (u) { return u.Role === 'sales' || u.Role === 'fae'; }).length };
}

function handleAddUser(body) {
  if (!body.username) return { success: false, message: '帳號為必填' };
  if (findUserRow_(body.username)) return { success: false, message: '此帳號已存在' };
  var role = body.role || 'editor';
  if (ROLES.indexOf(role) === -1) return { success: false, message: '角色不正確（要是 ' + ROLES.join(' / ') + '）' };
  var perms = role === 'limited' ? cleanPerms_(body.perms) : {};
  if (role === 'limited' && !Object.keys(perms).length) return { success: false, message: '「特定」角色至少要開放一個功能區塊（選「查看」或「編輯」）' };
  var email = String(body.email || '').trim();
  if (email && !validEmail_(email)) return { success: false, message: 'Email 格式不正確（忘記密碼時臨時密碼會寄到這裡）' };
  var password = body.password || randomPassword_(10);
  appendObjectRow(SHEET_USERS, {
    Username: body.username,
    PasswordHash: sha256(password),
    Role: role,
    DisplayName: body.displayName || body.username,
    Email: email,
    Perms: role === 'limited' ? JSON.stringify(perms) : '',
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

/** 修改角色/顯示名稱/權限，不能改帳號本身(Username)，避免跟裝置/工作階段的對應關係亂掉。 */
function countAdmins_() {
  return sheetToObjects(SHEET_USERS).rows.filter(function (r) {
    return r['Role'] === 'admin';
  }).length;
}

function handleUpdateUser(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  return withLock_(function () {
    var target = readRowAsObject(SHEET_USERS, body.rowIndex);
    var fields = Object.assign({}, body.fields);
    delete fields.Username;
    delete fields.PasswordHash;
    var isSelf = target['Username'] === body._user.username;
    if (fields.Role !== undefined) {
      if (ROLES.indexOf(fields.Role) === -1 && fields.Role !== target['Role']) return { success: false, message: '角色不正確（要是 ' + ROLES.join(' / ') + '）' };
      if (fields.Role !== 'admin' && target['Role'] === 'admin') {
        if (isSelf) return { success: false, message: '不能把自己降級，以免沒人能管理系統。請先指定另一位系統管理員，再由他來調整你的角色。' };
        if (countAdmins_() <= 1) return { success: false, message: '這是唯一的系統管理員，不能降級，請先指定另一位系統管理員' };
      }
    }
    var newRole = fields.Role !== undefined ? fields.Role : target['Role'];
    if (fields.Perms !== undefined || fields.Role !== undefined) {
      var perms = newRole === 'limited' ? cleanPerms_(fields.Perms !== undefined ? fields.Perms : target['Perms']) : {};
      if (newRole === 'limited' && !Object.keys(perms).length) return { success: false, message: '「特定」角色至少要開放一個功能區塊（選「查看」或「編輯」）' };
      fields.Perms = newRole === 'limited' ? JSON.stringify(perms) : '';
    }
    updateRowFields(SHEET_USERS, body.rowIndex, fields);
    return { success: true };
  });
}

function handleDeleteUser(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  var sheet = getSheet(SHEET_USERS);
  if (sheet.getLastRow() - 1 <= 1) return { success: false, message: '至少要保留一個帳號，無法刪除' };
  var target = readRowAsObject(SHEET_USERS, body.rowIndex);
  if (target['Username'] === body._user.username) return { success: false, message: '不能刪除自己的帳號' };
  if (target['Role'] === 'admin' && countAdmins_() <= 1) return { success: false, message: '這是唯一的系統管理員，不能刪除' };
  sheet.deleteRow(body.rowIndex);
  return { success: true };
}

/** 一次把舊角色遷移成新角色：業務 sales、工程 fae → 編輯者（可新增修改、不能刪除；sales 原本能刪除客戶 / 案件 / 產品等，遷移後不能）。 */
function handleMigrateRoles(body) {
  return withLock_(function () {
    var sheet = getSheet(SHEET_USERS);
    var data = sheet.getDataRange().getValues();
    var col = data[0].indexOf('Role');
    var changed = { sales: 0, fae: 0 };
    for (var i = 1; i < data.length; i++) {
      var r = String(data[i][col]);
      if (r === 'sales' || r === 'fae') {
        sheet.getRange(i + 1, col + 1).setValue('editor');
        changed[r]++;
      }
    }
    return { success: true, changed: changed };
  });
}

function handleResetUserPassword(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  var password = body.password || randomPassword_(10);
  var target = readRowAsObject(SHEET_USERS, body.rowIndex);
  var isSelf = target['Username'] === body._user.username;
  // 管理員重設：本人用新密碼登入後必須馬上改成自己的（重設自己的不用）；也順便作廢還沒用的臨時密碼與申請
  updateRowFields(SHEET_USERS, body.rowIndex, { PasswordHash: sha256(password), MustChange: isSelf ? '' : '是', ResetHash: '', ResetExpires: '', ResetRequestedAt: '' });
  return { success: true, password: password, mustChange: !isSelf };
}

// ------------------------------------------------------------
// 產品搜尋表 (CRUD)
// ------------------------------------------------------------
/** 讀 Products 全部欄位，但跳過 Specs（官網完整規格 JSON，很大，列表用不到，讀它會讓搜尋變很慢）。 */
function readProductsLite_() {
  var sheet = getSheet(SHEET_PRODUCTS);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (lastRow < 2) return { header: header, rows: [] };
  var sc = header.indexOf('Specs');
  var n = lastRow - 1;
  var left = sc > -1 ? sheet.getRange(2, 1, n, sc).getValues() : sheet.getRange(2, 1, n, lastCol).getValues();
  var right = sc > -1 && sc + 1 < lastCol ? sheet.getRange(2, sc + 2, n, lastCol - sc - 1).getValues() : null;
  var cols = sc > -1 ? header.filter(function (h, i) { return i !== sc; }) : header;
  var rows = left.map(function (r, i) {
    return rowToObject(cols, right ? r.concat(right[i]) : r);
  });
  return { header: cols, rows: rows };
}

function handleSearchProducts(body) {
  var keyword = String(body.keyword || '').toLowerCase();
  var data = readProductsLite_();
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

/** 匯出用：依列號取產品完整資料（含官網完整規格 Specs，已展開成物件）。一次最多 500 筆。 */
function handleGetProductsExport(body) {
  var want = {};
  var rows = (Array.isArray(body.rowIndexes) ? body.rowIndexes : []).map(Number).filter(function (n) { return n >= 2; });
  if (!rows.length) return { success: false, message: '沒有選取任何產品' };
  if (rows.length > 500) return { success: false, message: '一次最多匯出 500 筆，請分批勾選' };
  rows.forEach(function (n) { want[n] = true; });
  var sheet = getSheet(SHEET_PRODUCTS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, products: [] };
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var all = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  var out = [];
  all.forEach(function (r, i) {
    if (!want[i + 2]) return;
    var o = rowToObject(header, r);
    o.RowIndex = i + 2;
    var specs = {};
    try { specs = o.Specs ? JSON.parse(o.Specs) : {}; } catch (e) { specs = {}; }
    o.Specs = specs && typeof specs === 'object' ? specs : {};
    out.push(o);
  });
  return { success: true, products: out };
}

/**
 * AI 幫產品寫上架文案。只把「要上架對客人公開的資料」送給 AI：底價、供應商、供應商窗口絕不會送出；
 * 售價由前端算好（底價 × 倍率）傳進來，使用者沒勾「售價」就不會帶。
 * body.products：[{ name, category, brand, price, specs: { 欄位: 值 } }]；body.mode：each = 每個產品各一篇 / one = 整組寫成一篇。
 */
function handleWriteProductCopy(body) {
  var items = (Array.isArray(body.products) ? body.products : []).slice(0, 30);
  if (!items.length) return { success: false, message: '沒有選取任何產品' };
  var user = String((body._user && body._user.username) || '');
  var cache = CacheService.getScriptCache();
  var key = 'pcopy:' + user + ':' + Math.floor(Date.now() / 3600000);
  var used = Number(cache.get(key) || 0);
  if (used >= 20) return { success: false, message: '這個小時已經產生太多次了（每人每小時最多 20 次），請稍後再試' };
  cache.put(key, String(used + 1), 7200);

  var tone = { pro: '專業、可信賴，用詞精準', friendly: '親切好懂，像業務在介紹', concise: '精簡有力，少形容詞' }[body.tone] || '專業、可信賴，用詞精準';
  var platform = { site: '公司官網商品頁（可以較完整）', market: '電商平台商品頁（標題要含關鍵字，賣點條列清楚）', seo: '官網文章，兼顧搜尋引擎關鍵字（自然帶入型號與用途）' }[body.platform] || '公司官網商品頁（可以較完整）';
  var length = { short: '每個產品約 100–150 字', mid: '每個產品約 250–350 字', long: '每個產品約 500–700 字' }[body.length] || '每個產品約 250–350 字';
  var one = body.mode === 'one';
  var extra = botClip_(body.extra, 400);

  var system = [
    '你是工業視覺（AOI、工業相機、鏡頭、光源等）產品的電商文案撰寫助理，為台灣公司撰寫產品上架文案，使用繁體中文。',
    '【鐵則】只能使用使用者提供的資料。沒有提供的規格、價格、認證、保固、庫存、交期、應用案例，一律不要寫、不要推測、不要編造；資料不足就少寫，不要湊字數。',
    '型號、數字、單位照原樣抄寫，不要改寫或換算。不要提到成本、底價、供應商、進貨管道。',
    '輸出格式：每個產品包含「標題」「賣點（3–5 點條列）」「規格摘要（條列）」「適用情境」；結尾一句行動呼籲（例如歡迎洽詢）。' + (one ? '' : '多個產品時，每個產品之間用單獨一行 --- 分隔。'),
    one ? '使用者選的是同一系列的多個產品：寫成「一篇」介紹文，先寫系列共通的賣點，再用條列或表格比較各型號差異。' : '',
    '風格：' + tone + '。平台：' + platform + '。長度：' + length + '。',
    extra ? '額外要求：' + extra : '',
  ].filter(Boolean).join('\n');

  var listing = items.map(function (p, i) {
    var lines = ['【產品 ' + (i + 1) + '】', '名稱／型號：' + botClip_(p.name, 120)];
    if (p.category) lines.push('類別：' + botClip_(p.category, 40));
    if (p.brand) lines.push('品牌：' + botClip_(p.brand, 60));
    if (p.price) lines.push('售價：' + botClip_(p.price, 40));
    var specs = p.specs && typeof p.specs === 'object' ? p.specs : {};
    Object.keys(specs).slice(0, 60).forEach(function (k) {
      var v = botClip_(specs[k], 200);
      if (v) lines.push(botClip_(k, 40) + '：' + v);
    });
    return lines.join('\n');
  }).join('\n\n');

  try {
    var text = botGenerate_(system, [{ role: 'user', text: listing }]);
    return { success: true, text: text };
  } catch (e) {
    return { success: false, message: String(e && e.message ? e.message : e) };
  }
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
    Brand: body.brand || '',
    Interface: body.interface || '',
    Resolution: body.resolution || '',
    PixelSize: body.pixelSize || '',
    SensorSize: body.sensorSize || '',
    FPS: body.fps || '',
    Mount: body.mount || '',
    FocalLength: body.focalLength || '',
    Magnification: body.magnification || '',
    WD: body.wd || '',
    DOF: body.dof || '',
    FocusWD: body.focusWd || '',
    EffectivePixels: body.effectivePixels || '',
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

/** 批次刪除產品：rowIndexes = 要刪的列號陣列。連續的列合併成一次刪除，幾千筆也很快。 */
function handleDeleteProducts(body) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var last = sheet.getLastRow();
  var seen = {};
  var rows = (body.rowIndexes || [])
    .map(Number)
    .filter(function (n) {
      if (!(n >= 2 && n <= last) || seen[n]) return false;
      seen[n] = true;
      return true;
    })
    .sort(function (a, b) {
      return b - a;
    });
  if (!rows.length) return { success: false, message: '沒有可刪除的列（可能已經被刪除，請重新載入產品資料）' };
  var i = 0;
  while (i < rows.length) {
    var start = rows[i];
    var count = 1;
    while (i + count < rows.length && rows[i + count] === start - count) count++;
    sheet.deleteRows(start - count + 1, count);
    i += count;
  }
  return { success: true, deleted: rows.length };
}

// ------------------------------------------------------------
// 從「選型計算」型錄(公開 Google 試算表)匯入產品：分頁 GigE / USB3 / FA鏡頭 / 遠心鏡頭
// 只補缺的：已存在(內部型號相同，或 原廠+原廠型號 相同)的不動。價格型錄裡沒有，匯入後 RefPrice 為空，
// 產品頁會提醒補價格、補內部型號，並顯示上次修改日期。型錄 ID 存在 Config 的 CatalogSheetId（沒設就用預設那份）。
// ------------------------------------------------------------
var DEFAULT_CATALOG_SHEET_ID = '1Enn6Yr6bOtlpWUSoy_Hd00VKWQh-0m4x';
var CATALOG_TABS = [
  { tab: 'GigE', category: '相機', kind: 'camera', label: 'GigE', iface: 'GigE' },
  { tab: 'USB3', category: '相機', kind: 'camera', label: 'USB3.0', iface: 'USB3.0' },
  { tab: 'FA鏡頭', category: '鏡頭', kind: 'fa', label: 'FA鏡頭', iface: '' },
  { tab: '遠心鏡頭', category: '鏡頭', kind: 'tele', label: '遠心鏡頭', iface: '' },
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

/** 欄名關鍵字（依序嘗試）找欄位，找不到回傳 -1。 */
function catalogColAny_(header, keywords) {
  for (var k = 0; k < keywords.length; k++) {
    var i = catalogCol_(header, keywords[k]);
    if (i > -1) return i;
  }
  return -1;
}

/** 「1920X1200」「1920*1200」之類 → 「1920X1200」；解析不出來回傳空字串。 */
function hwResolution_(v) {
  var m = String(v == null ? '' : v).match(/(\d{3,5})\s*[xX*×]\s*(\d{3,5})/);
  return m ? m[1] + 'X' + m[2] : '';
}

/** 把一張型錄表格（標題列 + 資料列，欄名中英文連在一起）轉成硬體紀錄，之後寫進 Products。 */
function hwRecordsFromTable_(tab, header, rows) {
  header = header.map(String);
  var iBrand = catalogCol_(header, '原廠名稱');
  var iOrig = catalogCol_(header, '原廠型號');
  var iName = catalogCol_(header, '公司型號');
  var iRes = catalogColAny_(header, ['解析度', 'Resolution']);
  var iSize = catalogColAny_(header, ['感測器尺寸', '靶面', 'SensorSize']);
  var iPix = catalogColAny_(header, ['像元尺寸', 'PixelSize']);
  var iFps = catalogColAny_(header, ['偵率', '幀率', 'FPS']);
  var iGain = catalogCol_(header, '最大增益');
  var iFocal = catalogColAny_(header, ['焦距', 'FocusLength']);
  var iFocusWd = catalogColAny_(header, ['最低對焦距離', '最近對焦', 'FocusWD']);
  var iMount = catalogColAny_(header, ['LensType', '鏡頭類型']);
  var iMag = catalogColAny_(header, ['放大倍率', 'MAG']);
  var iWd = catalogColAny_(header, ['工作距離']);
  var iDof = catalogColAny_(header, ['景深', 'DOF']);
  function cell(row, i) {
    return i > -1 ? String(row[i] == null ? '' : row[i]).trim() : '';
  }
  var out = [];
  rows.forEach(function (row) {
    var name = cell(row, iName);
    var orig = cell(row, iOrig);
    var brand = cell(row, iBrand);
    if (!name && !orig) return; // 空白列
    var rec = {
      model: name || orig,
      brand: brand,
      note: '',
      base: {
        InternalModel: name,
        SupplierModel: orig,
        Supplier: brand,
        Category: tab.category,
        Notes: tab.label + '；' + catalogSpec_(tab.kind, header, row),
      },
    };
    if (tab.kind === 'camera') {
      rec.interface = tab.iface;
      rec.resolution = hwResolution_(cell(row, iRes));
      rec.pixel = cell(row, iPix);
      rec.fps = cell(row, iFps);
      var size = cell(row, iSize);
      if (tab.tab === 'USB3') {
        // USB3 分頁的靶面尺寸欄位有位移，會落在「最大增益」欄
        var alt = cell(row, iGain);
        if (alt.indexOf('"') > -1) size = alt;
      }
      rec.sensorSize = size;
    } else if (tab.kind === 'fa') {
      rec.resolution = cell(row, iRes);
      rec.sensorSize = cell(row, iSize);
      rec.focal = cell(row, iFocal);
      rec.focusWd = cell(row, iFocusWd);
      rec.mount = cell(row, iMount);
    } else {
      rec.resolution = cell(row, iRes);
      rec.sensorSize = cell(row, iSize);
      rec.mag = cell(row, iMag);
      rec.wd = cell(row, iWd);
      rec.dof = cell(row, iDof);
    }
    out.push(rec);
  });
  return out;
}

/** 從公開型錄把相機/鏡頭型號與規格寫進 Products：沒有的新增，已有的只補空白的選型規格欄，不動你填過的資料。 */
function importCatalogProducts_(log) {
  var sheetId = getConfig('CatalogSheetId') || DEFAULT_CATALOG_SHEET_ID;
  var records = [];
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
    records = records.concat(hwRecordsFromTable_(t, rows[0], rows.slice(1)));
  });
  var missingInternal = records.filter(function (r) {
    return !r.base.InternalModel;
  }).length;
  var r = upsertHardware_(records);
  var msg = '型錄匯入：新增 ' + r.created + ' 筆產品、補上 ' + r.updated + ' 筆選型規格（型錄沒有價格與供應商聯絡資料；其中 ' + missingInternal + ' 筆缺內部型號，產品頁會提醒補資料）';
  if (skippedTabs.length) msg += '；略過：' + skippedTabs.join('、');
  if (log) log.push(msg);
  return { added: r.created, updated: r.updated, missingInternal: missingInternal, skipped: skippedTabs, message: msg };
}

function handleImportCatalogProducts(body) {
  var r = importCatalogProducts_(null);
  return { success: true, added: r.added, missingInternal: r.missingInternal, message: r.message };
}

// ------------------------------------------------------------
// 硬體資料單一來源 = Products
// 相機/鏡頭的型號、價格、供應商、規格都在 Products 同一張表：詢價、查產品直接找它，
// 選型計算也直接讀它的「選型規格」欄位（Brand / Interface / Resolution / PixelSize / SensorSize / FPS /
// FocalLength / Magnification / WD / DOF / FocusWD …）。這樣不會發生「產品資料庫有、選型卻永遠推薦不到」。
// 規格欄位沒填完整的相機/鏡頭，選型計算頁與產品頁都會提醒。
// 舊的 GigE / USB3 / FA鏡頭 / 遠心鏡頭 分頁只在 setup 時併進來一次（只補空欄位），之後不再使用。
// ------------------------------------------------------------
var CALC_SHEETS = [
  { name: 'GigE', kind: 'camera' },
  { name: 'USB3', kind: 'camera' },
  { name: 'FA鏡頭', kind: 'fa' },
  { name: '遠心鏡頭', kind: 'tele' },
];
var HW_NO_SELECT = '不納入選型';

function hwNum_(v) {
  var m = String(v == null ? '' : v).match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

function hwKey_(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

/**
 * 把硬體紀錄寫進 Products（以內部型號或供應商型號對應）：
 *  - 已有這個型號：只補「還是空白」的選型規格欄，你填過的不會被覆蓋；
 *  - 沒有：新增一列（rec.base 放要一起寫的欄位，例如 Supplier / Category / Notes / SourceUrl）。
 * rec = { model, brand, interface, resolution, pixel, sensorSize, fps, mount, focal, mag, wd, dof, focusWd, note, base }
 * 回傳 { updated, created }。
 */
function upsertHardware_(records) {
  var fieldMap = { Brand: 'brand', Interface: 'interface', Resolution: 'resolution', PixelSize: 'pixel', SensorSize: 'sensorSize', FPS: 'fps', Mount: 'mount', FocalLength: 'focal', Magnification: 'mag', WD: 'wd', DOF: 'dof', FocusWD: 'focusWd', EffectivePixels: 'effPx' };
  var numeric = { PixelSize: 1, FPS: 1, FocalLength: 1, Magnification: 1, FocusWD: 1 };
  var sheet = getSheet(SHEET_PRODUCTS);
  var fullHeader = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  // 讀資料時跳過 Specs（官網完整規格 JSON，很大、這裡用不到），col 是「去掉 Specs 後」的欄位位置，寫回時用 realCol 換回真正的欄位
  var sc = fullHeader.indexOf('Specs');
  var header = sc > -1 ? fullHeader.filter(function (h, i) { return i !== sc; }) : fullHeader;
  var realCol = function (i) {
    return sc > -1 && i >= sc ? i + 1 : i;
  };
  var col = {};
  header.forEach(function (h, i) {
    col[h] = i;
  });
  var lastRow = sheet.getLastRow();
  var data = [];
  if (lastRow > 1) {
    var nRows = lastRow - 1;
    var left = sheet.getRange(2, 1, nRows, sc > -1 ? sc : fullHeader.length).getValues();
    var right = sc > -1 && sc + 1 < fullHeader.length ? sheet.getRange(2, sc + 2, nRows, fullHeader.length - sc - 1).getValues() : null;
    data = left.map(function (r, i) {
      return right ? r.concat(right[i]) : r;
    });
  }
  var rowByKey = {};
  data.forEach(function (r, i) {
    [r[col['InternalModel']], r[col['SupplierModel']]].forEach(function (x) {
      if (x !== '' && x != null) rowByKey[hwKey_(x)] = i;
    });
  });

  var updated = 0;
  var changed = false;
  var notesChanged = false;
  var pending = {};
  var newRows = [];
  records.forEach(function (rec) {
    var key = hwKey_(rec.model);
    if (!key) return;
    var vals = {};
    Object.keys(fieldMap).forEach(function (c) {
      var v = rec[fieldMap[c]];
      v = numeric[c] ? hwNum_(v) : String(v == null ? '' : v).trim();
      if (v) vals[c] = v;
    });
    var idx = rowByKey[key];
    if (idx !== undefined) {
      var row = data[idx];
      var did = false;
      Object.keys(vals).forEach(function (c) {
        if (col[c] !== undefined && String(row[col[c]]).trim() === '') {
          row[col[c]] = vals[c];
          did = true;
        }
      });
      if (did) {
        updated++;
        changed = true;
        if (rec.note && col['Notes'] !== undefined) {
          var cur = String(row[col['Notes']] || '');
          row[col['Notes']] = cur + (cur ? '；' : '') + rec.note;
          notesChanged = true;
        }
      }
      return;
    }
    if (pending[key]) {
      Object.keys(vals).forEach(function (c) {
        if (!pending[key][c]) pending[key][c] = vals[c];
      });
      return;
    }
    var obj = Object.assign({ InternalModel: rec.model, SupplierModel: rec.model, LastUpdated: todayStr() }, rec.base || {}, vals);
    if (rec.note) obj.Notes = (obj.Notes ? obj.Notes + '；' : '') + rec.note;
    pending[key] = obj;
    newRows.push(obj);
  });

  if (changed) {
    var idxs = Object.keys(fieldMap)
      .map(function (c) {
        return col[c];
      })
      .filter(function (i) {
        return i !== undefined;
      });
    var first = Math.min.apply(null, idxs);
    var last = Math.max.apply(null, idxs);
    var block = sheet.getRange(2, realCol(first) + 1, data.length, last - first + 1);
    block.setNumberFormat('@');
    block.setValues(
      data.map(function (r) {
        return r.slice(first, last + 1).map(function (v) {
          return v === '' || v == null ? '' : String(v);
        });
      })
    );
    if (notesChanged) {
      sheet.getRange(2, realCol(col['Notes']) + 1, data.length, 1).setValues(
        data.map(function (r) {
          return [r[col['Notes']]];
        })
      );
    }
  }
  var created = writeProductRows_(newRows);
  return { updated: updated, created: created };
}

/** 官網沒有規格、本來就不適合選型的相機/鏡頭（熱像、讀碼器、液態鏡頭、FA 系列頁）標上「不納入選型」，才不會被當成資料漏填。 */
function markExcludedHardware_() {
  var sheet = getSheet(SHEET_PRODUCTS);
  if (sheet.getLastRow() < 2) return 0;
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var iCat = header.indexOf('Category');
  var iInt = header.indexOf('Interface');
  var iNotes = header.indexOf('Notes');
  if (iInt < 0 || iCat < 0 || iNotes < 0) return 0;
  var n0 = sheet.getLastRow() - 1;
  var cats = sheet.getRange(2, iCat + 1, n0, 1).getValues();
  var notesCol = sheet.getRange(2, iNotes + 1, n0, 1).getValues();
  var ints = sheet.getRange(2, iInt + 1, n0, 1).getValues();
  var n = 0;
  var out = ints.map(function (r, i) {
    var v = r[0];
    if ((cats[i][0] === '相機' || cats[i][0] === '鏡頭') && String(v).trim() === '') {
      var notes = String(notesCol[i][0] || '');
      if (/^德鴻官網 海康讀碼器/.test(notes)) v = '讀碼器（' + HW_NO_SELECT + '）';
      else if (/^FLIR 官網/.test(notes)) v = HW_NO_SELECT + '（熱像）';
      else if (/液態鏡頭|DHC FA 鏡頭系列|LED额定功率|LED額定功率|官網只有型號與圖片/.test(notes)) v = HW_NO_SELECT;
      if (v !== '') n++;
    }
    return [v];
  });
  if (n) sheet.getRange(2, iInt + 1, n0, 1).setNumberFormat('@').setValues(out);
  return n;
}

/** 舊的 4 個選型分頁（GigE / USB3 / FA鏡頭 / 遠心鏡頭）裡的資料併進 Products（只補空欄位）；分頁不存在就略過。 */
function migrateLegacyCalcSheets_(log) {
  var ss = getDb_(false);
  var records = [];
  CATALOG_TABS.forEach(function (t) {
    var sh = ss.getSheetByName(t.tab);
    if (!sh || sh.getLastRow() < 2) return;
    var data = sh.getDataRange().getValues();
    records = records.concat(hwRecordsFromTable_(t, data[0].map(String), data.slice(1)));
  });
  var r = records.length ? upsertHardware_(records) : { updated: 0, created: 0 };
  var marked = markExcludedHardware_();
  if (log && (records.length || marked)) log.push('硬體資料整併：舊型錄分頁併進 Products（新增 ' + r.created + ' 筆、補上 ' + r.updated + ' 筆選型規格）；標記 ' + marked + ' 筆不納入選型的相機/鏡頭');
  return r;
}

function handleSyncCalcCatalog(body) {
  var m = migrateLegacyCalcSheets_(null);
  var c = importCatalogProducts_(null);
  return { success: true, message: '已整併硬體資料：舊分頁 +' + m.created + '/補 ' + m.updated + '；公開型錄 +' + c.added + '/補 ' + c.updated };
}

/**
 * 選型計算頁用：從 Products 組出跟舊分頁同格式的 4 張表（標題列 + 資料列），前端解析程式不用改。
 * 同時回傳 incomplete：相機/鏡頭產品但選型規格沒填完整（永遠不會被推薦）的數量與前幾個型號。
 */
function handleGetCalcCatalog(body) {
  var tables = {
    GigE: { header: ['原廠名稱', '公司型號', '解析度', '像元尺寸', '感測器尺寸', '偵率'], rows: [] },
    USB3: { header: ['原廠名稱', '公司型號', '解析度', '像元尺寸', '感測器尺寸', '偵率'], rows: [] },
    'FA鏡頭': { header: ['原廠名稱', '公司型號', '解析度', '感測器尺寸', '焦距', '最低對焦距離'], rows: [] },
    '遠心鏡頭': { header: ['原廠名稱', '公司型號', '解析度', '感測器尺寸', '放大倍率', '工作距離', '景深'], rows: [] },
  };
  var incomplete = [];
  readProductsLite_().rows.forEach(function (r) {
    var cat = r['Category'];
    if (cat !== '相機' && cat !== '鏡頭') return;
    var name = String(r['InternalModel'] || r['SupplierModel'] || '').trim();
    if (!name) return;
    var iface = String(r['Interface'] || '');
    var brand = String(r['Brand'] || '');
    if (cat === '相機') {
      if (!iface) return incomplete.push(name);
      var tab = /usb/i.test(iface) ? (/usb\s*2/i.test(iface) && !/3/.test(iface) ? '' : 'USB3') : /gige/i.test(iface) ? 'GigE' : '';
      if (!tab) return; // Camera Link / 熱像 / 讀碼器等，本來就不在選型範圍
      if (!r['Resolution']) return incomplete.push(name);
      tables[tab].rows.push([brand, name, r['Resolution'], r['PixelSize'], r['SensorSize'], r['FPS']].map(String));
      return;
    }
    if (hwNum_(r['Magnification']) && Number(hwNum_(r['Magnification'])) > 0) {
      tables['遠心鏡頭'].rows.push([brand, name, r['Resolution'], r['SensorSize'], r['Magnification'], r['WD'], r['DOF']].map(String));
    } else if (Number(hwNum_(r['FocalLength'])) > 0) {
      tables['FA鏡頭'].rows.push([brand, name, r['Resolution'], r['SensorSize'], r['FocalLength'], r['FocusWD']].map(String));
    } else if (!iface) {
      incomplete.push(name);
    }
  });
  return { success: true, catalog: tables, incomplete: incomplete.length, incompleteNames: incomplete.slice(0, 8) };
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

/** 把德鴻遠心鏡頭規格寫進 Products 的選型規格欄（沒有倍率的沒辦法選型，略過）。 */
function appendDehongToTeleSheet_(items) {
  var recs = [];
  items.forEach(function (it) {
    var rec = dehongToTeleRecord_(it);
    if (!(Number(hwNum_(rec['放大倍率'])) > 0)) return;
    recs.push({
      model: it.title,
      brand: '德鴻',
      resolution: rec['解析度'],
      sensorSize: rec['感測器尺寸'],
      mag: rec['放大倍率'],
      wd: rec['工作距離'],
      dof: rec['景深'],
      mount: rec['相機接口'],
      base: { Category: '鏡頭', Supplier: DEHONG_SUPPLIER },
    });
  });
  var r = upsertHardware_(recs);
  return r.created + r.updated;
}

// ------------------------------------------------------------
// 從德鴻視覺官網（twdehong.com）抓產品規格：遠心鏡頭 / 機器視覺鏡頭 / 光源 / 光源控制器
// 官網是 Joomla + K2，分類列表頁(每頁 50 筆)已經直接列出每個產品的規格欄位，不用逐筆進內頁。
// 只抓公開的型號與規格，不抓價格（官網沒有，價格要自己詢價）。重複執行安全：已存在的型號不會新增，
// 只會幫已存在、但還沒有規格的產品補上 Specs / SourceUrl。
// 還沒抓的：相機（要逐系列進內頁）、FA 鏡頭（系列頁）、光學棱鏡。
// ------------------------------------------------------------
var DEHONG_BASE = 'https://twdehong.com';
/** 德鴻在供應商欄統一使用的名稱（舊資料裡的「德鴻 / 台灣德鴻 / 臺灣德鴻」會被統一成這個）。 */
var DEHONG_SUPPLIER = '台灣德鴻視覺有限公司';
var DEHONG_SUPPLIER_ALIASES = ['德鴻', '台灣德鴻', '臺灣德鴻', '臺灣德鴻視覺有限公司', '台灣德鴻視覺', '臺灣德鴻視覺', '德鴻視覺', '德鴻視覺有限公司'];

/** 把某分頁「Supplier」欄裡屬於 aliases 的名稱統一改成 target，回傳改了幾筆。 */
function normalizeSupplierColumn_(sheetName, aliases, target) {
  var sheet = getSheet(sheetName);
  if (sheet.getLastRow() < 2) return 0;
  var col = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf('Supplier');
  if (col < 0) return 0;
  var range = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1);
  var n = 0;
  var out = range.getValues().map(function (r) {
    var v = String(r[0]).trim();
    if (v !== target && aliases.indexOf(v) > -1) {
      n++;
      return [target];
    }
    return [r[0]];
  });
  if (n) range.setValues(out);
  return n;
}

/** 各家供應商名稱的統一規則：[目標名稱, [舊寫法...]]。之後要統一別家，在這裡加一行再執行 normalizeSupplierNames 即可。 */
function supplierNameRules_() {
  return [
    [DEHONG_SUPPLIER, DEHONG_SUPPLIER_ALIASES],
    [MV_BRAND, ['邁德威視', '迈德威视', '邁德威視 MindVision', 'MindVision', 'Mindvision', 'MINDVISION', '邁德威視科技', '迈德威视科技']],
  ];
}

/** 統一所有已知供應商的名稱（德鴻、邁德威視…），產品資料與價格紀錄一起改。可重複執行；在 Apps Script 編輯器選這個函式按執行。 */
function normalizeSupplierNames(log) {
  var lines = [];
  supplierNameRules_().forEach(function (rule) {
    var p = normalizeSupplierColumn_(SHEET_PRODUCTS, rule[1], rule[0]);
    var h = normalizeSupplierColumn_(SHEET_PRICE_HISTORY, rule[1], rule[0]);
    lines.push('「' + rule[0] + '」：產品 ' + p + ' 筆、價格紀錄 ' + h + ' 筆');
  });
  var msg = '供應商名稱統一：' + lines.join('；');
  if (log) log.push(msg);
  Logger.log(msg);
  return msg;
}

/** 統一德鴻的供應商名稱（產品資料與價格紀錄）。可重複執行；可直接在 Apps Script 編輯器選這個函式按執行。 */
function normalizeDehongSupplier(log) {
  var p = normalizeSupplierColumn_(SHEET_PRODUCTS, DEHONG_SUPPLIER_ALIASES, DEHONG_SUPPLIER);
  var h = normalizeSupplierColumn_(SHEET_PRICE_HISTORY, DEHONG_SUPPLIER_ALIASES, DEHONG_SUPPLIER);
  var msg = '供應商名稱統一為「' + DEHONG_SUPPLIER + '」：產品 ' + p + ' 筆、價格紀錄 ' + h + ' 筆';
  if (log) log.push(msg);
  Logger.log(msg);
  return { products: p, history: h };
}
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
    .replace(/<script[\s\S]*?<\/script>/gi, '')
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
  return dehongUncloakHtml_(res.getContentText('UTF-8'));
}

/** 解開 expression：'4000X3000' + '&#64;' + '9' ... → 4000X3000@9...（把 &#NN; 轉成字元）。 */
function dehongUncloakExpr_(expr) {
  return String(expr)
    .split('+')
    .map(function (x) {
      return x.trim().replace(/^['"]|['"]$/g, '');
    })
    .join('')
    .replace(/&#(\d+);/g, function (m, d) {
      return String.fromCharCode(Number(d));
    });
}

/**
 * 德鴻官網是 Joomla，凡是含「@」的文字（例如規格「4000X3000@9.86FPS」）都會被當成 Email 用 JavaScript 混淆，
 * 抓到的 HTML 變成「Email住址會使用灌水程式保護機制…」加一大段程式碼。這裡把它還原成原本的文字。
 */
function dehongUncloakHtml_(html) {
  return String(html).replace(/<span id=['"]cloak[0-9a-f]+['"]>[\s\S]*?<\/span>\s*<script[^>]*>([\s\S]*?)<\/script>/g, function (m, js) {
    var a = js.match(/var\s+addy_text[0-9a-f]+\s*=\s*([\s\S]*?);\s*document\.getElementById/);
    return a ? dehongUncloakExpr_(a[1]) : '';
  });
}

/** 修復已經存進試算表的混淆文字（Notes / Specs 裡的 Email 住址會使用灌水程式…）。 */
function dehongUncloakStored_(text) {
  var re = /此?Email[^；;]{0,60}?(?:保護機制|保护机制)[，,]?\s*你需要啟動\s*Javascript\s*才能觀看它\s*document\.getElementById\([^)]*\)\.innerHTML\s*=\s*['"]{2}\s*;[\s\S]*?var\s+addy_text[0-9a-f]+\s*=\s*([\s\S]*?);\s*document\.getElementById\([^)]*\)\.innerHTML\s*\+?=\s*['"]?\s*\+\s*addy_text[0-9a-f]+\s*\+\s*['"]?/g;
  return String(text).replace(re, function (m, expr) {
    return dehongUncloakExpr_(expr);
  });
}

/**
 * 修復產品備註 / 規格裡殘留的混淆程式碼（把「Email住址會使用灌水程式…」換回原本的「4000X3000@9.86FPS」）。
 * 可重複執行；在 Apps Script 編輯器選這個函式按執行（setup 也會順便執行）。
 */
function repairDehongCloak(log) {
  var sheet = getSheet(SHEET_PRODUCTS);
  if (sheet.getLastRow() < 2) return 0;
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var iNotes = header.indexOf('Notes');
  var iSpecs = header.indexOf('Specs');
  if (iNotes < 0) return 0;
  var n = sheet.getLastRow() - 1;
  var notes = sheet.getRange(2, iNotes + 1, n, 1).getValues();
  var fixedRows = [];
  var out = notes.map(function (r, i) {
    var v = String(r[0]);
    if (v.indexOf('addy_text') > -1 || v.indexOf('灌水程式') > -1) {
      var nv = dehongUncloakStored_(v);
      if (nv !== v) {
        fixedRows.push(i);
        return [nv];
      }
    }
    return [r[0]];
  });
  if (fixedRows.length) {
    sheet.getRange(2, iNotes + 1, n, 1).setValues(out);
    if (iSpecs > -1) {
      var specs = sheet.getRange(2, iSpecs + 1, n, 1).getValues();
      fixedRows.forEach(function (i) {
        var v = String(specs[i][0]);
        if (v.indexOf('addy_text') > -1 || v.indexOf('灌水程式') > -1) {
          var nv = dehongUncloakStored_(v);
          if (nv === v) {
            // Specs 是 JSON，引號被跳脫成 \"，先解析再逐欄修復
            try {
              var obj = JSON.parse(v);
              Object.keys(obj).forEach(function (k) {
                obj[k] = dehongUncloakStored_(obj[k]);
              });
              nv = JSON.stringify(obj);
            } catch (e) {
              nv = v;
            }
          }
          if (nv !== v) sheet.getRange(i + 2, iSpecs + 1).setValue(nv);
        }
      });
    }
  }
  var msg = '修復德鴻備註裡的混淆程式碼：' + fixedRows.length + ' 筆';
  if (log) log.push(msg);
  Logger.log(msg);
  return fixedRows.length;
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

function hwIsSelectIface_(v) {
  v = String(v || '');
  return /gige/i.test(v) || (/usb/i.test(v) && !(/usb\s*2/i.test(v) && !/3/.test(v)));
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
  IMX287: 6.9, IMX425: 9, IMX428: 9, IMX429: 4.5, IMX392: 3.45, IMX291: 2.9, IMX307: 2.9, IMX335: 2, IMX174: 5.86, IMX249: 5.86, IMX178: 2.4, IMX183: 2.4, IMX226: 1.85, IMX290: 2.9, IMX430: 9, IMX432: 9, IMX411: 3.76, IMX455: 3.76, IMX540: 2.74, IMX545: 2.74,
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

/** 把相機的選型規格寫進 Products。像元尺寸依序：官網表格 → 自己資料裡同款感測器 → 常見感測器對照（備註標註請核對）→ 留空（選型會略過並提醒補上）。 */
function appendDehongCamerasToSheets_(cams) {
  var lookup = buildSensorLookup_();
  var records = [];
  var skippedNoPixel = [];
  cams.forEach(function (c) {
    if (!c.iface) c.iface = /^BFS-U3/i.test(c.model) ? 'USB3.0' : /^BFS-(PGE|GE)/i.test(c.model) ? 'GigE' : ''; // FLIR 的表格沒有介面欄，從型號判斷
    var pixel = c.pixel;
    var size = c.size;
    var note = '';
    var hit = lookup[normSensor_(c.sensor)];
    if (!hwNum_(pixel) && hit) {
      pixel = hit.pixel;
      if (!size) size = hit.size;
    }
    if (!hwNum_(pixel)) {
      var guess = inferPixelSize_(c.sensor);
      if (guess) {
        pixel = String(guess);
        note = '像元尺寸依感測器型號推定，請核對原廠規格書';
      }
    }
    var iface = /USB/i.test(c.iface) ? (/USB\s*2/i.test(c.iface) && !/3/.test(c.iface) ? 'USB2.0' : 'USB3.0') : /GigE/i.test(c.iface) ? 'GigE' : c.iface || '其他';
    if (hwIsSelectIface_(iface) && !hwNum_(pixel)) skippedNoPixel.push(c.model);
    records.push({
      model: c.model,
      brand: c.brand || cameraBrand_(c.model),
      interface: iface,
      resolution: c.w + 'X' + c.h,
      pixel: pixel,
      sensorSize: size,
      fps: c.fps,
      note: note,
      base: { Category: '相機', SourceUrl: c.link || '' },
    });
  });
  var r = upsertHardware_(records);
  return { added: r.updated + r.created, skippedNoPixel: skippedNoPixel };
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
      Interface: isReader ? '讀碼器（' + HW_NO_SELECT + '）' : '',
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
        Interface: HW_NO_SELECT,
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
          Interface: HW_NO_SELECT,
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

  var existing = readProductsLite_().rows; // 不讀 Specs 大欄位，用 SourceUrl 判斷「已經抓過規格」
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['SourceUrl'] };
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
          Supplier: DEHONG_SUPPLIER,
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
          Supplier: DEHONG_SUPPLIER,
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
  var camsToWrite = [];
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
      rec.Supplier = DEHONG_SUPPLIER;
      rec.SupplierContact = '陳小姐';
      rec.SupplierContactEmail = 'TWDH@twdehong.com';
      rec.Origin = rec.Category === '相機' ? '' : '台灣';
      rec.LastUpdated = todayStr();
      newRows.push(rec);
      byModel[key] = { row: -1, specs: rec.Specs };
      added++;
      extraCount++;
    });
    camsToWrite = extra.cams;
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
    ensureRows_(sheet, startRow + values.length - 1);
    var range = sheet.getRange(startRow, 1, values.length, header.length);
    range.setNumberFormat('@');
    range.setValues(values);
  }

  var teleAdded = appendDehongToTeleSheet_(teleItems);
  if (camsToWrite.length) camAdded = appendDehongCamerasToSheets_(camsToWrite);
  markExcludedHardware_();
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
  var headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
    'Referer': url.split('/').slice(0, 3).join('/') + '/',
  };
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: headers });
  if (res.getResponseCode() === 403 || res.getResponseCode() === 429) {
    Utilities.sleep(1500);
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: headers });
  }
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
  var existing = readProductsLite_().rows; // 不讀 Specs 大欄位，用 SourceUrl 判斷「已經抓過規格」
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['SourceUrl'] };
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
        Interface: HW_NO_SELECT + '（熱像）',
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
  return withLock_(function () {
    return writeProductRowsUnlocked_(newRows);
  });
}

function writeProductRowsUnlocked_(newRows) {
  var sheet = getSheet(SHEET_PRODUCTS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = newRows.map(function (obj) {
    return header.map(function (h) {
      return obj.hasOwnProperty(h) ? obj[h] : '';
    });
  });
  ensureRows_(sheet, sheet.getLastRow() + values.length);
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

  var existing = readProductsLite_().rows; // 不讀 Specs 大欄位，用 SourceUrl 判斷「已經抓過規格」
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['SourceUrl'] };
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
// Basler 相機規格匯入
// baslerweb.com 主站有防爬蟲機制（程式請求一律回 403），所以改讀 Basler 官方的產品文件站
// docs.baslerweb.com：sitemap 列出所有相機型號頁，每頁第一個表格就是完整規格（解析度、感測器、像元尺寸、介面…）。
// 文件站只有相機（ace / ace 2 / dart / boost / pulse 等），沒有鏡頭、光源、價格，這些請到主站手動查。
// ------------------------------------------------------------
var BASLER_DOCS = 'https://docs.baslerweb.com';
var BASLER_MODEL_SLUG = /^(a2a|aca|boa|daa|dma|pua|ral|rac|ela|elb|pia|sca)\d/i;
var BASLER_CHUNK_MS = 150 * 1000;

function baslerCellText_(raw) {
  var t = String(raw).replace(/<\/(p|li|div|tr)>|<br\s*\/?>/gi, ' ; ');
  return htmlDecode_(t).replace(/\s+/g, ' ').replace(/(\s*;\s*)+/g, '; ').replace(/^;\s*|;\s*$/g, '').trim();
}

/** 型號頁的規格表 → {欄位: 值}。 */
function parseBaslerSpecs_(html) {
  var out = {};
  var tm = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tm) return out;
  var rre = /<tr[\s\S]*?<\/tr>/gi;
  var r;
  while ((r = rre.exec(tm[0])) !== null) {
    var cells = [];
    var cre = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    var c;
    while ((c = cre.exec(r[0])) !== null) cells.push(baslerCellText_(c[1]));
    if (cells.length === 2 && cells[0] && cells[1] && !out.hasOwnProperty(cells[0])) out[cells[0]] = cells[1];
  }
  return out;
}

function baslerInterface_(text) {
  var t = String(text || '');
  if (/usb/i.test(t)) return /usb\s*2/i.test(t) && !/3/.test(t) ? 'USB2.0' : 'USB3.0';
  if (/gigabit ethernet|gige|ethernet/i.test(t)) return 'GigE';
  if (/coaxpress|cxp/i.test(t)) return 'CoaXPress';
  if (/camera\s*link/i.test(t)) return 'Camera Link';
  if (/mipi/i.test(t)) return 'MIPI';
  return '其他';
}

function importBaslerProducts_(offset) {
  var started = new Date().getTime();
  var errors = [];
  var tasks = [];
  var sm = fetchUrl_(BASLER_DOCS + '/sitemap.xml');
  var re = /<loc>([^<]+)<\/loc>/g;
  var m;
  while ((m = re.exec(sm)) !== null) {
    var slug = m[1].replace(BASLER_DOCS + '/', '');
    if (BASLER_MODEL_SLUG.test(slug)) tasks.push(slug);
  }
  var existing = readProductsLite_().rows; // 不讀 Specs 大欄位，用 SourceUrl 判斷「已經抓過規格」
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['SourceUrl'] };
    });
  });
  var newRows = [];
  var cams = [];
  var enriched = 0;
  var pages = 1;
  var i = offset;
  for (; i < tasks.length; i++) {
    if (i > offset && new Date().getTime() - started > BASLER_CHUNK_MS) break;
    var link = BASLER_DOCS + '/' + tasks[i];
    var html;
    try {
      html = fetchUrl_(link);
      pages++;
    } catch (e) {
      errors.push(tasks[i] + '（' + e.message + '）');
      continue;
    }
    var specs = parseBaslerSpecs_(html);
    var tm = html.match(/<title>([\s\S]*?)<\/title>/);
    var model = tm ? htmlDecode_(tm[1]).replace(/\s*\|.*$/, '').trim() : tasks[i];
    var resMatch = String(specs['Resolution (H x V Pixels)'] || '').match(/(\d{3,5})\s*x\s*(\d{3,5})/i);
    if (!resMatch || !specs['Pixel Size (H x V)']) continue; // 不是相機規格頁
    var key = model.toUpperCase();
    var specsJson = JSON.stringify(specs);
    var iface = baslerInterface_(specs['Image Data Interface']);
    var pixel = (String(specs['Pixel Size (H x V)']).match(/[\d.]+/) || [''])[0];
    var sensorType = String(specs['Sensor Type'] || '');
    var sensorModel = sensorType.split(';')[0].trim();
    var spec = [specs['Product Family'], specs['Mono / Color'], specs['Image Data Interface'], resMatch[1] + '×' + resMatch[2], specs['Resolution'], specs['Frame Rate (at Default Settings)'] && String(specs['Frame Rate (at Default Settings)']).split(';')[0], sensorModel && '感測器 ' + sensorModel, pixel && '像元 ' + pixel + 'μm', specs['Sensor Format'] && '靶面 ' + specs['Sensor Format'], specs['Lens Mount']].filter(Boolean).join('，');
    var hit = byModel[key];
    if (hit) {
      if (!hit.specs && hit.row > 0) {
        updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: specsJson, SourceUrl: link });
        hit.specs = specsJson;
        enriched++;
      }
    } else {
      newRows.push({
        InternalModel: model,
        SupplierModel: model,
        Supplier: 'Basler',
        Origin: '德國',
        Category: '相機',
        Notes: 'Basler 官方文件站；' + spec,
        LastUpdated: todayStr(),
        SourceUrl: link,
        Specs: specsJson,
      });
      byModel[key] = { row: -1, specs: specsJson };
    }
    if (iface) {
      cams.push({
        model: model,
        brand: 'Basler',
        sourceName: 'Basler 官網文件',
        link: link,
        w: Number(resMatch[1]),
        h: Number(resMatch[2]),
        fps: parseFloat(specs['Frame Rate (at Default Settings)']) || '',
        sensor: sensorModel,
        iface: iface,
        color: /color/i.test(specs['Mono / Color'] || '') ? '彩色' : /mono/i.test(specs['Mono / Color'] || '') ? '黑白' : '',
        shutter: /global/i.test(sensorType) ? '全局' : /rolling/i.test(sensorType) ? '卷簾' : '',
        pixel: pixel,
        size: String(specs['Sensor Format'] || ''),
        type: /CCD/.test(sensorType) ? 'CCD' : 'CMOS',
      });
    }
  }
  var added = writeProductRows_(newRows);
  var camRes = appendDehongCamerasToSheets_(cams);
  return { added: added, enriched: enriched, camAdded: camRes.added, skippedNoPixel: camRes.skippedNoPixel.length, done: i >= tasks.length, nextOffset: i, total: tasks.length, pages: pages, errors: errors.slice(0, 3) };
}

function handleImportBaslerProducts(body) {
  var r = importBaslerProducts_(Number(body.offset) || 0);
  r.success = true;
  return r;
}

// ------------------------------------------------------------
// 邁德威視 MindVision（www.mindvision.com.cn）全系列產品匯入
// 官網是 WordPress：先用公開的 wp-json 介面列出「产品中心」全部商品（約 665 筆），再逐頁讀規格
// （頁面上方的簡表 + 詳細規格 .item 區塊）。相機（面陣 / 90 度 / 單板模組）會寫進選型規格；
// 線陣、智能相機、特殊相機、3D、雙目等不適合面陣選型的，只放進 Products 並標「不納入選型」。
// 光源、光源控制器、鏡頭、圖像採集卡一樣放進 Products（官網光源頁沒有規格，只有型號）。不含價格。
// ------------------------------------------------------------
var MV_BASE = 'https://www.mindvision.com.cn';
var MV_BRAND = 'MindVision 邁德威視';
var MV_CHUNK_MS = 90 * 1000; // 邁德威視每頁較大、寫入前還要讀寫 Products，單段抓短一點避免超過 6 分鐘

var MV_NON_PRODUCT = /尺寸图|尺寸圖|图纸|圖紙|手册|手冊|说明书|說明書|驱动|驅動|SDK|软件|軟件|教程|培训|彩页|样本|选型表|常见问题|下载|案例/;

function mvJson_(path) {
  return JSON.parse(fetchUrl_(MV_BASE + path));
}

/** 產品中心全部商品清單 [{id, link, title, groups:[根分類id...], leaf:[全部分類id]}]。 */
function mvListProducts_() {
  var cats = {};
  [1, 2].forEach(function (pg) {
    try {
      mvJson_('/wp-json/wp/v2/categories?per_page=100&page=' + pg + '&_fields=id,parent').forEach(function (c) {
        cats[c.id] = c.parent;
      });
    } catch (e) {
      // 第 2 頁沒有資料時網站會回 400，忽略
    }
  });
  function root(id) {
    var guard = 0;
    while (cats[id] && cats[id] !== 0 && cats[id] !== 23 && guard++ < 10) id = cats[id];
    return id;
  }
  var out = [];
  for (var pg = 1; pg <= 12; pg++) {
    var list;
    try {
      list = mvJson_('/wp-json/wp/v2/posts?categories=23&per_page=100&page=' + pg + '&_fields=id,link,title,categories');
    } catch (e) {
      break;
    }
    if (!list.length) break;
    list.forEach(function (x) {
      var ids = (x.categories || []).filter(function (i) {
        return i !== 23;
      });
      out.push({ id: x.id, link: x.link, title: htmlDecode_(x.title && x.title.rendered), roots: ids.map(root), cats: ids });
    });
    if (list.length < 100) break;
  }
  out.sort(function (a, b) {
    return a.id - b.id;
  });
  return out;
}

/** 邁德威視商品頁 → {欄位: 值}：簡表（「型號：」這種有冒號的）+ 詳細規格區塊（<div class="item"><p>名稱</p><p>值</p></div>）。 */
function parseMvPage_(html) {
  var f = {};
  parseHtmlTables_(html).forEach(function (rows) {
    rows.forEach(function (r) {
      if (r.length === 2) {
        var k = String(r[0]).replace(/[：:\s]+$/g, '').replace(/\s+/g, '');
        if (k && r[1] && !f.hasOwnProperty(k)) f[k] = String(r[1]).trim();
      }
    });
  });
  var re = /<div class="item[^"]*">\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*<p>((?:(?!<\/p>)[\s\S])*)<\/p>\s*<\/div>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var k2 = htmlDecode_(m[1]).replace(/\s+/g, '');
    var v2 = htmlDecode_(m[2]).replace(/\s+/g, ' ').trim();
    if (k2 && v2 && v2 !== '/' && !f.hasOwnProperty(k2)) f[k2] = v2;
  }
  return f;
}

function mvInch_(v) {
  var t = String(v || '').replace(/[″”“]|&#8243;/g, '"').trim();
  if (/^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(t)) t += '"';
  return t;
}

function mvInterface_(v) {
  var t = String(v || '');
  if (/千兆|万兆|GigE|2\.5G|10G|以太/i.test(t)) return 'GigE';
  if (/USB\s*3/i.test(t)) return 'USB3.0';
  if (/USB\s*2|USB2/i.test(t)) return 'USB2.0';
  return t.trim();
}

/** 這個商品屬於哪一類：group = 相機(面陣可選型) / 其他相機(不納入選型) / 光源 / 調光器 / 鏡頭 / 採集卡。 */
function mvClassify_(task) {
  var roots = task.roots;
  var has = function (id) {
    return roots.indexOf(id) > -1;
  };
  if (task.cats.indexOf(96) > -1) return { category: '調光器', label: '光源控制器', kind: 'ctl' };
  if (has(45)) return { category: '光源', label: '工業光源', kind: 'light' };
  if (has(35)) return { category: '鏡頭', label: '工業鏡頭', kind: 'lens' };
  if (has(43)) return { category: '其他', label: '圖像採集卡', kind: 'card' };
  if (has(24) || has(134) || has(39)) return { category: '相機', label: has(134) ? '90度直角相機' : has(39) ? '單板相機模組' : '面陣工業相機', kind: 'cam' };
  if (has(25)) return { category: '相機', label: '線陣工業相機', kind: 'other-cam', marker: '線陣' };
  if (has(26)) return { category: '相機', label: '智能相機', kind: 'other-cam', marker: '智能相機' };
  if (has(27)) return { category: '相機', label: '特殊相機', kind: 'other-cam', marker: '特殊相機' };
  if (has(41)) return { category: '相機', label: '3D 相機', kind: 'other-cam', marker: '3D 相機' };
  if (has(40)) return { category: '相機', label: '雙目相機模組', kind: 'other-cam', marker: '雙目模組' };
  return { category: '相機', label: '其他相機', kind: 'other-cam', marker: '其他相機' };
}

function mvModel_(f, title) {
  var m = f['型号'] || f['产品型号'];
  if (m) return String(m).trim();
  var t = String(title || '').match(/MV-[A-Za-z0-9\-\/]+/);
  if (t) return t[0];
  return String(title || '').replace(/工业(线阵)?相机|\s*\|\s*/g, ' ').trim();
}

function importMindvisionProducts_(offset) {
  var started = new Date().getTime();
  var errors = [];
  var tasks = mvListProducts_();
  var existing = readProductsLite_().rows; // 不讀 Specs 大欄位，用 SourceUrl 判斷「已經抓過規格」
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['SourceUrl'] };
    });
  });
  var newRows = [];
  var cams = [];
  var lensRecs = [];
  var enriched = 0;
  var pages = 0;
  var i = offset;
  for (; i < tasks.length; i++) {
    if (i > offset && new Date().getTime() - started > MV_CHUNK_MS) break;
    var t = tasks[i];
    var html;
    try {
      html = fetchUrl_(t.link);
      pages++;
    } catch (e) {
      errors.push(t.title + '（' + e.message + '）');
      continue;
    }
    var f = parseMvPage_(html);
    var kind = mvClassify_(t);
    if (MV_NON_PRODUCT.test(t.title)) continue; // 尺寸圖、手冊、驅動、軟體等不是產品
    var model = mvModel_(f, t.title);
    if (!model) continue;
    // 相機 / 鏡頭 / 採集卡一定要有型號欄位或標題裡的 MV- 型號，否則是說明頁
    if (kind.kind !== 'light' && kind.kind !== 'ctl' && !f['型号'] && !f['产品型号'] && !/MV-[A-Za-z0-9]/.test(t.title)) continue;
    var key = model.toUpperCase();
    var specsJson = JSON.stringify(f);
    var resText = f['分辨率'] || f['分辨率@帧率'] || f['分辩率@帧率'] || '';
    var rm = String(resText).match(/(\d{3,5})\s*[xX*×]\s*(\d{3,5})/);
    var fpsM = String(f['分辩率@帧率'] || f['分辨率@帧率'] || '').match(/(\d+(?:\.\d+)?)\s*fps/i);
    var iface = mvInterface_(f['数据接口'] || f['传输接口']);
    var sensorSize = mvInch_(f['光学尺寸'] || (/[\/"″]/.test(f['传感器'] || '') ? f['传感器'] : ''));
    var colorText = String(f['彩色/黑白'] || f['相机类型'] || '');
    var marker = '';
    if (kind.kind === 'other-cam') marker = kind.marker + '（' + HW_NO_SELECT + '）';
    else if (kind.kind === 'cam' && !iface) marker = '';
    var spec;
    if (kind.kind === 'cam' || kind.kind === 'other-cam') {
      spec = [colorText, iface, rm ? rm[1] + '×' + rm[2] : '', fpsM && fpsM[1] + 'fps', f['传感器型号'] && '感測器 ' + f['传感器型号'], f['像元尺寸'] && '像元 ' + f['像元尺寸'], sensorSize && '靶面 ' + sensorSize, f['镜头接口']].filter(Boolean).join('，');
    } else if (kind.kind === 'lens') {
      spec = ['焦距', '靶面', '像素', '物距', '光圈', '接口'].map(function (k) {
        return f[k] ? k + ' ' + f[k] : '';
      }).filter(Boolean).join('，');
    } else {
      spec = Object.keys(f).slice(0, 8).map(function (k) {
        return k + ' ' + f[k];
      }).join('，');
    }
    var hit = byModel[key];
    if (hit) {
      if (!hit.specs && hit.row > 0 && Object.keys(f).length) {
        updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: specsJson, SourceUrl: t.link });
        hit.specs = specsJson;
        enriched++;
      }
    } else {
      newRows.push({
        InternalModel: model,
        SupplierModel: model,
        Supplier: MV_BRAND,
        Origin: '中國',
        Category: kind.category,
        Interface: marker,
        Notes: '邁德威視官網 ' + kind.label + '；' + (spec || t.title),
        LastUpdated: todayStr(),
        SourceUrl: t.link,
        Specs: specsJson,
      });
      byModel[key] = { row: -1, specs: specsJson };
    }
    if (kind.kind === 'cam' && rm && iface) {
      cams.push({
        model: model,
        brand: MV_BRAND,
        link: t.link,
        w: Number(rm[1]),
        h: Number(rm[2]),
        fps: fpsM ? parseFloat(fpsM[1]) : '',
        sensor: String(f['传感器型号'] || ''),
        iface: iface,
        color: /彩色|color/i.test(colorText) ? '彩色' : /黑白|mono/i.test(colorText) ? '黑白' : '',
        shutter: /行/.test(f['曝光方式'] || '') ? '卷簾' : /帧|幀|全局/.test(f['曝光方式'] || '') ? '全局' : '',
        pixel: String(f['像元尺寸'] || ''),
        size: sensorSize,
        type: /CCD/i.test(f['传感器类型'] || '') ? 'CCD' : 'CMOS',
      });
    } else if (kind.kind === 'other-cam') {
      lensRecs.push({ model: model, brand: MV_BRAND, interface: marker, resolution: rm ? rm[1] + 'X' + rm[2] : '', sensorSize: sensorSize });
    } else if (kind.kind === 'lens') {
      lensRecs.push({ model: model, brand: MV_BRAND, resolution: hwNum_(f['像素']), sensorSize: mvInch_(f['靶面'] || f['靶面尺寸']), focal: f['焦距'], wd: f['物距'], mount: f['接口'] });
    }
  }
  var added = writeProductRows_(newRows);
  var camRes = cams.length ? appendDehongCamerasToSheets_(cams) : { added: 0, skippedNoPixel: [] };
  if (lensRecs.length) upsertHardware_(lensRecs);
  return { added: added, enriched: enriched, camAdded: camRes.added, skippedNoPixel: camRes.skippedNoPixel.length, done: i >= tasks.length, nextOffset: i, total: tasks.length, pages: pages, errors: errors.slice(0, 3) };
}

function handleImportMindvisionProducts(body) {
  var r = importMindvisionProducts_(Number(body.offset) || 0);
  r.success = true;
  return r;
}

// ------------------------------------------------------------
// Myutron（日本 MYUTRON INC.，www.myutron.com/ch/）鏡頭與光源匯入
// 官網是一個系列一頁、頁內一張規格表（型號 / 倍率 / 焦距 / 工作距離 / 最大對應傳感器尺寸…）。
// 機器視覺鏡頭（遠心、定焦、變倍、線掃描）、光源、調光電源/控制器會寫進 Products；
// 遠心鏡頭（有「倍率」）與 FA 定焦鏡頭（有「焦距」）同時寫進選型規格。
// 監控(CCTV)鏡頭、線材、擴散板、固定座、濾鏡等配件不屬於 AOI 選型，不匯入。不含價格。
// ------------------------------------------------------------
var MYUTRON_BASE = 'https://www.myutron.com/ch/';
var MYUTRON_SUPPLIER = 'Myutron';
var MYUTRON_CHUNK_MS = 150 * 1000;
// 這些系列頁只有線材、擴散板、固定座、濾鏡、光學零件等配件，不用抓
var MYUTRON_SKIP_SLUG = /^(lens\/fa\/(mount|filter|opticallens-parts|prism|rear-converter|btl-tele|fg-l)|illumination\/(mkba|mkba_mkr|mkr_mkr-f|mc-mcs2|mc-mcs4|mc-mil-20|mc-mil-26|robot|option|led|branch))$/;
var MYUTRON_CONTROLLER_SLUG = /^illumination\/(mdgc|mlc|mlp|mjs)$/;
// 表頭有這些字樣的是配件表（對應哪個光源/鏡頭、線材長度、濾鏡螺孔…），整張略過
var MYUTRON_ACCESSORY_HEADER = /尺寸\s*[\(（]m[\)）]|對應光源|對應鏡頭|所屬鏡頭|濾鏡螺孔|推薦鏡頭|控制器$|^配件|MHV用|電纜/;

/** 首頁連結 → 要抓的系列頁 slug 清單（lens/fa/xxx、illumination/xxx）。 */
function myutronListSeries_() {
  var html = fetchUrl_(MYUTRON_BASE);
  var seen = {};
  var out = [];
  var re = /href="https:\/\/www\.myutron\.com\/ch\/((?:lens\/fa|illumination)\/[^"#\/]+)\/?"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var slug = m[1];
    if (seen[slug] || slug.indexOf('/type/') > -1 || /\/type$/.test(slug) || MYUTRON_SKIP_SLUG.test(slug)) continue;
    seen[slug] = true;
    out.push(slug);
  }
  return out;
}

function myutronText_(raw) {
  return htmlDecode_(String(raw || '').replace(/<br\s*\/?>/gi, ' '))
    .replace(/[″”“]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** <table> → 二維陣列，rowspan / colspan 都展開（官網大量用 rowspan，不展開欄位會對不上）。 */
function myutronTableGrid_(tableHtml) {
  var grid = [];
  var spans = [];
  (tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach(function (rowHtml) {
    var row = [];
    var col = 0;
    var fill = function () {
      while (spans[col] && spans[col].left > 0) {
        row[col] = spans[col].text;
        spans[col].left--;
        col++;
      }
    };
    var cre = /<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi;
    var c;
    while ((c = cre.exec(rowHtml)) !== null) {
      fill();
      var text = myutronText_(c[2]);
      var rs = Number((c[1].match(/rowspan="?(\d+)/i) || [0, 1])[1]) || 1;
      var cs = Number((c[1].match(/colspan="?(\d+)/i) || [0, 1])[1]) || 1;
      for (var k = 0; k < cs; k++) {
        row[col] = text;
        if (rs > 1) spans[col] = { left: rs - 1, text: text };
        col++;
      }
    }
    fill();
    if (row.length) grid.push(row);
  });
  return grid;
}

function myutronModel_(s) {
  var t = String(s || '').replace(/[\(（][^\)）]*[\)）]/g, '').trim().replace(/[\s\-−–]*[□＊*]+$/, '').trim(); // 「HMZ0745（手動變倍）」去掉括號說明
  if (!/^[A-Za-z][A-Za-z0-9\-\/\.\+×x□＊*·・ ]{1,40}$/.test(t) || !/\d/.test(t)) return '';
  return t;
}

/**
 * 一頁系列頁 → { title, items:[{ model, cells:{表頭:值} }] }。
 * 橫向表（第一欄「型號」往下一列一型號）與直向表（表頭列第 2 欄起就是型號，例如 MLC / MLP 控制器）都支援；
 * 型號帶 □ 且後面接著一串顏色代碼（DW、B、G…）的，展開成每個顏色一個型號。
 */
function myutronParsePage_(html) {
  var tm = html.match(/<title>([\s\S]*?)<\/title>/);
  var title = tm ? htmlDecode_(tm[1]).replace(/\s*\|\s*myutron.*$/i, '').replace(/\s+/g, ' ').trim() : '';
  var items = [];
  (html.match(/<table[\s\S]*?<\/table>/gi) || []).forEach(function (t) {
    var grid = myutronTableGrid_(t);
    // 有些表第一列是「鏡頭」「專用前變倍鏡」這種標題，真正的表頭在後面
    var h0 = 0;
    while (h0 < grid.length && grid[h0][0] !== '型號') h0++;
    if (h0 >= grid.length - 1) return;
    grid = grid.slice(h0);
    var head = grid[0];
    if (MYUTRON_ACCESSORY_HEADER.test(head.join(' '))) return;
    var vertical = head.length > 1 && myutronModel_(head[1]) && !/^(倍率|焦距|發光色|顏色|波段|類型)/.test(head[1]);
    if (vertical) {
      for (var c = 1; c < head.length; c++) {
        var vm = myutronModel_(head[c]);
        if (!vm) continue;
        var cells = {};
        for (var r = 1; r < grid.length; r++) {
          if (grid[r][0] && grid[r][c] != null && grid[r][c] !== '' && grid[r][c] !== '－') cells[grid[r][0]] = grid[r][c];
        }
        items.push({ model: vm, cells: cells });
      }
      return;
    }
    var keys = head.filter(function (h, i) {
      return i > 0 && h !== '外觀圖' && h !== '外觀圖(寬/長/厚)';
    });
    if (!keys.length) return;
    // 「型號」底下分「Coaxial / Non Coaxial」兩欄（FTV 系列）：每列有兩個型號，其餘欄位往後多一格
    var twin = !!grid[1] && /^coaxial$/i.test(grid[1][0]);
    if (twin) head = [head[0]].concat(head.slice(2)); // 表頭的「型號」橫跨兩欄，展開後重複了一格
    for (var i = twin ? 2 : 1; i < grid.length; i++) {
      var row = grid[i];
      var raw = row[0];
      var variants = [];
      var rest = row.slice(twin ? 2 : 1);
      if (/□/.test(raw)) {
        while (rest.length && /^[A-Z]{1,3}$/.test(rest[0])) variants.push(rest.shift());
      }
      var cellsObj = {};
      head.slice(1).forEach(function (h, k) {
        if (h && h !== '外觀圖' && h !== '外觀圖(寬/長/厚)' && rest[k] != null && rest[k] !== '' && rest[k] !== '–' && rest[k] !== '－') cellsObj[h] = rest[k];
      });
      if (variants.length) {
        variants.forEach(function (v) {
          var vmodel = myutronModel_(raw.replace(/□/g, v));
          if (vmodel) items.push({ model: vmodel, cells: Object.assign({ 發光色: v }, cellsObj) });
        });
      } else {
        var model = myutronModel_(raw);
        if (model) items.push({ model: model, cells: cellsObj });
        var model2 = twin ? myutronModel_(row[1]) : '';
        if (model2) items.push({ model: model2, cells: cellsObj });
      }
    }
  });
  return { title: title, items: items };
}

function myutronFirstNum_(v) {
  var m = String(v == null ? '' : v).match(/\d+(?:\.\d+)?/);
  return m ? m[0] : '';
}

/** 一個型號 → Products 欄位 + 選型規格。 */
function myutronBuildItem_(slug, title, it) {
  var f = it.cells;
  var isLens = slug.indexOf('lens/') === 0;
  var isCtl = MYUTRON_CONTROLLER_SLUG.test(slug);
  var category = isLens ? '鏡頭' : isCtl ? '調光器' : '光源';
  var label = isLens ? '機器視覺鏡頭' : isCtl ? '光源控制器' : '工業光源';
  var sensor = mvInch_(f['最大對應傳感器尺寸'] || f['Image sensor'] || '');
  var summary = Object.keys(f).slice(0, 8).map(function (k) {
    return k + ' ' + f[k];
  }).join('，');
  var rec = null;
  if (isLens) {
    var focal = f['焦距'] ? myutronFirstNum_(f['焦距']) : '';
    var magText = String(f['倍率'] || f['最大攝像倍率'] || '');
    var mag = !focal && !/[〜~]|\d\s*x?\s*[-–]\s*\d/.test(magText) ? myutronFirstNum_(magText) : ''; // 變倍鏡頭（0.7x〜4.5x）沒有單一倍率，不寫進選型 // 定焦鏡頭的「最大使用倍率」不是遠心倍率，不能寫進放大倍率，不然選型會被當成遠心鏡頭
    rec = {
      model: it.model,
      brand: MYUTRON_SUPPLIER,
      sensorSize: sensor,
      focal: focal,
      mag: mag,
      wd: mag ? myutronFirstNum_(f['工作距離'] || f['WD']) : '',
      focusWd: focal ? myutronFirstNum_(f['工作距離'] || f['最短物距']) : '',
      dof: mag ? myutronFirstNum_(f['景深']) : '',
      mount: String(f['接口'] || '').trim(),
    };
  }
  return {
    category: category,
    label: label,
    row: {
      InternalModel: it.model,
      SupplierModel: it.model,
      Supplier: MYUTRON_SUPPLIER,
      Origin: '日本',
      Category: category,
      Notes: 'Myutron 官網 ' + label + '；' + title + (summary ? '；' + summary : ''),
      LastUpdated: todayStr(),
      SourceUrl: MYUTRON_BASE + slug + '/',
      Specs: JSON.stringify(Object.assign({ 系列: title }, f)),
    },
    rec: rec,
  };
}

function importMyutronProducts_(offset) {
  var started = new Date().getTime();
  var errors = [];
  var tasks = myutronListSeries_();
  var existing = readProductsLite_().rows;
  var byModel = {};
  existing.forEach(function (r, i) {
    [r['InternalModel'], r['SupplierModel']].forEach(function (x) {
      if (x) byModel[String(x).toUpperCase()] = { row: i + 2, specs: r['SourceUrl'] };
    });
  });
  var newRows = [];
  var recs = [];
  var enriched = 0;
  var pages = 0;
  var i = offset;
  for (; i < tasks.length; i++) {
    if (i > offset && new Date().getTime() - started > MYUTRON_CHUNK_MS) break;
    var html;
    try {
      html = fetchUrl_(MYUTRON_BASE + tasks[i] + '/');
      pages++;
    } catch (e) {
      errors.push(tasks[i] + '（' + e.message + '）');
      continue;
    }
    var page = myutronParsePage_(html);
    page.items.forEach(function (it) {
      var built = myutronBuildItem_(tasks[i], page.title, it);
      var key = it.model.toUpperCase();
      var hit = byModel[key];
      if (hit) {
        if (!hit.specs && hit.row > 0) {
          updateRowFields(SHEET_PRODUCTS, hit.row, { Specs: built.row.Specs, SourceUrl: built.row.SourceUrl });
          hit.specs = built.row.Specs;
          enriched++;
        }
      } else {
        newRows.push(built.row);
        byModel[key] = { row: -1, specs: built.row.Specs };
      }
      if (built.rec) recs.push(built.rec);
    });
  }
  var added = writeProductRows_(newRows);
  if (recs.length) upsertHardware_(recs);
  return { added: added, enriched: enriched, camAdded: 0, done: i >= tasks.length, nextOffset: i, total: tasks.length, pages: pages, errors: errors.slice(0, 3) };
}

function handleImportMyutronProducts(body) {
  var r = importMyutronProducts_(Number(body.offset) || 0);
  r.success = true;
  return r;
}

// ------------------------------------------------------------
// Cetus 官網工業相機（www.cetus.tw 產品頁的六個分頁）＋「有效像素」
// ------------------------------------------------------------
var CETUS_BRAND = 'Cetus';
var CETUS_TABS = [
  { tab: 1458, iface: 'GigE', color: '黑白' },
  { tab: 1488, iface: 'GigE', color: '彩色' },
  { tab: 1500, iface: 'USB3.0', color: '彩色' },
  { tab: 1512, iface: 'USB3.0', color: '黑白' },
  { tab: 1530, iface: 'USB2.0', color: '彩色' },
  { tab: 1560, iface: 'USB2.0', color: '黑白' },
];

function cetusTabUrl_(tab) {
  return 'https://www.cetus.tw/product_d.php?lang=tw&tb=1&id=287&tab=' + tab;
}

/** 取出某個分頁（id="tab-xxxx"）裡的規格表（第一個表頭同時有「型號」「畫素」的表格）→ 二維陣列，第一列是表頭；找不到回傳空陣列。 */
function cetusParsePane_(html, tab) {
  var start = html.indexOf('id="tab-' + tab + '"');
  if (start < 0) return [];
  var next = html.indexOf('<li class="tab-con"', start + 10);
  var tables = parseHtmlTables_(html.substring(start, next > -1 ? next : html.length));
  for (var i = 0; i < tables.length; i++) {
    var head = tables[i][0].join('|');
    if (head.indexOf('型號') > -1 && head.indexOf('畫素') > -1) return tables[i];
  }
  return [];
}

/** 官網規格表的一列 → 產品紀錄（給 upsertHardware_）。型號裡的空白拿掉（官網偶爾寫成 "CV3-2000 M -19RT"）。 */
function cetusBuildRec_(head, cells, def) {
  var at = function (kw) {
    var i = headerCol_(head, [kw]);
    return i > -1 && cells[i] !== undefined ? String(cells[i]).trim() : '';
  };
  var model = at('型號').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9]/.test(model)) return null;
  var res = parseResolution_(at('分辨率'));
  var effPx = at('畫素').replace(/\s+/g, '');
  var specs = {};
  head.forEach(function (h, i) {
    if (cells[i] !== undefined && String(cells[i]).trim()) specs[h] = String(cells[i]).trim();
  });
  specs['色彩'] = def.color;
  specs['介面'] = def.iface;
  var resText = res ? res.w + 'x' + res.h : '';
  return {
    model: model,
    brand: CETUS_BRAND,
    interface: def.iface,
    resolution: resText,
    pixel: at('像素尺寸'),
    sensorSize: at('Sensor Size').replace(/\s+/g, ''),
    fps: at('FPS'),
    effPx: effPx,
    base: {
      Supplier: CETUS_BRAND,
      Category: '相機',
      Notes: 'Cetus 官網 ' + def.iface + def.color + '工業相機；' + [effPx, resText, at('Sensor型號')].filter(Boolean).join(' '),
      SourceUrl: cetusTabUrl_(def.tab),
      Specs: JSON.stringify(specs),
    },
  };
}

/** 匯入 Cetus 官網六個分頁（GigE / USB3.0 / USB2.0 × 黑白 / 彩色）的相機型號：新增還沒有的型號，已有的只補空白欄位（含有效像素）。不含價格。 */
function handleImportCetusProducts() {
  var recs = [];
  var errors = [];
  var pages = 0;
  CETUS_TABS.forEach(function (def) {
    try {
      var html = fetchUrl_(cetusTabUrl_(def.tab));
      pages++;
      var rows = cetusParsePane_(html, def.tab);
      if (!rows.length) {
        errors.push('分頁 ' + def.tab + ' 找不到規格表（官網改版？）');
        return;
      }
      for (var i = 1; i < rows.length; i++) {
        var rec = cetusBuildRec_(rows[0], rows[i], def);
        if (rec) recs.push(rec);
      }
    } catch (e) {
      errors.push('分頁 ' + def.tab + '（' + e.message + '）');
    }
  });
  var r = recs.length ? upsertHardware_(recs) : { updated: 0, created: 0 };
  return { success: true, added: r.created, enriched: r.updated, camAdded: r.created, done: true, total: recs.length, pages: pages, errors: errors.slice(0, 6) };
}

/** 解析度文字 → {w, h}（長邊在前）；看不出來回傳 null。 */
function parseResolution_(s) {
  var m = String(s == null ? '' : s).match(/(\d{3,5})\s*[xX*×]\s*(\d{3,5})/);
  if (!m) return null;
  var a = Number(m[1]);
  var b = Number(m[2]);
  return { w: Math.max(a, b), h: Math.min(a, b) };
}

/** 解析度 → 有效像素文字：640x480 = 307,200 → '30萬'（取整數萬、無條件捨去，跟官網寫法一致）。 */
function effPixFromRes_(w, h) {
  var n = Math.floor((w * h) / 10000);
  return n > 0 ? n + '萬' : '';
}

/** 有效像素文字 → 數字（單位：萬）。'30萬' → 30、'5MP' → 500、'2.3 百萬像素' → 230、'307200' → 30.72；看不懂回傳 0。 */
function effPixToWan_(s) {
  var t = String(s == null ? '' : s).replace(/,/g, '');
  var m = t.match(/(\d+(?:\.\d+)?)\s*(萬|万|MP|百萬|百万|M\b)?/i);
  if (!m) return 0;
  var n = parseFloat(m[1]);
  var u = (m[2] || '').toLowerCase();
  if (u === '萬' || u === '万') return n;
  if (u === 'mp' || u === 'm' || u === '百萬' || u === '百万') return Math.round(n * 100 * 1000) / 1000;
  return n >= 10000 ? n / 10000 : 0; // 沒單位：>= 1 萬才當作像素總數
}

/** 從 Specs（JSON）或備註文字裡找解析度、有效像素。找不到就是空字串 / null。 */
function findPixelInfo_(specsText, notesText) {
  var out = { res: null, eff: '' };
  var specs = {};
  try {
    specs = specsText ? JSON.parse(specsText) : {};
  } catch (e) {
    specs = {};
  }
  Object.keys(specs).forEach(function (k) {
    var v = String(specs[k]);
    if (!out.res && /分辨率|分辩率|解析度|resolution/i.test(k)) out.res = parseResolution_(v);
    if (!out.eff && /畫素|画素|像素數|有效像素|effective/i.test(k) && !/尺寸|大小|size/i.test(k)) {
      var w = effPixToWan_(v);
      if (w) out.eff = Math.round(w) + '萬';
    }
  });
  var blob = String(notesText || '');
  if (!out.res) out.res = parseResolution_(blob);
  if (!out.eff) {
    var m = blob.match(/(\d+(?:\.\d+)?)\s*[萬万]\s*(?:畫素|画素|像素)?/);
    if (m) out.eff = Math.round(parseFloat(m[1])) + '萬';
  }
  return out;
}

/**
 * 推算相機畫素：逐台相機，缺「解析度」就從規格 / 備註找，缺「有效像素」就用規格寫的萬畫素，沒有再用解析度算（長 × 寬 ÷ 1 萬，捨去）。
 * 只補空白，你填過的不會被覆蓋。
 */
function handleFillEffectivePixels() {
  return withLock_(function () {
    var sheet = getSheet(SHEET_PRODUCTS);
    var last = sheet.getLastRow();
    if (last < 2) return { success: true, checked: 0, effFilled: 0, resFilled: 0, unresolved: 0 };
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var col = {};
    header.forEach(function (h, i) {
      col[h] = i;
    });
    if (col['EffectivePixels'] === undefined || col['Resolution'] === undefined || col['Category'] === undefined) {
      return { success: false, message: '產品表還沒有「有效像素」欄位，請先到 Apps Script 執行一次 setup' };
    }
    var n = last - 1;
    var read = function (name) {
      return col[name] === undefined ? null : sheet.getRange(2, col[name] + 1, n, 1).getValues();
    };
    var cat = read('Category');
    var res = read('Resolution');
    var eff = read('EffectivePixels');
    var notes = read('Notes');
    var specs = read('Specs');
    var checked = 0;
    var effFilled = 0;
    var resFilled = 0;
    var unresolved = 0;
    for (var i = 0; i < n; i++) {
      if (String(cat[i][0]).trim() !== '相機') continue;
      checked++;
      var curRes = String(res[i][0] == null ? '' : res[i][0]).trim();
      var curEff = String(eff[i][0] == null ? '' : eff[i][0]).trim();
      if (curRes && curEff) continue;
      var pr = parseResolution_(curRes);
      var info = null;
      var lazy = function () {
        if (!info) info = findPixelInfo_(specs ? specs[i][0] : '', notes ? notes[i][0] : '');
        return info;
      };
      if (!pr && !curRes) {
        pr = lazy().res;
        if (pr) {
          res[i][0] = pr.w + 'x' + pr.h;
          resFilled++;
        }
      }
      if (!curEff) {
        var e = lazy().eff || (pr ? effPixFromRes_(pr.w, pr.h) : '');
        if (e) {
          eff[i][0] = e;
          effFilled++;
        } else {
          unresolved++;
        }
      }
    }
    var put = function (name, values) {
      var range = sheet.getRange(2, col[name] + 1, n, 1);
      range.setNumberFormat('@');
      range.setValues(
        values.map(function (r) {
          return [r[0] === '' || r[0] == null ? '' : String(r[0])];
        })
      );
    };
    if (resFilled) put('Resolution', res);
    if (effFilled) put('EffectivePixels', eff);
    return { success: true, checked: checked, effFilled: effFilled, resFilled: resFilled, unresolved: unresolved };
  });
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
/** 詢價信的標題與內文（網站與助理共用）。 */
function inquiryText_(p, lastPrice, quantity) {
  return {
    subject: '詢價 - ' + p['InternalModel'] + ' / ' + p['SupplierModel'],
    body:
      (p['SupplierContact'] ? p['SupplierContact'] + ' 您好，\n\n' : '您好，\n\n') +
      '想請教以下產品報價：\n' +
      '供應商型號: ' + p['SupplierModel'] + '\n' +
      '對應內部型號: ' + p['InternalModel'] + '\n' +
      (lastPrice ? '上次報價紀錄: ' + lastPrice['Price'] + ' ' + (lastPrice['Currency'] || '') + '（' + lastPrice['Date'] + '）\n' : '') +
      '需求數量: ' + (quantity || '請提供') + '\n\n' +
      '麻煩協助報價，謝謝！',
  };
}

function handleGenerateInquiryDraft(body) {
  var productResult = handleGetProduct({ internalModel: body.internalModel });
  if (!productResult.success) return productResult;
  var p = productResult.product;
  var lastPrice = productResult.lastPrice;

  var text = inquiryText_(p, lastPrice, body.quantity);
  var subject = text.subject;
  var bodyText = text.body;

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

  // 案件編號（專案名稱）由「軟體名稱-待測物件-產品應用-客戶名稱」組成，這三項空白會變成 NA，所以一定要填
  var missingParts = [];
  if (!String(body.softwareName || '').trim()) missingParts.push('使用軟體名稱');
  if (!String(body.testObject || '').trim()) missingParts.push('待測物件');
  if (!String(body.productApplication || '').trim()) missingParts.push('產品應用');
  if (missingParts.length) return { success: false, message: '以下欄位會組成案件編號（專案名稱），請先填寫：' + missingParts.join('、') };

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
    Urgency: ['高', '中', '低'].indexOf(body.urgency) > -1 ? body.urgency : '中',
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

/** 把某分頁 columnName 欄裡等於 oldId 的儲存格改成 newId（文字格式），回傳改了幾格。 */
function renameCaseIdInSheet_(sheetName, columnName, oldId, newId) {
  var sheet = getSheet(sheetName);
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var col = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf(columnName);
  if (col < 0) return 0;
  var range = sheet.getRange(2, col + 1, last - 1, 1);
  var n = 0;
  var out = range.getValues().map(function (r) {
    if (String(r[0]) === oldId) {
      n++;
      return [newId];
    }
    return [r[0]];
  });
  if (n) {
    range.setNumberFormat('@');
    range.setValues(out);
  }
  return n;
}

/**
 * 修改案件編號（專案名稱）。案件編號是各分頁互相對應的鍵，所以一併更新：
 * Cases、CCDRequirements、CaseCompanies、ContactLogs、PriceHistory。附件在案件資料裡，跟著走。
 */
function handleRenameCase(body) {
  var oldId = String(body.caseId || '').trim();
  var newId = String(body.newCaseId || '').trim();
  if (!oldId || !newId) return { success: false, message: '缺少案件編號或新的專案名稱' };
  if (newId === oldId) return { success: false, message: '新的專案名稱和目前一樣，沒有修改' };
  if (newId.length > 100) return { success: false, message: '專案名稱太長（最多 100 字）' };
  if (/['"<>\\\/?#%]/.test(newId)) return { success: false, message: "專案名稱不能包含 ' \" < > \\ / ? # % 這些符號" };
  var sheet = getSheet(SHEET_CASES);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var rowNum = findCaseRowIndex(header, oldId);
  if (rowNum === -1) return { success: false, message: '查無此案件' };
  if (findCaseRowIndex(header, newId) > -1) return { success: false, message: '已經有一個案件叫「' + newId + '」，請換一個名稱' };

  var counts = {
    cases: renameCaseIdInSheet_(SHEET_CASES, 'CaseID', oldId, newId),
    ccd: renameCaseIdInSheet_(SHEET_CCD_REQUIREMENTS, 'CaseID', oldId, newId),
    companies: renameCaseIdInSheet_(SHEET_CASE_COMPANIES, 'CaseID', oldId, newId),
    contactLogs: renameCaseIdInSheet_(SHEET_CONTACT_LOGS, 'CaseID', oldId, newId),
    priceHistory: renameCaseIdInSheet_(SHEET_PRICE_HISTORY, 'CaseID', oldId, newId),
  };
  updateRowFields(SHEET_CASES, rowNum, { LastUpdated: todayStr() });
  return { success: true, caseId: newId, oldCaseId: oldId, counts: counts };
}

/** 整理訂購品項：最多 50 項，名稱 / 數量 / 單價都過濾。 */
function cleanOrderItems_(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 50).map(function (it) {
    var qty = Number(it && it.quantity);
    var price = Number(it && it.unitPrice);
    return { name: String((it && it.name) || '').trim().slice(0, 80), quantity: qty > 0 && qty <= 1000000 ? qty : 1, unitPrice: price >= 0 && price < 1e10 ? Math.round(price * 100) / 100 : 0 };
  }).filter(function (it) { return it.name; });
}

/**
 * 結案：result = 'cancelled' 取消 / 'won' 完成訂單。
 * 完成訂單要填成交金額（有訂購品項的話，沒填金額就用 數量 × 單價 加總）；案件狀態改成「已結案」並記下結果、金額、日期、品項；
 * 客戶的「交易狀態」自動標成已交易、最近交易日 = 結案日，並留一筆聯繫紀錄。
 */
function handleCloseCase(body) {
  return withLock_(function () {
    var caseObj = findCase(body.caseId);
    if (!caseObj) return { success: false, message: '查無此案件' };
    var won = body.result === 'won';
    if (!won && body.result !== 'cancelled') return { success: false, message: '請選擇「取消」或「完成訂單」' };
    var items = won ? cleanOrderItems_(body.items) : [];
    var amount = won ? Number(String(body.amount == null ? '' : body.amount).replace(/,/g, '')) : 0;
    if (won && !(amount > 0) && items.length) {
      amount = items.reduce(function (sum, it) { return sum + it.quantity * it.unitPrice; }, 0);
      amount = Math.round(amount * 100) / 100;
    }
    if (won && !(amount > 0)) return { success: false, message: '完成訂單請填成交金額（大於 0）' };
    if (amount >= 1e12) return { success: false, message: '金額太大，請確認' };
    var note = String(body.note || '').trim().slice(0, 500);
    var today = todayStr();
    var sheet = getSheet(SHEET_CASES);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowNum = findCaseRowIndex(header, caseObj['CaseID']);
    updateRowFields(SHEET_CASES, rowNum, {
      Status: '已結案',
      CloseResult: won ? '完成訂單' : '取消',
      CloseDate: today,
      CloseAmount: won ? amount : '',
      CloseNote: note,
      OrderItems: won && items.length ? JSON.stringify(items) : '',
      LastUpdated: today,
    });
    var customerName = String(caseObj['CustomerName'] || '');
    var customerRow = customerName ? findDuplicateCustomerRow_(customerName, 0) : 0;
    var markedTransacted = false;
    if (won && customerRow) {
      var res = applyCustomerUpdate_(customerRow, { HasTransacted: '是', LastTransactionDate: today }, {});
      markedTransacted = !res.error;
    }
    var summary = '案件結案：' + (won ? '完成訂單，成交金額 ' + amount : '取消') + (items.length ? '（' + items.map(function (it) { return it.name + '×' + it.quantity; }).join('、') + '）' : '') + (note ? '；' + note : '');
    var user = body._user || {};
    if (customerName) {
      appendContactLog_({ companyName: customerName, method: '資料修改', summary: summary, caseId: caseObj['CaseID'], changes: '案件狀態：' + (caseObj['Status'] || '') + ' → 已結案' + (won ? '\n交易狀態：已交易（' + today + '）' : '') }, user);
    }
    return { success: true, status: '已結案', result: won ? '完成訂單' : '取消', amount: won ? amount : 0, closeDate: today, markedTransacted: markedTransacted };
  });
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
  var access = accessOf_(findUserRow_(me));
  var ctx = wsShareCtx_(me);
  sheetToObjects(SHEET_MEMOS).rows.forEach(function (r, i) {
    var mine = r['Owner'] === me;
    if (!mine && !wsVisible_(r, me, ctx.myGroups)) return;
    var need = String(r['NeedBlock'] || '');
    if (need && !mine && access.blocks[need] === 'none') return; // 機器人通知只有有「BOT 設定」權限的人看得到
    var mode = wsMode_(r);
    rows.push({
      RowIndex: i + 2,
      Title: r['Title'],
      Content: r['Content'],
      Shared: mode === 'all',
      ShareMode: mode,
      ShareWith: mine || access.isAdmin ? wsParseList_(r['ShareWith']) : [],
      ShareLabel: wsShareLabel_(mode, r['ShareWith'], ctx),
      LinkType: r['LinkType'] || '',
      CanManage: mine || access.isAdmin || (!!need && access.blocks[need] === 'edit'),
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
  var share = wsCleanShare_(body.shareMode !== undefined ? body.shareMode : body.shared ? 'all' : 'self', body.shareWith, body._user.username);
  appendObjectRow(SHEET_MEMOS, {
    Owner: body._user.username,
    OwnerName: body._user.displayName || body._user.username,
    Title: body.title || '',
    Content: body.content || '',
    Shared: share.mode === 'all' ? '是' : '',
    ShareMode: share.mode,
    ShareWith: share.withJson,
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
  var need = String(memo['NeedBlock'] || '');
  var canManageSystem = !!need && accessOf_(user).blocks[need] === 'edit'; // 機器人通知：有「BOT 設定」編輯權限的人可以處理
  if (memo['LinkType'] === 'staffAudit' && !isAdmin) throw new Error('助理紀錄是稽核用的，只有系統管理員可以修改或刪除');
  if (memo['Owner'] !== body._user.username && !isAdmin && !canManageSystem) throw new Error('只有備忘錄的建立者可以修改或刪除');
  return rowNum;
}

function handleUpdateMemo(body) {
  var rowNum = checkMemoOwner_(body);
  var f = body.fields || {};
  var fields = { LastUpdated: todayStr() };
  if (f.Title !== undefined) fields.Title = f.Title;
  if (f.Content !== undefined) fields.Content = f.Content;
  if (f.Shared !== undefined && f.ShareMode === undefined) f.ShareMode = f.Shared ? 'all' : 'self';
  if (f.ShareMode !== undefined) {
    var owner = String(readRowAsObject(SHEET_MEMOS, rowNum)['Owner'] || body._user.username);
    var sh = wsCleanShare_(f.ShareMode, f.ShareWith, owner);
    fields.ShareMode = sh.mode;
    fields.ShareWith = sh.withJson;
    fields.Shared = sh.mode === 'all' ? '是' : '';
  }
  updateRowFields(SHEET_MEMOS, rowNum, fields);
  return { success: true };
}

function handleDeleteMemo(body) {
  var rowNum = checkMemoOwner_(body);
  var memo = readRowAsObject(SHEET_MEMOS, rowNum);
  getSheet(SHEET_MEMOS).deleteRow(rowNum);
  if (typeof botAlertsBust_ === 'function') botAlertsBust_(); // 通知被刪掉 → 右下角提醒也跟著消失
  // 「客人找真人」通知被處理掉 = 小編處理完了，機器人恢復回覆這位客人
  if (memo['LinkType'] === 'csHandoff' && memo['LinkId'] && typeof csResume_ === 'function') {
    try {
      csResume_(String(memo['LinkId']));
    } catch (e) {
      // 恢復失敗不影響刪除
    }
  }
  return { success: true };
}

// ============================================================
// 個人工作區：行事曆 / 工作清單 / 備忘錄（每個帳號各自獨立）與群組
//   ・分享對象 ShareMode：self 只有自己（預設）/ users 指定帳號 / groups 自訂群組 / all 全部同事
//   ・被分享的人「只能查看」；修改、刪除只有擁有者（系統管理員可處理他人分享出來的）
//   ・個人資料不走功能區塊權限，登入就能用自己的；分享也不會放寬任何人的編輯權限
//   ・客戶的「下次追蹤」會自動寫進操作者自己的行事曆（Source = followup）
// ============================================================
var WS_SHARE_MODES = ['self', 'users', 'groups', 'all'];
var WS_PRIORITIES = ['高', '中', '低'];
var WS_TODO_STATUS = ['todo', 'doing', 'done'];
var WS_MAX_RANGE_DAYS = 400;

function wsParseList_(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw === '' || raw == null) return [];
  try {
    var v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

/** 分享對象的模式；舊的備忘錄只有「Shared = 是」視為分享給全部。 */
function wsMode_(row) {
  var m = String(row['ShareMode'] || '');
  if (!m && String(row['Shared']) === '是') return 'all';
  return m === 'users' || m === 'groups' || m === 'all' ? m : 'self';
}

function wsUserRows_() {
  return sheetToObjects(SHEET_USERS).rows;
}

function wsGroupRows_() {
  return sheetToObjects(SHEET_GROUPS).rows.map(function (r, i) {
    return { RowIndex: i + 2, id: Number(r['ID']) || 0, name: String(r['Name'] || ''), members: wsParseList_(r['Members']).map(String), createdBy: String(r['CreatedBy'] || '') };
  });
}

/** 讀分享用的對照表（帳號顯示名稱、群組、我所屬的群組）。 */
function wsShareCtx_(me) {
  var names = {};
  wsUserRows_().forEach(function (u) { names[String(u['Username'])] = String(u['DisplayName'] || u['Username']); });
  var groups = wsGroupRows_();
  var byId = {};
  var mine = [];
  groups.forEach(function (g) {
    byId[g.id] = g;
    if (g.members.indexOf(me) > -1) mine.push(g.id);
  });
  return { names: names, groups: byId, myGroups: mine };
}

/** 這筆資料我看不看得到（自己的、指定我的、我所屬群組的、全部）。 */
function wsVisible_(row, me, myGroups) {
  if (String(row['Owner']) === me) return true;
  var mode = wsMode_(row);
  if (mode === 'all') return true;
  var w = wsParseList_(row['ShareWith']);
  if (mode === 'users') return w.map(String).indexOf(me) > -1;
  if (mode === 'groups') return w.some(function (g) { return myGroups.indexOf(Number(g)) > -1; });
  return false;
}

/** 整理分享設定：帳號 / 群組都要真的存在；選了對象卻是空的，退回「只有自己」。 */
function wsCleanShare_(mode, withList, owner) {
  mode = WS_SHARE_MODES.indexOf(mode) > -1 ? mode : 'self';
  var list = wsParseList_(withList);
  if (mode === 'users') {
    var have = {};
    wsUserRows_().forEach(function (u) { have[String(u['Username'])] = true; });
    var seen = {};
    list = list.map(String).filter(function (u) {
      if (!have[u] || u === owner || seen[u]) return false;
      seen[u] = true;
      return true;
    }).slice(0, 100);
    if (!list.length) mode = 'self';
  } else if (mode === 'groups') {
    var gs = {};
    wsGroupRows_().forEach(function (g) { gs[g.id] = true; });
    var seenG = {};
    list = list.map(Number).filter(function (g) {
      if (!gs[g] || seenG[g]) return false;
      seenG[g] = true;
      return true;
    }).slice(0, 50);
    if (!list.length) mode = 'self';
  } else {
    list = [];
  }
  return { mode: mode, with: list, withJson: JSON.stringify(list) };
}

function wsShareLabel_(mode, withRaw, ctx) {
  if (mode === 'all') return '全部同事（只能看）';
  var w = wsParseList_(withRaw);
  if (mode === 'users') return '指定 ' + w.length + ' 人：' + w.slice(0, 3).map(function (u) { return ctx.names[String(u)] || u; }).join('、') + (w.length > 3 ? '…' : '');
  if (mode === 'groups') return '群組：' + w.map(function (g) { return ctx.groups[Number(g)] ? ctx.groups[Number(g)].name : '（已刪除的群組）'; }).join('、');
  return '只有自己';
}

function wsIsAdmin_(username) {
  return !!(username && accessOf_(findUserRow_(username)).isAdmin);
}

function wsNextId_(sheetName) {
  var max = 0;
  sheetToObjects(sheetName).rows.forEach(function (r) { max = Math.max(max, Number(r['ID']) || 0); });
  return max + 1;
}

function wsFindById_(sheetName, id) {
  var rows = sheetToObjects(sheetName).rows;
  for (var i = 0; i < rows.length; i++) if (Number(rows[i]['ID']) === Number(id)) return { rowIndex: i + 2, row: rows[i] };
  return null;
}

function wsClip_(v, n) {
  return String(v == null ? '' : v).trim().slice(0, n);
}

function wsTimeAdd_(time, minutes) {
  var m = time.match(/^(\d{2}):(\d{2})$/);
  var total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + minutes);
  return ('0' + Math.floor(total / 60)).slice(-2) + ':' + ('0' + (total % 60)).slice(-2);
}

// ------------------------------------------------------------
// 行事曆
// ------------------------------------------------------------
/** 整理一筆行程的輸入；不合法就丟錯誤（訊息給使用者看）。 */
function wsCleanEvent_(b) {
  var title = wsClip_(b.title, 200);
  if (!title) throw new Error('行程標題不能空白');
  var startDate = dateKey_(b.startDate);
  if (!startDate || !isDateStr(startDate)) throw new Error('日期要是 YYYY-MM-DD');
  var startTime = normTimeStr_(b.startTime);
  if (String(b.startTime || '').trim() && !startTime) throw new Error('開始時間要是 HH:mm');
  var allDay = b.allDay === true || b.allDay === 'true' || !startTime;
  var endDate = b.endDate ? dateKey_(b.endDate) : startDate;
  if (!endDate || !isDateStr(endDate)) throw new Error('結束日期要是 YYYY-MM-DD');
  if (endDate < startDate) throw new Error('結束日期不能早於開始日期');
  if (Math.round((new Date(endDate + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000) > 60) throw new Error('單一行程最多跨 60 天');
  var endTime = '';
  if (!allDay) {
    endTime = normTimeStr_(b.endTime);
    if (String(b.endTime || '').trim() && !endTime) throw new Error('結束時間要是 HH:mm');
    if (!endTime) endTime = wsTimeAdd_(startTime, 60);
    if (endDate === startDate && endTime < startTime) throw new Error('結束時間不能早於開始時間');
  } else {
    startTime = '';
  }
  return { title: title, startDate: startDate, startTime: startTime, endDate: endDate, endTime: endTime, allDay: allDay, location: wsClip_(b.location, 200), notes: wsClip_(b.notes, 2000) };
}

function wsEventOut_(r, me, ctx, isAdmin) {
  var mode = wsMode_(r);
  var mine = String(r['Owner']) === me;
  return {
    id: Number(r['ID']) || 0,
    title: String(r['Title'] || ''),
    startDate: dateKey_(r['StartDate']),
    startTime: normTimeStr_(r['StartTime']),
    endDate: dateKey_(r['EndDate']) || dateKey_(r['StartDate']),
    endTime: normTimeStr_(r['EndTime']),
    allDay: !(r['AllDay'] === false || String(r['AllDay']).toUpperCase() === 'FALSE'),
    location: String(r['Location'] || ''),
    notes: String(r['Notes'] || ''),
    shareMode: mode,
    shareWith: mine || isAdmin ? wsParseList_(r['ShareWith']) : [],
    shareLabel: wsShareLabel_(mode, r['ShareWith'], ctx),
    source: String(r['Source'] || 'manual'),
    refKey: String(r['RefKey'] || ''),
    owner: String(r['Owner'] || ''),
    ownerName: ctx.names[String(r['Owner'])] || String(r['Owner'] || ''),
    isMine: mine,
    canEdit: mine || isAdmin,
  };
}

/** 某人看得到的行程（日期區間內有重疊的）。scope：mine / shared（別人分享給我的）/ all。 */
function wsEventsFor_(me, from, to, scope) {
  var ctx = wsShareCtx_(me);
  var isAdmin = wsIsAdmin_(me);
  var out = [];
  sheetToObjects(SHEET_CAL).rows.forEach(function (r) {
    var mine = String(r['Owner']) === me;
    if (scope === 'mine' && !mine) return;
    if (scope === 'shared' && mine) return;
    if (!wsVisible_(r, me, ctx.myGroups)) return;
    var sd = dateKey_(r['StartDate']);
    var ed = dateKey_(r['EndDate']) || sd;
    if (!sd || sd > to || ed < from) return;
    out.push(wsEventOut_(r, me, ctx, isAdmin));
  });
  out.sort(function (a, b) {
    return a.startDate.localeCompare(b.startDate) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.startTime.localeCompare(b.startTime) || a.id - b.id;
  });
  return out;
}

function wsEventBrief_(e) {
  return { id: e.isMine ? e.id : undefined, date: e.startDate, endDate: e.endDate !== e.startDate ? e.endDate : undefined, time: e.allDay ? '全天' : e.startTime + '–' + e.endTime, title: e.title, location: e.location || undefined, from: e.isMine ? undefined : e.ownerName, followup: e.source === 'followup' ? true : undefined };
}

function wsRangeFrom_(body) {
  var from = body.from ? dateKey_(body.from) : todayStr();
  if (!isDateStr(from)) throw new Error('起始日期要是 YYYY-MM-DD');
  var to = body.to ? dateKey_(body.to) : addDaysStr(from, 30);
  if (!isDateStr(to)) throw new Error('結束日期要是 YYYY-MM-DD');
  if (to < from) throw new Error('結束日期不能早於起始日期');
  if (Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) > WS_MAX_RANGE_DAYS) throw new Error('一次最多查 ' + WS_MAX_RANGE_DAYS + ' 天');
  return { from: from, to: to };
}

function handleCalGetEvents(body) {
  var r;
  try {
    r = wsRangeFrom_(body);
  } catch (e) {
    return { success: false, message: e.message };
  }
  var scope = body.scope === 'mine' || body.scope === 'shared' ? body.scope : 'all';
  return { success: true, from: r.from, to: r.to, today: todayStr(), events: wsEventsFor_(body._user.username, r.from, r.to, scope) };
}

function handleCalSaveEvent(body) {
  var me = body._user.username;
  return withLock_(function () {
    var c;
    try {
      c = wsCleanEvent_(body);
    } catch (e) {
      return { success: false, message: e.message };
    }
    var id = Number(body.id) || 0;
    var now = nowStr();
    if (id) {
      var found = wsFindById_(SHEET_CAL, id);
      if (!found) return { success: false, message: '找不到這個行程（可能已被刪除）' };
      var owner = String(found.row['Owner']);
      if (owner !== me && !wsIsAdmin_(me)) return { success: false, message: '這是別人的行程，只有擁有者可以修改' };
      var fields = { Title: c.title, StartDate: c.startDate, StartTime: c.startTime, EndDate: c.endDate, EndTime: c.endTime, AllDay: c.allDay, Location: c.location, Notes: c.notes, UpdatedAt: now };
      // 客戶追蹤提醒的標題 / 時間 / 內容由客戶資料自動同步，這裡只能改「誰看得到」
      if (String(found.row['Source']) === 'followup') fields = { UpdatedAt: now };
      if (body.shareMode !== undefined) {
        var sh = wsCleanShare_(body.shareMode, body.shareWith, owner);
        fields.ShareMode = sh.mode;
        fields.ShareWith = sh.withJson;
      }
      updateRowFields(SHEET_CAL, found.rowIndex, fields);
      return { success: true, id: id };
    }
    var share = wsCleanShare_(body.shareMode, body.shareWith, me);
    id = wsNextId_(SHEET_CAL);
    appendObjectRow(SHEET_CAL, { ID: id, Owner: me, Title: c.title, StartDate: c.startDate, StartTime: c.startTime, EndDate: c.endDate, EndTime: c.endTime, AllDay: c.allDay, Location: c.location, Notes: c.notes, ShareMode: share.mode, ShareWith: share.withJson, Source: 'manual', RefKey: '', CreatedAt: now, UpdatedAt: now });
    return { success: true, id: id };
  });
}

function handleCalDeleteEvent(body) {
  var me = body._user.username;
  return withLock_(function () {
    var found = wsFindById_(SHEET_CAL, body.id);
    if (!found) return { success: false, message: '找不到這個行程（可能已被刪除）' };
    if (String(found.row['Owner']) !== me && !wsIsAdmin_(me)) return { success: false, message: '這是別人的行程，只有擁有者可以刪除' };
    getSheet(SHEET_CAL).deleteRow(found.rowIndex);
    return { success: true };
  });
}

// ------------------------------------------------------------
// 客戶「下次追蹤」→ 操作者自己的行事曆
// ------------------------------------------------------------
function wsActorOk_() {
  return !!(WS_ACTOR_ && findUserRow_(WS_ACTOR_));
}

/** 新增 / 改期 / 不再追蹤時同步（公司改名時 oldName 是舊名稱）。追蹤事件永遠只有自己看得到，只放在「現在負責的人」的行事曆。 */
function wsSyncFollowUp_(customer, oldName) {
  var name = String(customer['CompanyName'] || '');
  var keys = [name];
  if (oldName && oldName !== name) keys.push(String(oldName));
  var rows = sheetToObjects(SHEET_CAL).rows;
  var hits = [];
  rows.forEach(function (r, i) {
    if (String(r['Source']) === 'followup' && keys.indexOf(String(r['RefKey'])) > -1) hits.push({ rowIndex: i + 2, row: r });
  });
  var ds = dateKey_(customer['NextFollowUpDate']);
  if (!ds) {
    hits.slice().sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (h) { getSheet(SHEET_CAL).deleteRow(h.rowIndex); });
    return;
  }
  if (!wsActorOk_()) return; // 沒辦法確定是誰在操作（例如沒綁定帳號的 LINE），就不動行事曆
  var time = normTimeStr_(customer['NextFollowUpTime']);
  var f = {
    Owner: WS_ACTOR_,
    Title: '客戶追蹤：' + name + (customer['Contact'] ? '（' + customer['Contact'] + '）' : ''),
    StartDate: ds,
    StartTime: time,
    EndDate: ds,
    EndTime: time ? wsTimeAdd_(time, 60) : '',
    AllDay: !time,
    Notes: String(customer['NextFollowUpNote'] || ''),
    ShareMode: 'self',
    ShareWith: '[]',
    Source: 'followup',
    RefKey: name,
    UpdatedAt: nowStr(),
  };
  if (hits.length) {
    // 同一位負責人改期 / 改內容時，保留他已經設定的「誰看得到」；換了負責人就回到只有新負責人自己看得到
    if (String(hits[0].row['Owner']) === WS_ACTOR_) {
      delete f.ShareMode;
      delete f.ShareWith;
    }
    updateRowFields(SHEET_CAL, hits[0].rowIndex, f);
    hits.slice(1).sort(function (a, b) { return b.rowIndex - a.rowIndex; }).forEach(function (h) { getSheet(SHEET_CAL).deleteRow(h.rowIndex); });
    return;
  }
  f.ID = wsNextId_(SHEET_CAL);
  f.CreatedAt = nowStr();
  appendObjectRow(SHEET_CAL, f);
}

function wsRemoveFollowUp_(name) {
  var rows = sheetToObjects(SHEET_CAL).rows;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i]['Source']) === 'followup' && String(rows[i]['RefKey']) === String(name)) getSheet(SHEET_CAL).deleteRow(i + 2);
  }
}

/** setup 時把既有客戶的下次追蹤放進內建行事曆（只做一次）：負責人 = 該客戶進行中案件的業務（對得到帳號），否則第一位管理員。 */
function wsMigrateFollowUps_(log) {
  if (getConfig('WsFollowUpMigrated') === 'yes') return;
  var users = wsUserRows_();
  var byKey = {};
  var firstAdmin = '';
  users.forEach(function (u) {
    var un = String(u['Username']);
    byKey[un.toLowerCase()] = un;
    if (u['DisplayName']) byKey[String(u['DisplayName']).toLowerCase()] = un;
    if (!firstAdmin && u['Role'] === 'admin') firstAdmin = un;
  });
  if (!firstAdmin) return;
  var owners = {};
  sheetToObjects(SHEET_CASES).rows.forEach(function (c) {
    if (c['Status'] === '已結案') return;
    var u = byKey[String(c['Salesperson'] || '').trim().toLowerCase()];
    if (u && !owners[c['CustomerName']]) owners[c['CustomerName']] = u;
  });
  var have = {};
  sheetToObjects(SHEET_CAL).rows.forEach(function (r) { if (String(r['Source']) === 'followup') have[String(r['RefKey'])] = true; });
  var made = 0;
  var saved = WS_ACTOR_;
  sheetToObjects(SHEET_CUSTOMERS).rows.forEach(function (c) {
    var name = String(c['CompanyName'] || '');
    if (!name || have[name] || !dateKey_(c['NextFollowUpDate'])) return;
    WS_ACTOR_ = owners[name] || firstAdmin;
    wsSyncFollowUp_(c, '');
    made++;
  });
  WS_ACTOR_ = saved;
  setConfig('WsFollowUpMigrated', 'yes');
  if (log) log.push('客戶追蹤日放進內建行事曆：' + made + ' 筆（負責人依進行中案件的業務，找不到就放第一位管理員）');
}

// ------------------------------------------------------------
// 工作清單
// ------------------------------------------------------------
function wsCleanTodo_(b) {
  var title = wsClip_(b.title, 200);
  if (!title) throw new Error('工作標題不能空白');
  var due = b.dueDate ? dateKey_(b.dueDate) : '';
  if (b.dueDate && (!due || !isDateStr(due))) throw new Error('期限要是 YYYY-MM-DD');
  var priority = WS_PRIORITIES.indexOf(b.priority) > -1 ? b.priority : '中';
  return { title: title, notes: wsClip_(b.notes, 2000), dueDate: due || '', priority: priority };
}

function wsTodoOut_(r, me, ctx, isAdmin) {
  var mode = wsMode_(r);
  var mine = String(r['Owner']) === me;
  var st = WS_TODO_STATUS.indexOf(r['Status']) > -1 ? r['Status'] : 'todo';
  return {
    id: Number(r['ID']) || 0,
    title: String(r['Title'] || ''),
    notes: String(r['Notes'] || ''),
    dueDate: dateKey_(r['DueDate']),
    priority: WS_PRIORITIES.indexOf(r['Priority']) > -1 ? r['Priority'] : '中',
    status: st,
    shareMode: mode,
    shareWith: mine || isAdmin ? wsParseList_(r['ShareWith']) : [],
    shareLabel: wsShareLabel_(mode, r['ShareWith'], ctx),
    owner: String(r['Owner'] || ''),
    ownerName: ctx.names[String(r['Owner'])] || String(r['Owner'] || ''),
    isMine: mine,
    canEdit: mine || isAdmin,
    createdAt: String(r['CreatedAt'] || ''),
    doneAt: String(r['DoneAt'] || ''),
  };
}

/** status：open（未完成）/ done / all；scope：mine / shared / all。排序：未完成在前 → 期限（沒期限最後）→ 優先度。 */
function wsTodosFor_(me, scope, status) {
  var ctx = wsShareCtx_(me);
  var isAdmin = wsIsAdmin_(me);
  var rank = { 高: 0, 中: 1, 低: 2 };
  var out = [];
  sheetToObjects(SHEET_TODOS).rows.forEach(function (r) {
    var mine = String(r['Owner']) === me;
    if (scope === 'mine' && !mine) return;
    if (scope === 'shared' && mine) return;
    if (!wsVisible_(r, me, ctx.myGroups)) return;
    var t = wsTodoOut_(r, me, ctx, isAdmin);
    if (status === 'open' && t.status === 'done') return;
    if (status === 'done' && t.status !== 'done') return;
    out.push(t);
  });
  out.sort(function (a, b) {
    return (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || rank[a.priority] - rank[b.priority] || a.id - b.id;
  });
  return out;
}

function wsTodoBrief_(t) {
  return { id: t.id, title: t.title, dueDate: t.dueDate || undefined, priority: t.priority, status: t.status, notes: t.notes ? t.notes.slice(0, 100) : undefined, from: t.isMine ? undefined : t.ownerName };
}

function handleTodoGet(body) {
  var scope = body.scope === 'mine' || body.scope === 'shared' ? body.scope : 'all';
  var status = body.status === 'done' || body.status === 'all' ? body.status : 'open';
  return { success: true, today: todayStr(), todos: wsTodosFor_(body._user.username, scope, status) };
}

function handleTodoSave(body) {
  var me = body._user.username;
  return withLock_(function () {
    var c;
    try {
      c = wsCleanTodo_(body);
    } catch (e) {
      return { success: false, message: e.message };
    }
    var id = Number(body.id) || 0;
    var now = nowStr();
    if (id) {
      var found = wsFindById_(SHEET_TODOS, id);
      if (!found) return { success: false, message: '找不到這個工作（可能已被刪除）' };
      var owner = String(found.row['Owner']);
      if (owner !== me && !wsIsAdmin_(me)) return { success: false, message: '這是別人的工作，只有擁有者可以修改' };
      var fields = { Title: c.title, Notes: c.notes, DueDate: c.dueDate, Priority: c.priority, UpdatedAt: now };
      if (body.shareMode !== undefined) {
        var sh = wsCleanShare_(body.shareMode, body.shareWith, owner);
        fields.ShareMode = sh.mode;
        fields.ShareWith = sh.withJson;
      }
      updateRowFields(SHEET_TODOS, found.rowIndex, fields);
      return { success: true, id: id };
    }
    var share = wsCleanShare_(body.shareMode, body.shareWith, me);
    id = wsNextId_(SHEET_TODOS);
    appendObjectRow(SHEET_TODOS, { ID: id, Owner: me, Title: c.title, Notes: c.notes, DueDate: c.dueDate, Priority: c.priority, Status: 'todo', ShareMode: share.mode, ShareWith: share.withJson, CreatedAt: now, UpdatedAt: now, DoneAt: '' });
    return { success: true, id: id };
  });
}

function handleTodoSetStatus(body) {
  var me = body._user.username;
  return withLock_(function () {
    var found = wsFindById_(SHEET_TODOS, body.id);
    if (!found) return { success: false, message: '找不到這個工作（可能已被刪除）' };
    if (String(found.row['Owner']) !== me && !wsIsAdmin_(me)) return { success: false, message: '這是別人的工作，只有擁有者可以更改狀態' };
    if (WS_TODO_STATUS.indexOf(body.status) < 0) return { success: false, message: '狀態只能是 todo / doing / done' };
    updateRowFields(SHEET_TODOS, found.rowIndex, { Status: body.status, DoneAt: body.status === 'done' ? nowStr() : '', UpdatedAt: nowStr() });
    return { success: true };
  });
}

function handleTodoDelete(body) {
  var me = body._user.username;
  return withLock_(function () {
    var found = wsFindById_(SHEET_TODOS, body.id);
    if (!found) return { success: false, message: '找不到這個工作（可能已被刪除）' };
    if (String(found.row['Owner']) !== me && !wsIsAdmin_(me)) return { success: false, message: '這是別人的工作，只有擁有者可以刪除' };
    getSheet(SHEET_TODOS).deleteRow(found.rowIndex);
    return { success: true };
  });
}

// ------------------------------------------------------------
// 群組（系統管理員在「帳號管理」建立）與分享對象清單
// ------------------------------------------------------------
/** 選分享對象用：所有帳號（顯示名稱）與群組；群組成員只給管理員看。 */
function handleGetShareTargets(body) {
  var me = body._user.username;
  var isAdmin = wsIsAdmin_(me);
  return {
    success: true,
    me: me,
    users: wsUserRows_().map(function (u) { return { username: String(u['Username']), name: String(u['DisplayName'] || u['Username']) }; }),
    groups: wsGroupRows_().map(function (g) { return { id: g.id, name: g.name, count: g.members.length, isMember: g.members.indexOf(me) > -1, members: isAdmin ? g.members : undefined }; }),
  };
}

function handleGroupGetAll(body) {
  return { success: true, groups: wsGroupRows_(), users: wsUserRows_().map(function (u) { return { username: String(u['Username']), name: String(u['DisplayName'] || u['Username']) }; }) };
}

function handleGroupSave(body) {
  return withLock_(function () {
    var name = wsClip_(body.name, 40);
    if (!name) return { success: false, message: '群組名稱不能空白' };
    var groups = wsGroupRows_();
    var id = Number(body.id) || 0;
    if (groups.some(function (g) { return g.id !== id && g.name.toLowerCase() === name.toLowerCase(); })) return { success: false, message: '已經有叫「' + name + '」的群組了' };
    var have = {};
    wsUserRows_().forEach(function (u) { have[String(u['Username'])] = true; });
    var seen = {};
    var members = wsParseList_(body.members).map(String).filter(function (u) {
      if (!have[u] || seen[u]) return false;
      seen[u] = true;
      return true;
    });
    if (id) {
      var found = groups.filter(function (g) { return g.id === id; })[0];
      if (!found) return { success: false, message: '找不到這個群組' };
      updateRowFields(SHEET_GROUPS, found.RowIndex, { Name: name, Members: JSON.stringify(members) });
      return { success: true, id: id };
    }
    id = wsNextId_(SHEET_GROUPS);
    appendObjectRow(SHEET_GROUPS, { ID: id, Name: name, Members: JSON.stringify(members), CreatedBy: body._user.username });
    return { success: true, id: id };
  });
}

/** 刪除群組：已經分享給這個群組的資料不會被刪，但沒有人再看得到（改分享對象即可恢復）。 */
function handleGroupDelete(body) {
  return withLock_(function () {
    var found = wsGroupRows_().filter(function (g) { return g.id === Number(body.id); })[0];
    if (!found) return { success: false, message: '找不到這個群組' };
    getSheet(SHEET_GROUPS).deleteRow(found.RowIndex);
    return { success: true };
  });
}

function handleWsGetSettings(body) {
  return { success: true, googleCalSync: getConfig('GoogleCalSync') === 'on' };
}

function handleWsSaveSettings(body) {
  setConfig('GoogleCalSync', body.googleCalSync === true ? 'on' : '');
  return { success: true, googleCalSync: body.googleCalSync === true };
}

/** （選用）讀取執行者(部署網頁應用程式的那個 Google 帳號)預設行事曆，從今天起 days 天內的行程。 */
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
/** 預約時間統一成 HH:mm 字串（儲存格如果被轉成時間值也還原）；空值回傳空字串。 */
function normTimeStr_(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+8', 'HH:mm');
  var m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function handleGetCustomers(body) {
  var sheet = getSheet(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: true, customers: [] };
  var header = data[0];
  var customers = data.slice(1).map(function (r, i) {
    var obj = rowToObject(header, r);
    obj.RowIndex = i + 2;
    var ti = header.indexOf('NextFollowUpTime');
    if (ti > -1) obj.NextFollowUpTime = normTimeStr_(r[ti]);
    return obj;
  });
  return { success: true, customers: customers };
}

/** 日期統一成 yyyy-MM-dd（Date 物件、2026/9/3 這類手打的也可以）；不是日期回傳空字串。 */
function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+8', 'yyyy-MM-dd');
  var m = String(v == null ? '' : v).match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}

/**
 * 客戶的下次追蹤同步到執行者的 Google 日曆：
 *  - 有預約時間 → 有時間的行程（預設 1 小時）；沒有 → 整天行程；
 *  - 下次追蹤日清空（不再追蹤）→ 把之前建立的行程刪掉。
 */
function syncCustomerFollowUpToCalendar(rowNum, header, sheet, customer, oldName) {
  wsSyncFollowUp_(customer, oldName); // 內建行事曆：寫進操作者自己的（一定做）
  if (getConfig('GoogleCalSync') !== 'on') return; // Google 日曆同步是選用功能，預設關閉（管理員在「帳號管理 → 群組與行事曆」開啟）
  var eventIdCol = header.indexOf('CalendarEventId');
  var existingId = eventIdCol > -1 ? String(customer['CalendarEventId'] || '') : '';
  var ds = dateKey_(customer['NextFollowUpDate']);
  try {
    var calendar = CalendarApp.getDefaultCalendar();
    if (!ds) {
      if (existingId) {
        var oldEvent = calendar.getEventById(existingId);
        if (oldEvent) oldEvent.deleteEvent();
        sheet.getRange(rowNum, eventIdCol + 1).setValue('');
      }
      return;
    }
    var title = '[AOI客戶追蹤] ' + customer['CompanyName'] + (customer['Contact'] ? '（' + customer['Contact'] + '）' : '');
    var day = new Date(ds + 'T12:00:00+08:00'); // 用台灣當天中午代表「這一天」，不管專案時區設定都不會差一天
    var time = normTimeStr_(customer['NextFollowUpTime']);
    var desc = (time ? '預約時間：' + time + '\n' : '') + (customer['NextFollowUpNote'] ? '下次洽談內容：\n' + customer['NextFollowUpNote'] : '');
    var start = null;
    var end = null;
    if (time) {
      start = new Date(ds + 'T' + time + ':00+08:00');
      end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    if (existingId) {
      var existingEvent = calendar.getEventById(existingId);
      if (existingEvent) {
        // 整天 ↔ 有時間 互相切換時沒辦法直接改，刪掉重建
        if (existingEvent.isAllDayEvent() === !!time) {
          existingEvent.deleteEvent();
        } else {
          existingEvent.setTitle(title);
          if (time) existingEvent.setTime(start, end);
          else existingEvent.setAllDayDate(day);
          existingEvent.setDescription(desc);
          return;
        }
      }
    }

    var newEvent = time ? calendar.createEvent(title, start, end, { description: desc }) : calendar.createAllDayEvent(title, day, { description: desc });
    if (eventIdCol > -1) sheet.getRange(rowNum, eventIdCol + 1).setValue(newEvent.getId());
  } catch (calErr) {
    Logger.log('日曆同步失敗: ' + calErr.message);
  }
}

/** 公司名稱比對用：去頭尾空白與中間空白、全形轉半形、不分大小寫，「ＡＢＣ 公司」和「abc公司」視為同一間。 */
function normCompanyName_(s) {
  return String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 回傳 Customers 裡已有同名公司的列號（excludeRow 這一列不算，改名時用）；沒有重複回傳 0。 */
function findDuplicateCustomerRow_(name, excludeRow) {
  var key = normCompanyName_(name);
  if (!key) return 0;
  var rows = sheetToObjects(SHEET_CUSTOMERS).rows;
  for (var i = 0; i < rows.length; i++) {
    if (i + 2 !== excludeRow && normCompanyName_(rows[i]['CompanyName']) === key) return i + 2;
  }
  return 0;
}

/** 公司網址整理：沒寫 http 開頭就補 https://；只接受 http / https（避免存進 javascript: 之類的連結）。不合法回傳 null。 */
function cleanWebsite_(v) {
  var u = String(v == null ? '' : v).trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  if (!/^https?:\/\/[^\s\/]+\.[^\s]{2,}/i.test(u) || u.length > 300) return null;
  return u;
}

function handleAddCustomer(body) {
  if (!String(body.companyName || '').trim()) return { success: false, message: '公司名稱不能空白' };
  var dup = findDuplicateCustomerRow_(body.companyName, 0);
  if (dup) return { success: false, message: '已經有「' + String(body.companyName).trim() + '」這間客戶了（第 ' + dup + ' 列），不能重複新增。要補資料請直接編輯那一筆。' };
  var website = cleanWebsite_(body.website);
  if (website === null) return { success: false, message: '公司網址格式不正確（例如 www.example.com 或 https://www.example.com）' };
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
    NextFollowUpNote: body.nextFollowUpNote || '',
    NextFollowUpTime: normTimeStr_(body.nextFollowUpTime),
    CompanyPhone: body.companyPhone || '',
    TaxId: body.taxId || '',
    Address: body.address || '',
    Website: website,
  };

  appendObjectRow(SHEET_CUSTOMERS, customer);
  var rowNum = sheet.getLastRow();
  syncCustomerFollowUpToCalendar(rowNum, header, sheet, customer);

  return { success: true };
}

// ---- 客戶資料修改：比對差異、記下修改紀錄、公司改名連動 ----
/** 會記進「修改紀錄」的客戶欄位與中文名稱。 */
var CUSTOMER_FIELD_LABELS = {
  CompanyName: '公司名稱',
  Contact: '聯絡人',
  Phone: '聯繫人電話',
  Email: 'Email',
  CompanyPhone: '公司電話',
  TaxId: '統一編號',
  Address: '地址',
  Website: '公司網址',
  Category: '分類',
  Urgency: '急迫性',
  Notes: '客戶備註',
  HasTransacted: '交易狀態',
  LastTransactionDate: '最近交易日',
  NextFollowUpDate: '下次追蹤日',
  NextFollowUpTime: '預約時間',
  NextFollowUpNote: '下次洽談內容',
};
var CUSTOMER_FOLLOW_FIELDS = ['NextFollowUpDate', 'NextFollowUpTime', 'NextFollowUpNote'];

/** 比對用的值：日期轉 yyyy-MM-dd、時間轉 HH:mm、其他轉字串去頭尾空白。 */
function custVal_(field, v) {
  if (v == null) return '';
  if (field === 'NextFollowUpTime') return normTimeStr_(v);
  if (field === 'NextFollowUpDate' || field === 'LastTransactionDate') return dateKey_(v) || String(v).trim();
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+8', 'yyyy-MM-dd');
  return String(v).replace(/\r\n/g, '\n').trim();
}

function clip_(v, n) {
  var t = String(v == null ? '' : v).replace(/\s*\n\s*/g, ' / ');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 這次修改的中文說明，一項一行，例如「聯絡人：王先生 → 李小姐」。 */
function describeCustomerChanges_(oldObj, newObj, changed) {
  var has = function (f) {
    return changed.indexOf(f) > -1;
  };
  var show = function (v) {
    return v === '' ? '（空白）' : v;
  };
  var lines = [];
  ['CompanyName', 'Contact', 'Phone', 'Email', 'CompanyPhone', 'TaxId', 'Address', 'Website', 'Category', 'Urgency'].forEach(function (f) {
    if (has(f)) lines.push(CUSTOMER_FIELD_LABELS[f] + '：' + show(clip_(custVal_(f, oldObj[f]), 60)) + ' → ' + show(clip_(custVal_(f, newObj[f]), 60)));
  });
  if (has('HasTransacted') || has('LastTransactionDate')) {
    var tx = function (o) {
      var d = custVal_('LastTransactionDate', o.LastTransactionDate);
      return custVal_('HasTransacted', o.HasTransacted) === '是' || d ? '已交易' + (d ? '（' + d + '）' : '') : '未交易';
    };
    lines.push('交易狀態：' + tx(oldObj) + ' → ' + tx(newObj));
  }
  if (has('NextFollowUpDate') || has('NextFollowUpTime')) {
    var when = function (o, emptyText) {
      var d = custVal_('NextFollowUpDate', o.NextFollowUpDate);
      var t = custVal_('NextFollowUpTime', o.NextFollowUpTime);
      return d ? d + (t ? ' ' + t : '') : emptyText;
    };
    lines.push('下次追蹤：' + when(oldObj, '未設定') + ' → ' + when(newObj, '不再追蹤'));
  }
  if (has('NextFollowUpNote')) {
    lines.push('下次洽談內容：' + show(clip_(custVal_('NextFollowUpNote', oldObj.NextFollowUpNote), 80)) + ' → ' + show(clip_(custVal_('NextFollowUpNote', newObj.NextFollowUpNote), 80)));
  }
  if (has('Notes')) {
    var o = custVal_('Notes', oldObj.Notes);
    var n = custVal_('Notes', newObj.Notes);
    if (o && n.indexOf(o) === 0) lines.push('客戶備註：新增「' + clip_(n.slice(o.length).trim(), 80) + '」');
    else lines.push('客戶備註：' + (n ? '已修改（現在：' + clip_(n, 60) + '）' : '已清空'));
  }
  return lines;
}

/**
 * 找到要改的客戶列：前端給的列號，再用公司名稱確認是同一間（列號可能因為別人刪了資料而位移）；
 * 對不上就用公司名稱重新找。沒給公司名稱時（舊版前端）只看列號。找不到回傳 0。
 */
function resolveCustomerRow_(rowIndex, companyName) {
  var sheet = getSheet(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var col = data[0].map(String).indexOf('CompanyName');
  var r = Number(rowIndex);
  var want = companyName != null && String(companyName).trim() !== '' ? normCompanyName_(companyName) : null;
  if (r >= 2 && r <= data.length && (want === null || normCompanyName_(data[r - 1][col]) === want)) return r;
  if (want === null) return 0;
  for (var i = 1; i < data.length; i++) {
    if (normCompanyName_(data[i][col]) === want) return i + 1;
  }
  return 0;
}

/** 某分頁某欄等於 oldVal 的儲存格全部改成 newVal，回傳改了幾格。 */
function replaceColumnValue_(sheetName, columnName, oldVal, newVal) {
  var sheet = getDb_(false).getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var col = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String).indexOf(columnName);
  if (col < 0) return 0;
  var range = sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1);
  var want = String(oldVal).trim();
  var n = 0;
  var out = range.getValues().map(function (r) {
    if (String(r[0]).trim() === want) {
      n++;
      return [newVal];
    }
    return [r[0]];
  });
  if (n) range.setValues(out);
  return n;
}

/**
 * 公司改名時，其他分頁用公司名稱關聯的資料一起改，不然案件、聯絡窗口、聯繫紀錄會「找不到客戶」。
 * 案件編號（專案名稱）裡的客戶名稱不會自動改，要改請用案件頁的「修改專案名稱」。
 */
function renameCompanyEverywhere_(oldName, newName) {
  return {
    cases: replaceColumnValue_(SHEET_CASES, 'CustomerName', oldName, newName),
    endCustomer: replaceColumnValue_(SHEET_CASES, 'EndCustomerName', oldName, newName),
    caseCompanies: replaceColumnValue_(SHEET_CASE_COMPANIES, 'CompanyName', oldName, newName),
    contacts: replaceColumnValue_(SHEET_CUSTOMER_CONTACTS, 'CompanyName', oldName, newName),
    contactLogs: replaceColumnValue_(SHEET_CONTACT_LOGS, 'CompanyName', oldName, newName),
  };
}

/** 換主要聯絡人時，把原本的聯絡人存到「其他聯絡窗口」（已經有同名的就不重複加）。 */
function keepOldContact_(companyName, oldObj) {
  var name = custVal_('Contact', oldObj.Contact);
  if (!name) return false;
  var exists = sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.some(function (r) {
    return String(r['CompanyName']).trim() === String(companyName).trim() && String(r['ContactName']).trim() === name;
  });
  if (exists) return false;
  appendObjectRow(SHEET_CUSTOMER_CONTACTS, {
    CompanyName: companyName,
    ContactName: name,
    Phone: custVal_('Phone', oldObj.Phone),
    Email: custVal_('Email', oldObj.Email),
    Title: '',
    Notes: '原主要聯絡人（' + todayStr() + ' 更換）',
  });
  return true;
}

/** 回傳給前端的客戶資料（含列號、預約時間統一成 HH:mm）。 */
function customerOut_(rowNum) {
  var obj = readRowAsObject(SHEET_CUSTOMERS, rowNum);
  obj.RowIndex = rowNum;
  obj.NextFollowUpTime = normTimeStr_(obj.NextFollowUpTime);
  return obj;
}

/**
 * 修改一筆客戶：只寫入真的有變的欄位，公司改名時連動其他分頁，追蹤日 / 聯絡人有變才同步日曆。
 * 回傳 { customer, changed:[欄位], changes:[中文說明], renamed, keptOld } 或 { error }。
 */
function applyCustomerUpdate_(rowNum, fields, opts) {
  opts = opts || {};
  var sheet = getSheet(SHEET_CUSTOMERS);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var oldObj = readRowAsObject(SHEET_CUSTOMERS, rowNum);
  var input = {};
  var badWebsite = false;
  Object.keys(fields || {}).forEach(function (k) {
    if (header.indexOf(k) < 0 || k === 'CalendarEventId') return; // 行事曆 ID 只由系統維護
    var v = fields[k] == null ? '' : fields[k];
    if (k === 'NextFollowUpTime') v = normTimeStr_(v);
    else if (k === 'NextFollowUpDate') v = dateKey_(v);
    else if (k === 'Website') {
      var w = cleanWebsite_(v);
      if (w === null) { badWebsite = true; return; }
      v = w;
    } else if (typeof v === 'string' && k !== 'Notes' && k !== 'NextFollowUpNote') v = v.trim();
    input[k] = v;
  });
  if (badWebsite) return { error: '公司網址格式不正確（例如 www.example.com 或 https://www.example.com）' };
  if (input.CompanyName !== undefined) {
    if (!input.CompanyName) return { error: '公司名稱不能空白' };
    var dup = findDuplicateCustomerRow_(input.CompanyName, rowNum);
    if (dup) return { error: '已經有「' + input.CompanyName + '」這間客戶了（第 ' + dup + ' 列），不能改成重複的名稱。' };
  }
  if (input.NextFollowUpDate === '' && fields.NextFollowUpDate != null && String(fields.NextFollowUpDate).trim() !== '') {
    return { error: '下次追蹤日格式不對（要是 YYYY-MM-DD）' };
  }
  if (input.NextFollowUpDate === '') input.NextFollowUpTime = ''; // 不再追蹤就不會有預約時間

  var changed = Object.keys(input).filter(function (k) {
    return custVal_(k, oldObj[k]) !== custVal_(k, input[k]);
  });
  if (!changed.length) return { customer: customerOut_(rowNum), changed: [], changes: [], renamed: null, keptOld: false };

  var write = {};
  changed.forEach(function (k) {
    write[k] = input[k];
  });
  updateRowFields(SHEET_CUSTOMERS, rowNum, write);
  var newObj = Object.assign({}, oldObj, write);

  var renamed = null;
  if (changed.indexOf('CompanyName') > -1) renamed = renameCompanyEverywhere_(oldObj.CompanyName, newObj.CompanyName);
  var keptOld = false;
  if (opts.keepOldContact && changed.indexOf('Contact') > -1) keptOld = keepOldContact_(newObj.CompanyName, oldObj);
  var calendarFields = ['NextFollowUpDate', 'NextFollowUpTime', 'NextFollowUpNote', 'CompanyName', 'Contact'];
  if (changed.some(function (f) { return calendarFields.indexOf(f) > -1; })) syncCustomerFollowUpToCalendar(rowNum, header, sheet, newObj, renamed ? oldObj.CompanyName : '');

  return {
    customer: customerOut_(rowNum),
    changed: changed,
    changes: describeCustomerChanges_(oldObj, newObj, changed),
    renamed: renamed,
    keptOld: keptOld,
  };
}

/** 只改了追蹤日 / 洽談內容的算「改期」，其他算「資料修改」。 */
function changeLogMethod_(changed) {
  return changed.every(function (f) {
    return CUSTOMER_FOLLOW_FIELDS.indexOf(f) > -1;
  })
    ? '改期'
    : '資料修改';
}

function handleUpdateCustomer(body) {
  return withLock_(function () {
    var rowNum = resolveCustomerRow_(body.rowIndex, body.companyName);
    if (!rowNum) return { success: false, message: '找不到這間客戶（可能已被刪除或改名），請按「↻ 重撈資料」後再試' };
    var res = applyCustomerUpdate_(rowNum, body.fields || {}, { keepOldContact: !!body.keepOldContact });
    if (res.error) return { success: false, message: res.error };
    var entry = null;
    if (res.changes.length && !body.noLog) {
      var method = changeLogMethod_(res.changed);
      entry = appendContactLog_(
        {
          companyName: res.customer.CompanyName,
          method: body.logMethod || method,
          summary: body.logSummary || (method === '改期' ? '修改下次追蹤' : '修改客戶資料'),
          caseId: body.caseId || '',
          changes: res.changes.join('\n'),
        },
        body._user
      );
    }
    return { success: true, customer: res.customer, log: entry, changes: res.changes, renamed: res.renamed, keptOldContact: res.keptOld };
  });
}

/**
 * 追蹤視窗一次存檔：記下這次聯繫（log，可省略）+ 更新客戶資料與下次追蹤（fields）。
 *  - 有 log：寫一筆聯繫紀錄，Changes 欄記下這次一併改了哪些資料 / 追蹤日；
 *  - 沒有 log 但有改資料：寫一筆「資料修改」或「改期」紀錄，之後在歷史紀錄看得到改了什麼。
 * body: { rowIndex, companyName(用來確認是同一間), fields, log:{method,contact,summary,caseId}, keepOldContact, caseId }
 */
function handleSaveFollowUp(body) {
  return withLock_(function () {
    var rowNum = resolveCustomerRow_(body.rowIndex, body.companyName);
    if (!rowNum) return { success: false, message: '找不到「' + (body.companyName || '') + '」這間客戶（可能已被刪除或改名），請按「↻ 重撈資料」後再試' };
    var log = body.log || null;
    if (log && !String(log.summary || '').trim()) return { success: false, message: '請填寫這次追蹤的結果 / 聯繫內容' };
    var res = applyCustomerUpdate_(rowNum, body.fields || {}, { keepOldContact: !!body.keepOldContact });
    if (res.error) return { success: false, message: res.error };
    var changesText = res.changes.join('\n');
    var entry = null;
    if (log) {
      entry = appendContactLog_(
        { companyName: res.customer.CompanyName, contact: log.contact, method: log.method, summary: String(log.summary).trim(), caseId: log.caseId, changes: changesText },
        body._user
      );
    } else if (res.changes.length) {
      var method = changeLogMethod_(res.changed);
      entry = appendContactLog_(
        { companyName: res.customer.CompanyName, method: method, summary: method === '改期' ? '修改下次追蹤' : '修改客戶資料', caseId: body.caseId || '', changes: changesText },
        body._user
      );
    }
    return { success: true, customer: res.customer, log: entry, changes: res.changes, renamed: res.renamed, keptOldContact: res.keptOld };
  });
}

/** 刪除客戶：還有案件掛在這間客戶底下時先回報，前端確認後帶 force 再刪；同時刪掉日曆上的追蹤提醒。聯繫紀錄與聯絡窗口保留。 */
function handleDeleteCustomer(body) {
  return withLock_(function () {
    var rowNum = resolveCustomerRow_(body.rowIndex, body.companyName);
    if (!rowNum) return { success: false, message: '找不到這間客戶（可能已被刪除），請重新整理' };
    var cust = readRowAsObject(SHEET_CUSTOMERS, rowNum);
    var name = String(cust['CompanyName'] || '').trim();
    var caseCount = sheetToObjects(SHEET_CASES).rows.filter(function (r) {
      return String(r['CustomerName']).trim() === name;
    }).length;
    if (caseCount && !body.force) {
      return { success: false, needConfirm: true, caseCount: caseCount, message: '「' + name + '」底下還有 ' + caseCount + ' 個案件，刪除客戶後這些案件會找不到客戶資料。' };
    }
    wsRemoveFollowUp_(name);
    if (cust['CalendarEventId']) {
      try {
        var ev = CalendarApp.getDefaultCalendar().getEventById(String(cust['CalendarEventId']));
        if (ev) ev.deleteEvent();
      } catch (e) {
        // 行程已經被手動刪掉或沒有日曆權限，略過
      }
    }
    getSheet(SHEET_CUSTOMERS).deleteRow(rowNum);
    return { success: true };
  });
}

/**
 * 依列號改 / 刪資料前確認這一列還是前端看到的那筆（expect = {欄位: 值}），
 * 避免別人刪了上面的資料後列號位移，改到 / 刪到別筆。回傳錯誤訊息，沒問題回傳空字串。
 */
function checkRowExpect_(sheetName, rowNum, expect) {
  rowNum = Number(rowNum);
  var sheet = getSheet(sheetName);
  if (!(rowNum >= 2 && rowNum <= sheet.getLastRow())) return '找不到這筆資料（可能已被刪除），請重新整理後再試';
  if (!expect) return '';
  var obj = readRowAsObject(sheetName, rowNum);
  var bad = Object.keys(expect).some(function (k) {
    var a = k === 'Date' ? dateKey_(obj[k]) || String(obj[k]) : String(obj[k] == null ? '' : obj[k]).trim();
    var b = k === 'Date' ? dateKey_(expect[k]) || String(expect[k]) : String(expect[k] == null ? '' : expect[k]).trim();
    return a !== b;
  });
  return bad ? '這筆資料已經被修改或刪除（列號對不上），請重新整理後再試' : '';
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
  return withLock_(function () {
    var err = checkRowExpect_(SHEET_CUSTOMER_CONTACTS, body.rowIndex, body.expect);
    if (err) return { success: false, message: err };
    updateRowFields(SHEET_CUSTOMER_CONTACTS, body.rowIndex, body.fields);
    return { success: true };
  });
}

function handleDeleteCustomerContact(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  return withLock_(function () {
    var err = checkRowExpect_(SHEET_CUSTOMER_CONTACTS, body.rowIndex, body.expect);
    if (err) return { success: false, message: err };
    getSheet(SHEET_CUSTOMER_CONTACTS).deleteRow(body.rowIndex);
    return { success: true };
  });
}

// ------------------------------------------------------------
// 客戶聯繫紀錄
// ------------------------------------------------------------
/** 寫一筆聯繫紀錄（Date = 今天、CreatedAt = 現在；業務沒給就用登入者）。回傳寫入的資料（含列號）。 */
function appendContactLog_(o, user) {
  var row = {
    Date: todayStr(),
    CreatedAt: nowStr(),
    CompanyName: o.companyName || '',
    Contact: o.contact || '',
    Method: o.method || '',
    Summary: o.summary || '',
    Salesperson: o.salesperson || (user && (user.displayName || user.username)) || '',
    CaseID: o.caseId || '',
    Changes: o.changes || '',
  };
  row.RowIndex = appendObjectRow(SHEET_CONTACT_LOGS, row);
  return row;
}

function handleAddContactLog(body) {
  if (!String(body.companyName || '').trim()) return { success: false, message: '請填公司名稱' };
  var entry = appendContactLog_(
    { companyName: String(body.companyName).trim(), contact: body.contact, method: body.method, summary: body.summary, salesperson: body.salesperson, caseId: body.caseId },
    body._user
  );
  return { success: true, log: entry };
}

/** date：只看某一天；companyName：只看某間公司，兩個都可以不給。新的在前（同一天依記錄時間 / 寫入順序）。 */
function handleGetContactLogs(body) {
  var data = sheetToObjects(SHEET_CONTACT_LOGS);
  var rows = data.rows.map(function (r, i) {
    var o = Object.assign({ RowIndex: i + 2 }, r);
    o.Date = dateKey_(r['Date']) || String(r['Date'] || '');
    return o;
  });
  if (body.date) {
    rows = rows.filter(function (r) {
      return r['Date'] === body.date;
    });
  }
  if (body.companyName) {
    var want = String(body.companyName).trim();
    rows = rows.filter(function (r) {
      return String(r['CompanyName']).trim() === want;
    });
  }
  rows.sort(function (a, b) {
    return String(b['Date']).localeCompare(String(a['Date'])) || String(b['CreatedAt'] || '').localeCompare(String(a['CreatedAt'] || '')) || b.RowIndex - a.RowIndex;
  });
  return { success: true, logs: rows };
}

function handleUpdateContactLog(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  return withLock_(function () {
    var err = checkRowExpect_(SHEET_CONTACT_LOGS, body.rowIndex, body.expect);
    if (err) return { success: false, message: err };
    var fields = {};
    ['Contact', 'Method', 'Summary', 'CaseID'].forEach(function (k) {
      if (body.fields && body.fields[k] !== undefined) fields[k] = body.fields[k];
    });
    updateRowFields(SHEET_CONTACT_LOGS, body.rowIndex, fields);
    return { success: true };
  });
}

function handleDeleteContactLog(body) {
  if (!body.rowIndex) return { success: false, message: '缺少 rowIndex' };
  return withLock_(function () {
    var err = checkRowExpect_(SHEET_CONTACT_LOGS, body.rowIndex, body.expect);
    if (err) return { success: false, message: err };
    getSheet(SHEET_CONTACT_LOGS).deleteRow(body.rowIndex);
    return { success: true };
  });
}

// ============================================================
// ===== 以下來自 Bot.gs =====
// ============================================================
/**
 * ============================================================
 * Bot.gs - BOT 設定模組：客服機器人（對外 LINE 官方帳號 + 網站右下角客服視窗）的設定、知識庫、對話與小編接手
 * ------------------------------------------------------------
 * 選用模組：跟 Code.gs 貼在同一個 Apps Script 專案（沒貼就沒有 BOT 設定功能，其他功能不受影響）。
 * 架構（跟瘋菓的 BOT 管理一樣）：
 *   LINE 官方帳號 / 網站客服視窗 ──► linebot/（Vercel，驗簽、檢索知識庫、呼叫 AI）──► 這裡（設定、知識庫、對話紀錄都存在試算表）
 *   網站「BOT 設定」頁 ──► 這裡的 bot* 動作（用網站登入權杖，需要「BOT 設定」權限）
 *   linebot ──► 這裡的 { action:'bot', secret, op } （用「Bot 金鑰」，不是登入權杖）
 * 資料表：BotConfig（設定，每個區塊一列 JSON）、BotKnowledge（常見問題 / 文件段落）、BotMessages（對話紀錄）。
 * 機器人只看得到知識庫（常見問答、文件、產品名稱與規格、公司簡介），看不到任何內部資料；產品「底價」「供應商」永遠不會給機器人。
 * ============================================================
 */

var SHEET_BOT_CONFIG = 'BotConfig';
var SHEET_BOT_KB = 'BotKnowledge';
var SHEET_BOT_MSG = 'BotMessages';
var SHEET_BOT_LEADS = 'BotLeads';

var BOT_SECRET_PROP = 'BOT_SECRET'; // 舊版共用金鑰（只讀，重新產生金鑰時會自動拆成下面兩把）
var BOT_CS_SECRET_PROP = 'BOT_CS_SECRET'; // 客服機器人專用：只能呼叫客服的操作
var BOT_STAFF_SECRET_PROP = 'BOT_STAFF_SECRET'; // 員工助理專用：只能呼叫員工助理的操作
var BOT_CS_OPS = ['csStart', 'csRemember', 'csForget', 'csHandoff', 'csMessages', 'csThread', 'csKnowledge', 'csVectors', 'csCalcCatalog', 'csWidget', 'csLead', 'csEnd'];
var SHEET_BOT_VEC = 'BotVectors';
var BOT_KB_VER_PROP = 'BOT_KB_VER';
var BOT_VEC_DIM = 256; // 向量維度（Gemini / OpenAI 都支援縮小維度；256 維兼顧準確度與試算表容量）
var BOT_EMBED_MODELS = { gemini: 'gemini-embedding-001', openai: 'text-embedding-3-small' };
var BOT_SEARCH_MODES = ['vector', 'meta_vector', 'meta', 'both'];
// 客服機器人（對外）能看到的產品欄位白名單：底價、供應商、備註永遠不在裡面
var BOT_CS_PRODUCT_FIELDS = [
  ['SupplierModel', '原廠型號'], ['Category', '類別'], ['Brand', '品牌'], ['Interface', '介面'], ['Resolution', '解析度'], ['PixelSize', '像元尺寸 µm'], ['SensorSize', '靶面'],
  ['FPS', '影格率 fps'], ['Mount', '接口'], ['FocalLength', '焦距 mm'], ['Magnification', '放大倍率'], ['WD', '工作距離 WD'], ['DOF', '景深 DOF'], ['FocusWD', '最近對焦距離'], ['EffectivePixels', '有效像素'],
];
var BOT_GEN_PROP = 'BOT_HIST_GEN';
var BOT_CLOSE_TEXT = '（客人關閉聊天室）';
var BOT_LOG_MAX = 4000; // 對話紀錄最多留幾筆的「預設值」（BOT 設定 → 連線與設定可以自己改；超過會自動刪最舊的）

var BOT_AI_PROVIDERS = {
  gemini: { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
  claude: { name: 'Claude', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
  openai: { name: 'OpenAI 相容', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

/**
 * 客服可以「交給真人回答」的問題類型（預設全部不勾，BOT 設定頁自己勾；關鍵字可改）。
 * ask = 轉給小編時請客人先留下的資料（BOT 設定可改，清空 = 不請客人留資料）。
 */
var BOT_CS_TOPICS = [
  { key: 'price', name: '價格 / 報價', words: '多少錢 價格 價錢 售價 報價 費用 幾元 優惠 折扣 特價 便宜 預算',
    ask: '為了加快報價，請先留下以下資料：\n・公司名稱與聯絡人\n・電話或 Email\n・需要的產品型號 / 數量，或應用說明' },
  { key: 'order', name: '訂購 / 下單', words: '訂購 下單 訂貨 我要買 怎麼買 想買 購買 採購',
    ask: '為了加快處理，請先留下以下資料：\n・公司名稱與聯絡人\n・電話\n・想訂購的品項與數量\n・希望交期' },
  { key: 'sample', name: '樣品測試 / 專案評估', words: '樣品 打樣 測試 評估 專案 客製 驗證 試用 借測',
    ask: '請先留下您的需求，FAE 會更快回覆您：\n・公司名稱與聯絡人、電話\n・產品應用與待測物件\n・檢測需求（要抓什麼缺陷、精度、速度）' },
  { key: 'shipping', name: '運費 / 交期', words: '運費 配送 寄送 出貨 物流 到貨 交期 現貨 缺貨' },
  { key: 'complaint', name: '客訴 / 退換貨 / 維修', words: '退貨 退款 換貨 客訴 投訴 故障 維修 壞掉 保固 RMA 不良' },
];
var BOT_STAFF_OPS = ['start', 'call', 'stage', 'commit', 'cancel', 'remember', 'forget', 'unfollow', 'memory', 'audit', 'cards'];
var BOT_HANDOFF_WORDS = '真人 客服人員 小編 專人 人工 業務';
var BOT_TONES = ['friendly', 'formal', 'concise'];
var BOT_EMOJI = ['many', 'some', 'none'];

function botSchema_() {
  var base = {
    schema: {
      BotConfig: ['Key', 'Value'],
      BotKnowledge: ['ID', 'Type', 'Title', 'Question', 'Content', 'Tags', 'Source', 'IsActive', 'UpdatedAt', 'BigCategory', 'Topic', 'Notes', 'Audience', 'Overlap', 'ChunkSize', 'SortOrder', 'FileName', 'Images'],
      BotVectors: ['ID', 'Model', 'Vec'],
      BotLeads: ['ID', 'Time', 'Channel', 'UserId', 'Name', 'Company', 'Phone', 'Email', 'Note', 'Source'],
      BotMessages: ['ID', 'Time', 'Channel', 'UserId', 'Name', 'Role', 'Text', 'Topic'],
    },
    text: { BotMessages: ['Time', 'UserId'], BotKnowledge: [], BotVectors: [], BotLeads: ['Time', 'UserId', 'Phone'] },
  };
  return botMerge_(base, typeof botStaffSchema_ === 'function' ? botStaffSchema_() : null);
}

/** 合併選用子模組（BotStaff.gs）的資料表。 */
function botMerge_(base, extra) {
  if (!extra) return base;
  Object.assign(base.schema, extra.schema || {});
  Object.assign(base.text, extra.text || {});
  return base;
}

/** 動作 → [區塊, 等級]。BOT 設定是可以獨立指定查看 / 編輯的功能區塊；刪除只有系統管理員。 */
function botPerms_() {
  var base = {
    botGetSettings: ['bot', 'r'], botKbList: ['bot', 'r'], botConversations: ['bot', 'r'], botThread: ['bot', 'r'],
    botSaveSettings: ['bot', 'w'], botSaveAi: ['bot', 'w'], botTestAi: ['bot', 'w'], botKbSave: ['bot', 'w'], botKbImport: ['bot', 'w'],
    botGenKey: ['bot', 'w'], botRevealKey: ['bot', 'w'], botHumanReply: ['bot', 'w'], botResume: ['bot', 'w'], botTestToken: ['bot', 'w'],
    botKbDelete: ['bot', 'd'], botKbDocSave: ['bot', 'w'], botKbAiSplit: ['bot', 'w'], botKbSetAudience: ['bot', 'w'], botClear: ['bot', 'd'], botCsPreview: ['bot', 'r'], botKbEmbed: ['bot', 'w'],
    botKbImageUpload: ['bot', 'w'], botLeads: ['bot', 'r'], botLeadDelete: ['bot', 'd'],
    botAlerts: ['bot', 'r'], botAlertAck: ['bot', 'w'],
    getNameCards: ['customers', 'r'], cardUpdate: ['customers', 'w'], cardToCustomer: ['customers', 'w'], cardDelete: ['customers', 'w'],
  };
  return botMergePerms_(base, typeof botStaffPerms_ === 'function' ? botStaffPerms_() : null);
}

function botMergePerms_(base, extra) {
  Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
  return base;
}

function botRoutes_() {
  var base = {
    bot: { auth: false, fn: handleBotApi },
    botGetSettings: { auth: true, fn: handleBotGetSettings },
    botSaveSettings: { auth: true, fn: handleBotSaveSettings },
    botSaveAi: { auth: true, fn: handleBotSaveAi },
    botTestAi: { auth: true, fn: handleBotTestAi },
    botKbList: { auth: true, fn: handleBotKbList },
    botKbSave: { auth: true, fn: handleBotKbSave },
    botKbImport: { auth: true, fn: handleBotKbImport },
    botKbDelete: { auth: true, fn: handleBotKbDelete },
    botKbSetAudience: { auth: true, fn: handleBotKbSetAudience },
    botKbDocSave: { auth: true, fn: handleBotKbDocSave },
    botKbAiSplit: { auth: true, fn: handleBotKbAiSplit },
    botGenKey: { auth: true, fn: handleBotGenKey },
    botRevealKey: { auth: true, fn: handleBotRevealKey },
    botConversations: { auth: true, fn: handleBotConversations },
    botThread: { auth: true, fn: handleBotThread },
    botHumanReply: { auth: true, fn: handleBotHumanReply },
    botResume: { auth: true, fn: handleBotResume },
    botTestToken: { auth: true, fn: handleBotTestToken },
    botClear: { auth: true, fn: handleBotClear },
    botCsPreview: { auth: true, fn: handleBotCsPreview },
    botKbEmbed: { auth: true, fn: handleBotKbEmbed },
    botKbImageUpload: { auth: true, fn: handleBotKbImageUpload },
    botLeads: { auth: true, fn: handleBotLeads },
    botLeadDelete: { auth: true, fn: handleBotLeadDelete },
    botAlerts: { auth: true, fn: handleBotAlerts },
    botAlertAck: { auth: true, fn: handleBotAlertAck },
    getNameCards: { auth: true, fn: handleGetNameCards },
    cardUpdate: { auth: true, fn: handleCardUpdate },
    cardToCustomer: { auth: true, fn: handleCardToCustomer },
    cardDelete: { auth: true, fn: handleCardDelete },
  };
  if (typeof botStaffRoutes_ === 'function') botMergePerms_(base, botStaffRoutes_());
  return base;
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------
function botInt_(v, min, max, def) {
  var n = Number(v);
  if (v === '' || v === null || v === undefined || isNaN(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function botClip_(v, n) {
  var t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

// ---- 防濫用（網站客服視窗是公開的，任何人都能呼叫：限制流量，避免被灌訊息消耗 AI 費用與 Apps Script 額度） ----
var BOT_GUARD_TEXT = '目前諮詢的人比較多，暫時無法即時回覆。請稍後再試，或按「轉真人」、留下聯絡方式，由專人與您聯繫 🙏';

/** 流量上限設定（BOT 設定 → 客服設定 → 防濫用）。0 = 不限制該項（訪客每分鐘至少 1）。 */
function botGuardCfg_(g) {
  g = g || {};
  return {
    visitorPerMin: botInt_(g.visitorPerMin, 1, 120, 12), // 同一個訪客編號每分鐘最多幾則
    ipPerMin: botInt_(g.ipPerMin, 0, 600, 20), // 同一個 IP 每分鐘最多幾則（換訪客編號也繞不過）
    ipPerHour: botInt_(g.ipPerHour, 0, 10000, 120), // 同一個 IP 每小時最多幾則
    reqPerMin: botInt_(g.reqPerMin, 0, 1000, 120), // 同一個 IP 每分鐘最多幾次視窗請求（含查看新訊息、關閉、留資料）
    globalPerHour: botInt_(g.globalPerHour, 0, 100000, 600), // 全站（所有訪客合計）每小時最多幾則
    globalPerDay: botInt_(g.globalPerDay, 0, 1000000, 3000), // 全站每天最多幾則
    leadPerHour: botInt_(g.leadPerHour, 0, 1000, 10), // 同一個 IP 每小時最多留幾次聯繫資料
    requireOrigin: g.requireOrigin !== false, // 有設定「允許嵌入的網站」時，沒帶來源的請求（腳本）一律拒絕
    alert: g.alert !== false, // 全站上限被用完時寄信通知管理員（每小時最多一封）
    overText: botClip_(g.overText, 200) || BOT_GUARD_TEXT, // 超過 IP / 全站上限時回給客人的話
  };
}

/** 固定時間窗的計數器（快取）：key 已含時間窗編號，回傳加 1 之後的次數。 */
function botGuardBump_(key, seconds) {
  var n = Number(botCache_().get(key) || 0) + 1;
  botCachePut_(key, n, seconds);
  return n;
}

/** 全站每日計數（快取最久只能存 6 小時，所以放在指令碼屬性；沒有鎖，高併發時會略少算，可接受）。 */
function botGuardDayBump_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var today = botNow_().slice(0, 10);
    var raw = String(props.getProperty('CS_GUARD_DAY') || '').split('|');
    var n = (raw[0] === today ? Number(raw[1]) || 0 : 0) + 1;
    props.setProperty('CS_GUARD_DAY', today + '|' + n);
    return n;
  } catch (e) {
    return 0;
  }
}

/** 檢查這則網站訊息有沒有超過上限。回傳 '' = 通過；'visitor' 訪客傳太快；'ip' 同一個 IP 太多；'global' 全站用完。 */
function botGuardCheck_(id, ip, cfg) {
  var now = Date.now();
  var m = Math.floor(now / 60000);
  var h = Math.floor(now / 3600000);
  var reason = '';
  if (botGuardBump_('csg:v:' + id + ':' + m, 120) > cfg.visitorPerMin) reason = 'visitor';
  if (ip) {
    var perMin = botGuardBump_('csg:im:' + ip + ':' + m, 120);
    var perHour = botGuardBump_('csg:ih:' + ip + ':' + h, 7200);
    if (!reason && cfg.ipPerMin && perMin > cfg.ipPerMin) reason = 'ip';
    if (!reason && cfg.ipPerHour && perHour > cfg.ipPerHour) reason = 'ip';
  }
  // 全站計數只算沒被擋下的訊息：單一來源狂灌不會把全站額度吃光
  if (!reason && cfg.globalPerHour && botGuardBump_('csg:gh:' + h, 7200) > cfg.globalPerHour) reason = 'global';
  if (!reason && cfg.globalPerDay && botGuardDayBump_() > cfg.globalPerDay) reason = 'global';
  if (reason === 'global') botGuardAlert_(cfg, h);
  return reason;
}

/** 全站上限被用完：寄信給管理員（通知對象跟忘記密碼通知同一份設定），每小時最多一封。 */
function botGuardAlert_(cfg, hourBucket) {
  if (!cfg.alert) return;
  var flag = 'csg:alert:' + hourBucket;
  if (botCache_().get(flag)) return;
  botCachePut_(flag, 1, 3600);
  try {
    var text = '網站客服視窗的流量達到全站上限，超過的訊息已被擋下（客人會看到請稍後再試或轉真人）。\n\n' +
      '目前上限：每小時 ' + (cfg.globalPerHour || '不限') + ' 則、每天 ' + (cfg.globalPerDay || '不限') + ' 則。\n' +
      '時間：' + botNow_() + '\n\n' +
      '如果是正常的詢問量增加，可以到「BOT 設定 → 客服設定 → 防濫用」調高上限；如果流量不尋常，請到「對話紀錄」查看是否有人在灌訊息。';
    resetNotifyAdmins_().forEach(function (u) {
      var email = String(u['Email'] || '').trim();
      if (validEmail_(email)) sendResetMail_(email, '【AOI】客服機器人流量已達上限', text);
    });
  } catch (e) {
    // 寄信失敗（沒有 Email、額度用完）不影響擋下流量
  }
}

/** 只收長得像 IP 位址的字串（Vercel 帶過來的來源 IP）。 */
function botGuardIp_(v) {
  var s = String(v || '').trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(s) ? s : '';
}

/** 知識庫版本號：知識、向量、客服來源設定、搜尋與 AI 設定有變就換一個新的；機器人每則訊息都會帶回來比對，變了就馬上重讀（不用等 5 分鐘快取）。 */
function botKbVer_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(BOT_KB_VER_PROP) || '0';
  } catch (e) {
    return '0';
  }
}

function botKbBump_() {
  try {
    PropertiesService.getScriptProperties().setProperty(BOT_KB_VER_PROP, String(Date.now()));
  } catch (e) {
    // 換版本號失敗不影響儲存（最多就是機器人 5 分鐘後才更新）
  }
}

function botNow_() {
  return Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
}

function botCache_() {
  return CacheService.getScriptCache();
}

function botCacheGet_(key) {
  try {
    var v = botCache_().get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function botCachePut_(key, value, seconds) {
  try {
    botCache_().put(key, JSON.stringify(value), Math.min(21600, Math.max(1, Math.floor(seconds))));
  } catch (e) {
    // 超過快取大小上限或快取暫時不可用：略過（功能不受影響，只是少了加速）
  }
}

function botCacheRemove_(keys) {
  try {
    botCache_().removeAll(keys);
  } catch (e) {
    // ignore
  }
}

/** 關鍵字：以空白、逗號、頓號分隔 */
function botWords_(text) {
  var list = String(text || '').split(/[\s,，、;；]+/).map(function (w) { return w.trim(); }).filter(Boolean);
  return list.filter(function (w, i) { return list.indexOf(w) === i; }).slice(0, 100);
}

/** 常用按鈕：一行一個（LINE 最多 13 個、每個 20 字） */
function botButtons_(text) {
  var list = String(text || '').split(/\n/).map(function (w) { return w.trim(); }).filter(Boolean);
  return list.filter(function (w, i) { return list.indexOf(w) === i; }).slice(0, 13).map(function (w) { return w.slice(0, 20); });
}

function botRandomKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

// ------------------------------------------------------------
// 設定（BotConfig 分頁：每個區塊一列 JSON；快取 2 分鐘，儲存時清掉）
// ------------------------------------------------------------
function botCfgAll_() {
  var cached = botCacheGet_('botcfg');
  if (cached) return cached;
  var out = {};
  sheetToObjects(SHEET_BOT_CONFIG).rows.forEach(function (r) {
    if (!r['Key']) return;
    try {
      out[r['Key']] = JSON.parse(String(r['Value'] || 'null'));
    } catch (e) {
      out[r['Key']] = null;
    }
  });
  botCachePut_('botcfg', out, 120);
  return out;
}

function botCfg_(key, def) {
  var v = botCfgAll_()[key];
  return v === null || v === undefined ? def : v;
}

function botCfgSet_(key, value) {
  withLock_(function () {
    var sheet = getSheet(SHEET_BOT_CONFIG);
    var data = sheet.getDataRange().getValues();
    var json = JSON.stringify(value);
    var found = 0;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        found = i + 1;
        break;
      }
    }
    if (found) sheet.getRange(found, 2).setValue(json);
    else appendObjectRow(SHEET_BOT_CONFIG, { Key: key, Value: json });
    botCacheRemove_(['botcfg']);
  });
}

/** 客服機器人設定：沒設定的用預設值。topics 每類 { on, words, ask, askPos }；關鍵字留空 = 預設關鍵字。 */
function botCsFields_(list) {
  var all = BOT_CS_PRODUCT_FIELDS.map(function (f) { return f[0]; });
  if (!Array.isArray(list)) return all;
  return all.filter(function (k) { return list.indexOf(k) > -1; });
}

function botCsConfig_(cs) {
  cs = cs || {};
  var src = cs.sources || {}, st = cs.style || {}, h = cs.hours || {}, tp = cs.topics || {}, web = cs.web || {};
  var on = function (v) { return v !== false; };
  var hm = function (v, d) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d; };
  var days = Array.isArray(h.days) ? h.days.map(Number).filter(function (d, i, a) { return d >= 0 && d <= 6 && Math.floor(d) === d && a.indexOf(d) === i; }) : [1, 2, 3, 4, 5];
  var color = /^#[0-9a-fA-F]{6}$/.test(String(web.color || '')) ? String(web.color) : '#2c5aa0';
  return {
    enabled: cs.enabled === true,
    welcome: String(cs.welcome || ''),
    prompt: String(cs.prompt || ''),
    handoffText: String(cs.handoffText || ''),
    sources: {
      qa: on(src.qa),
      products: src.products === true,
      brand: on(src.brand),
      productLimit: botInt_(src.productLimit, 50, 10000, 3000),
      docs: on(src.docs),
      // 客服能看到的產品欄位（白名單；沒設定 = 全部白名單欄位）與產品類別（空白 = 全部類別）
      productFields: botCsFields_(src.productFields),
      productCategories: String(src.productCategories || '').slice(0, 500),
      // 選型計算用的相機 / 鏡頭型錄（不含價格）：預設開，不用打開「產品型號與規格」也能用
      calc: src.calc !== false,
    },
    brandInfo: String(cs.brandInfo || ''),
    replyWhen: cs.replyWhen === 'offHours' ? 'offHours' : 'always',
    hours: { enabled: h.enabled === true, days: days, start: hm(h.start, '09:00'), end: hm(h.end, '18:00'), offText: String(h.offText || '') },
    handoffWords: cs.handoffWords === undefined || cs.handoffWords === null ? BOT_HANDOFF_WORDS : String(cs.handoffWords),
    pauseMinutes: botInt_(cs.pauseMinutes, 0, 360, 30),
    topics: BOT_CS_TOPICS.map(function (t) {
      var v = tp[t.key] || {};
      return {
        key: t.key,
        name: t.name,
        on: v.on === true,
        words: String(v.words || '').trim() || t.words,
        defaultWords: t.words,
        ask: v.ask === undefined || v.ask === null ? t.ask || '' : String(v.ask),
        defaultAsk: t.ask || '',
        askPos: v.askPos === 'before' ? 'before' : 'after',
      };
    }),
    customWords: String(cs.customWords || ''),
    customAsk: String(cs.customAsk || ''),
    customAskPos: cs.customAskPos === 'before' ? 'before' : 'after',
    topicText: String(cs.topicText || ''),
    unsure: cs.unsure === 'handoff' ? 'handoff' : 'ask',
    handoffButton: cs.handoffButton !== false, // 每則回覆下方附「轉真人」按鈕
    contactAfter: botInt_(cs.contactAfter, 0, 50, 3), // 聊到第幾段請訪客留聯繫資料（0 = 不問）
    // 選型計算的回覆格式（客服與員工助理共用）：精簡 = 只回「型號(有效像素)」；推薦幾台相機 / 鏡頭；空間解析度以哪一邊為基準
    calc: {
      brief: (cs.calc || {}).brief !== false,
      cameras: botInt_((cs.calc || {}).cameras, 1, 5, 1),
      lenses: botInt_((cs.calc || {}).lenses, 1, 3, 1),
      base: (cs.calc || {}).base === 'l' ? 'l' : 's',
    },
    sendImages: cs.sendImages !== false, // 問到有附圖的知識時，可以直接給圖片
    noThinking: cs.noThinking !== false, // 回覆時關閉 Gemini 2.5 Flash 的思考（較快較省；關掉這個開關 = 讓模型先推理再回答）
    groundCheck: cs.groundCheck === true, // AI 回覆前先檢查有沒有知識庫根據（預設關閉；會多花一次 AI）
    guard: botGuardCfg_(cs.guard), // 防濫用：網站視窗的流量上限（每訪客 / 每 IP / 全站）
    style: {
      tone: BOT_TONES.indexOf(st.tone) >= 0 ? st.tone : 'friendly',
      address: String(st.address || '').trim() || '您',
      emoji: BOT_EMOJI.indexOf(st.emoji) >= 0 ? st.emoji : 'some',
      maxLines: botInt_(st.maxLines, 2, 15, 5),
    },
    buttons: String(cs.buttons || ''),
    buttonsAlways: cs.buttonsAlways === true,
    web: {
      enabled: web.enabled === true,
      title: String(web.title || '').trim() || '線上客服',
      subtitle: String(web.subtitle || '').trim() || '有任何問題都可以問我',
      color: color,
      position: web.position === 'left' ? 'left' : 'right',
      autoOpen: web.autoOpen === true,
      resetOnReload: web.resetOnReload !== false, // 預設：訪客按 F5 重新整理網頁就重新開始對話
      allowedOrigins: String(web.allowedOrigins || ''),
    },
  };
}

/** 存進試算表的格式：topics 存成 { key: { on, words, ask, askPos } }（關鍵字跟預設一樣就不存） */
function botCsStored_(cs) {
  var out = Object.assign({}, cs);
  if (Array.isArray(cs.topics)) {
    out.topics = {};
    cs.topics.forEach(function (t) {
      out.topics[t.key] = { on: t.on, words: t.words === t.defaultWords ? '' : t.words, ask: t.ask, askPos: t.askPos };
    });
  }
  return out;
}

function botGeneral_() {
  var g = botCfg_('general', {}) || {};
  return {
    replyDelay: botInt_(g.replyDelay, 0, 10, 2), // 回覆最少等待秒數（像真人打字）
    botUrl: String(g.botUrl || ''),
    memory: { turns: botInt_((g.memory || {}).turns, 2, 40, 10), hours: botInt_((g.memory || {}).hours, 1, 6, 6), chars: botInt_((g.memory || {}).chars, 50, 2000, 600) },
    logMax: botInt_(g.logMax, 50, 20000, BOT_LOG_MAX), // 對話紀錄最多留幾筆
  };
}

function botSettings_() {
  return botCsConfig_(botCfg_('cs', {}));
}

// ------------------------------------------------------------
// AI（依順序備援：第一個失敗就換下一個）
// ------------------------------------------------------------
/** 每組 AI 可以指定用在哪些功能（每個功能只會用一組；沒指定的功能用「整個系統」那組）。 */
var BOT_AI_FEATURES = { all: '整個系統', cs: 'LINE 機器人（含網站客服視窗）', copy: 'AI 文案', staff: '小助理（員工助理）', vector: '向量', check: '回覆檢查（客服回覆前核對知識庫）' };

function botAiUses_(raw) {
  var seen = {};
  return (Array.isArray(raw) ? raw : []).map(String).filter(function (u) {
    if (!BOT_AI_FEATURES[u] || seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

/** 每個問題最多查幾輪資料（機器人呼叫工具的輪數上限）。 */
function botAiRounds_() {
  return botInt_((botCfg_('ai', {}) || {}).maxRounds, 1, 12, 6);
}

/** 存著的 AI（含金鑰、依存的順序；只給伺服器內部用）。舊設定沒有指定功能時，第一組視為「整個系統」。 */
function botAiStored_() {
  var cfg = botCfg_('ai', {}) || {};
  var list = Array.isArray(cfg.models) ? cfg.models : [];
  var out = [];
  list.forEach(function (m) {
    if (!m || !m.apiKey) return;
    var def = BOT_AI_PROVIDERS[m.provider] || BOT_AI_PROVIDERS.gemini;
    var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
    out.push({ source: 'bot', provider: provider, apiKey: String(m.apiKey), model: String(m.model || '').trim() || def.model, endpoint: String(m.endpoint || '').trim() || def.endpoint, name: String(m.name || '').trim().slice(0, 30), uses: botAiUses_(m.uses) });
  });
  if (out.length && !out.some(function (m) { return m.uses.length; })) out[0].uses = ['all'];
  return out;
}

/**
 * 某個功能用的 AI 清單（含金鑰，只給伺服器內部與 Bot 金鑰的呼叫用），第一個是主要、其餘依序備援：
 *   主要 = 指定給這個功能的那組 → 沒有就用「整個系統」那組 → 再沒有就用清單第一組；
 *   備援 = 其他組依清單順序；最後是系統共用的 GEMINI_API_KEY（Script Properties）。
 * feature：cs / copy / staff / vector / all（不給 = all）。
 */
function botAiList_(feature) {
  var stored = botAiStored_();
  var rounds = botAiRounds_();
  var out = [];
  if (stored.length) {
    var idx = -1;
    stored.forEach(function (m, i) { if (idx < 0 && feature && m.uses.indexOf(feature) > -1) idx = i; });
    stored.forEach(function (m, i) { if (idx < 0 && m.uses.indexOf('all') > -1) idx = i; });
    if (idx < 0) idx = 0;
    out = [stored[idx]].concat(stored.filter(function (m, i) { return i !== idx; }));
  }
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (key && !out.some(function (m) { return m.apiKey === key; })) {
    out.push({ source: 'system', provider: 'gemini', apiKey: key, model: PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || BOT_AI_PROVIDERS.gemini.model, endpoint: BOT_AI_PROVIDERS.gemini.endpoint });
  }
  return out.map(function (m) {
    return { source: m.source, provider: m.provider, apiKey: m.apiKey, model: m.model, endpoint: m.endpoint, name: m.name || '', maxRounds: rounds };
  });
}

/** 呼叫一個 AI（純文字，沒有工具）。messages：[{role:'user'|'assistant', text}]。失敗丟出錯誤。 */
function botCallAi_(cfg, system, messages, opts) {
  var maxTokens = (opts && opts.maxTokens) || 0;
  var msgs = [];
  (messages || []).forEach(function (m) {
    var last = msgs[msgs.length - 1];
    if (!msgs.length && m.role !== 'user') return;
    if (last && last.role === m.role) last.text += '\n\n' + m.text;
    else msgs.push({ role: m.role, text: String(m.text || '') });
  });
  if (!msgs.length) throw new Error('沒有要送給 AI 的內容');
  var base = String(cfg.endpoint).replace(/\/+$/, '');
  var url, headers, payload, pick;
  if (cfg.provider === 'claude') {
    url = base + '/messages';
    headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
    payload = { model: cfg.model, max_tokens: maxTokens || 4096, system: system, messages: msgs.map(function (m) { return { role: m.role, content: m.text }; }) };
    pick = function (b) { return (b.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join(''); };
  } else if (cfg.provider === 'openai') {
    url = base + '/chat/completions';
    headers = { Authorization: 'Bearer ' + cfg.apiKey };
    payload = { model: cfg.model, messages: [{ role: 'system', content: system }].concat(msgs.map(function (m) { return { role: m.role, content: m.text }; })) };
    if (maxTokens) payload.max_tokens = maxTokens;
    pick = function (b) { return (((b.choices || [])[0] || {}).message || {}).content || ''; };
  } else {
    url = base + '/models/' + encodeURIComponent(cfg.model) + ':generateContent';
    headers = { 'x-goog-api-key': cfg.apiKey };
    payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }; }),
    };
    if (maxTokens) payload.generationConfig = { maxOutputTokens: maxTokens };
    pick = function (b) { return (((((b.candidates || [])[0] || {}).content || {}).parts) || []).filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join(''); };
  }
  var res;
  try {
    res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: headers, muteHttpExceptions: true, payload: JSON.stringify(payload) });
  } catch (e) {
    throw new Error('無法連線到 AI 服務（' + (BOT_AI_PROVIDERS[cfg.provider] || {}).name + '），請確認 Endpoint 是否正確');
  }
  var body = {};
  try {
    body = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    // 非 JSON
  }
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    var err = body.error;
    var msg = (err && (err.message || (typeof err === 'string' ? err : ''))) || 'HTTP ' + code;
    throw new Error('AI 服務錯誤（' + (BOT_AI_PROVIDERS[cfg.provider] || {}).name + ' ' + cfg.model + '）：' + String(msg).split(cfg.apiKey).join('••••').slice(0, 300));
  }
  return String(pick(body) || '').trim() || '（AI 沒有回應內容）';
}

/** 依順序試設定的 AI，第一個成功就回傳；全部失敗丟出最後一個錯誤。 */
function botGenerate_(system, messages) {
  var list = botAiList_();
  if (!list.length) throw new Error('尚未設定 AI：請到「BOT 設定 → AI 模型」填入 API Key');
  var lastErr = null;
  for (var i = 0; i < list.length; i++) {
    try {
      return botCallAi_(list[i], system, messages);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------
// Bot 金鑰：linebot（Vercel）用來呼叫這裡
// ------------------------------------------------------------
/** 這個角色（cs 客服 / staff 員工助理）的金鑰；還沒拆開的舊版共用金鑰兩邊都先沿用。 */
function botKey_(role) {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty(role === 'staff' ? BOT_STAFF_SECRET_PROP : BOT_CS_SECRET_PROP) || p.getProperty(BOT_SECRET_PROP) || '';
}

/** 這個角色用的是不是舊版共用金鑰（建議重新產生，讓客服與員工助理各用各的）。 */
function botKeyShared_(role) {
  var p = PropertiesService.getScriptProperties();
  return !p.getProperty(role === 'staff' ? BOT_STAFF_SECRET_PROP : BOT_CS_SECRET_PROP) && !!p.getProperty(BOT_SECRET_PROP);
}

function handleBotApi(body) {
  var fail = function (msg, code) {
    return { success: false, message: msg, code: code };
  };
  var csKey = botKey_('cs');
  var staffKey = botKey_('staff');
  if (!csKey && !staffKey) return fail('機器人尚未啟用：請到「BOT 設定」產生 Bot 金鑰', 'BOT_OFF');
  // 比對雜湊值：長度固定，不會因為比對到第幾個字才不同而洩漏金鑰
  var given = sha256('bot:' + String(body.secret || ''));
  var roles = { cs: !!csKey && given === sha256('bot:' + csKey), staff: !!staffKey && given === sha256('bot:' + staffKey) };
  if (!roles.cs && !roles.staff) return fail('Bot 金鑰錯誤', 'BOT_AUTH');

  var op = String(body.op || '');
  // 每個操作只屬於一個角色：客服金鑰只能做客服的事，員工助理金鑰只能做員工助理的事（就算金鑰外流也碰不到另一邊的資料）
  var need = BOT_STAFF_OPS.indexOf(op) > -1 || op === 'pushTargets' ? 'staff' : BOT_CS_OPS.indexOf(op) > -1 ? 'cs' : '';
  if (!need) return fail('未知的 Bot 操作：' + op);
  if (!roles[need]) return fail('這把金鑰沒有「' + (need === 'cs' ? '客服機器人' : '員工助理') + '」的權限', 'BOT_AUTH');
  if (body.botUrl) botLearnUrl_(body.botUrl);
  try {
    var data;
    if (op === 'pushTargets' && typeof botPushTargets_ === 'function') data = botPushTargets_();
    else if (op === 'csKnowledge') data = csKnowledge_();
    else if (op === 'csVectors') data = csVectors_(body);
    else if (op === 'csCalcCatalog') data = csCalcCatalog_();
    else if (op === 'csWidget') data = csWidgetConfig_();
    else {
      var id = String(body.lineUserId || '');
      // 客服：LINE 客人（U）、網站訪客（V）、後台測試（T）；員工助理：LINE 員工（U）、網站登入帳號（W）
      var idOk = need === 'cs' ? /^[UVT][0-9a-f]{32}$/.test(id) : /^[UW][0-9a-f]{32}$/.test(id);
      if (!idOk) return fail('使用者編號格式錯誤');
      if (op === 'csStart') data = csStart_(id, body);
      else if (op === 'csRemember') data = csRemember_(id, body);
      else if (op === 'csForget') data = csForget_(id);
      else if (op === 'csEnd') data = csEnd_(id);
      else if (op === 'csHandoff') data = csHandoff_(id, body);
      else if (op === 'csLead') data = csLead_(id, body);
      else if (op === 'csMessages') data = csMessages_(id, body);
      else if (op === 'csThread') data = csThread_(id, body);
      else if (typeof botStaffOp_ === 'function') data = botStaffOp_(op, id, body);
      else return fail('員工助理模組沒有安裝（請貼上 BotStaff.gs）');
    }
    return { success: true, data: data };
  } catch (e) {
    return fail(e.message);
  }
}

/** 機器人回報自己的網址：BOT 設定還沒填「機器人網址」就自動記下。 */
function botLearnUrl_(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) || url.length > 300 || botGeneral_().botUrl) return;
  var g = botCfg_('general', {}) || {};
  g.botUrl = url;
  botCfgSet_('general', g);
}

// ------------------------------------------------------------
// 知識庫搜尋流程設定、embedding（向量）計算與儲存
// ------------------------------------------------------------
/** 搜尋流程：mode = vector 直接向量（預設）/ meta_vector 先用大分類主題備註縮小範圍再向量 / meta 只用大分類主題備註 / both 兩種都做，結果一致才回答；threshold = 向量相似度閥值。 */
function botSearchCfg_() {
  var s = botCfg_('search', {}) || {};
  var th = Number(s.threshold);
  return {
    mode: BOT_SEARCH_MODES.indexOf(s.mode) > -1 ? s.mode : 'vector',
    threshold: s.threshold === '' || s.threshold == null || isNaN(th) ? 0.6 : Math.min(1, Math.max(0, Math.round(th * 100) / 100)),
    topK: botInt_(s.topK, 1, 15, 6),
    embedProvider: s.embedProvider === 'gemini' || s.embedProvider === 'openai' ? s.embedProvider : 'auto',
  };
}

/** 用哪一組 AI 金鑰算向量（Gemini 或 OpenAI 相容；Claude 沒有 embedding）。找不到回傳 null。 */
function botEmbedCfg_() {
  var want = botSearchCfg_().embedProvider;
  var list = botAiList_('vector');
  var pick = list.filter(function (m) { return want === 'auto' ? m.provider === 'gemini' || m.provider === 'openai' : m.provider === want; })[0] || null;
  if (!pick) return null;
  var model = BOT_EMBED_MODELS[pick.provider];
  return { provider: pick.provider, apiKey: pick.apiKey, endpoint: pick.endpoint, model: model, dim: BOT_VEC_DIM, key: pick.provider + ':' + model + ':' + BOT_VEC_DIM };
}

function botNormVec_(v) {
  var n = 0;
  v.forEach(function (x) { n += x * x; });
  n = Math.sqrt(n) || 1;
  return v.map(function (x) { return Math.round((x / n) * 10000) / 10000; });
}

/** 一批文字 → 向量（已正規化，內積 = 餘弦相似度）。kind = 'doc' 文件 / 'query' 查詢。失敗丟出錯誤（金鑰會被遮掉）。 */
function botEmbed_(cfg, texts, kind) {
  var out = [];
  var base = String(cfg.endpoint).replace(/\/+$/, '');
  for (var i = 0; i < texts.length; i += 50) {
    var part = texts.slice(i, i + 50).map(function (t) { return String(t).slice(0, 6000) || ' '; });
    var url, headers, payload, pick;
    if (cfg.provider === 'openai') {
      url = base + '/embeddings';
      headers = { Authorization: 'Bearer ' + cfg.apiKey };
      payload = { model: cfg.model, input: part, dimensions: cfg.dim };
      pick = function (b) { return (b.data || []).map(function (d) { return d.embedding; }); };
    } else {
      url = base + '/models/' + cfg.model + ':batchEmbedContents';
      headers = { 'x-goog-api-key': cfg.apiKey };
      payload = {
        requests: part.map(function (t) {
          return { model: 'models/' + cfg.model, content: { parts: [{ text: t }] }, taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: cfg.dim };
        }),
      };
      pick = function (b) { return (b.embeddings || []).map(function (d) { return d.values; }); };
    }
    var res;
    try {
      res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: headers, muteHttpExceptions: true, payload: JSON.stringify(payload) });
    } catch (e) {
      throw new Error('無法連線到 embedding 服務，請確認網路與 Endpoint');
    }
    var body = {};
    try {
      body = JSON.parse(res.getContentText() || '{}');
    } catch (e) {
      // 非 JSON
    }
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      var err = body.error;
      var msg = (err && (err.message || (typeof err === 'string' ? err : ''))) || 'HTTP ' + code;
      throw new Error('embedding 服務錯誤（' + cfg.model + '）：' + String(msg).split(cfg.apiKey).join('••••').slice(0, 300));
    }
    var vecs = pick(body);
    if (vecs.length !== part.length) throw new Error('embedding 回傳數量不對（要 ' + part.length + ' 個，收到 ' + vecs.length + ' 個）');
    vecs.forEach(function (v) { out.push(botNormVec_(v)); });
  }
  return out;
}

function botKbEmbedText_(r) {
  return [r.BigCategory, r.Topic, r.Title, r.Question, r.Content, r.Notes].map(function (x) { return String(x || '').trim(); }).filter(Boolean).join('\n');
}

function botVecRows_() {
  return sheetToObjects(SHEET_BOT_VEC).rows.map(function (r, i) {
    return { RowIndex: i + 2, id: Number(r['ID']) || 0, model: String(r['Model'] || ''), vec: String(r['Vec'] || '') };
  });
}

/** 寫入 / 更新向量。items = [{ id, model, vec:[數字] }] */
function botVecUpsert_(items) {
  if (!items.length) return;
  withLock_(function () {
    var sheet = getSheet(SHEET_BOT_VEC);
    var rowOf = {};
    botVecRows_().forEach(function (v) { rowOf[v.id] = v.RowIndex; });
    var fresh = [];
    items.forEach(function (it) {
      var cell = [it.model, JSON.stringify(it.vec)];
      if (rowOf[it.id]) sheet.getRange(rowOf[it.id], 2, 1, 2).setValues([cell]);
      else fresh.push([it.id, cell[0], cell[1]]);
    });
    if (fresh.length) {
      var start = sheet.getLastRow() + 1;
      ensureRows_(sheet, start + fresh.length - 1);
      sheet.getRange(start, 1, fresh.length, 3).setValues(fresh);
    }
  });
}

function botVecDelete_(ids) {
  var want = {};
  ids.forEach(function (i) { want[Number(i)] = true; });
  withLock_(function () {
    var sheet = getSheet(SHEET_BOT_VEC);
    botVecRows_().sort(function (a, b) { return b.RowIndex - a.RowIndex; }).forEach(function (v) {
      if (want[v.id]) sheet.deleteRow(v.RowIndex);
    });
  });
}

/** 為還沒有向量（或向量是用別的模型算的）的知識庫項目算向量，每次最多 40 筆；前端一直呼叫到 done。force = 全部重算（用 offset 分批）。 */
function handleBotKbEmbed(body) {
  var cfg = botEmbedCfg_();
  if (!cfg) return { success: false, message: '沒有可用的 embedding 模型：請到「AI 模型」設定 Gemini 或 OpenAI 的 API Key（Claude 沒有 embedding 功能）' };
  var rows = botKbRows_().filter(function (r) { return botKbEmbedText_(r); });
  var have = {};
  botVecRows_().forEach(function (v) { have[v.id] = v.model; });
  var force = body.force === true;
  var list = force ? rows : rows.filter(function (r) { return have[r.ID] !== cfg.key; });
  var start = force ? Math.max(0, Number(body.offset) || 0) : 0;
  var batch = list.slice(start, start + 40);
  if (batch.length) {
    try {
      var vecs = botEmbed_(cfg, batch.map(botKbEmbedText_), 'doc');
      botVecUpsert_(batch.map(function (r, i) { return { id: r.ID, model: cfg.key, vec: vecs[i] }; }));
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
  botKbBump_(); // 向量有更新
  var next = start + batch.length;
  return { success: true, embedded: batch.length, next: next, total: list.length, remaining: Math.max(0, list.length - next), done: next >= list.length, model: cfg.key };
}

/**
 * 選型計算用的相機 / 鏡頭型錄（結構化，不含任何價格、供應商、備註）：
 *   cameras  GigE / USB3 相機（有解析度與像素尺寸才算）
 *   fa       FA 定焦鏡頭（有焦距）
 *   tele     遠心鏡頭（有放大倍率）
 * categories = 只開放的產品類別（客服機器人用，空 = 全部）
 */
var BOT_CALC_PREFERRED = 'Cetus'; // 選型推薦優先推薦的供應商 / 品牌（比對「供應商」或「品牌」欄含這個字，不分大小寫）

function botCalcCatalog_(categories) {
  var want = (categories || []).map(function (c) { return String(c).toLowerCase(); });
  var cams = [];
  var fa = [];
  var tele = [];
  var t = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  readProductsLite_().rows.forEach(function (r) {
    var cat = t(r['Category']);
    if (cat !== '相機' && cat !== '鏡頭') return;
    if (want.length && want.indexOf(cat.toLowerCase()) < 0) return;
    var name = t(r['InternalModel']) || t(r['SupplierModel']);
    if (!name) return;
    var iface = t(r['Interface']);
    var brand = t(r['Brand']);
    // 只回傳「是否優先推薦」的旗標，不把供應商名稱交給客服機器人
    var pref = (brand + '|' + t(r['Supplier'])).toLowerCase().indexOf(BOT_CALC_PREFERRED.toLowerCase()) > -1;
    if (cat === '相機') {
      var isUsb = /usb/i.test(iface);
      if (!/gige/i.test(iface) && !isUsb) return;
      if (isUsb && /usb\s*2/i.test(iface) && !/3/.test(iface)) return;
      var parts = t(r['Resolution']).toUpperCase().split(/X|\*|×/);
      var resW = parseInt(parts[0], 10);
      var resH = parseInt(parts[1], 10);
      if (!(resW > 0) || !(resH > 0)) return;
      var rawPix = t(r['PixelSize']);
      var pm = rawPix.match(/([0-9.]+)\s*[*xX×]\s*([0-9.]+)/);
      var single = rawPix.match(/([0-9.]+)/);
      var pixelW = pm ? parseFloat(pm[1]) : single ? parseFloat(single[1]) : 0;
      var pixelH = pm ? parseFloat(pm[2]) : pixelW;
      if (!(pixelW > 0)) return;
      cams.push({ name: name, brand: brand, resW: resW, resH: resH, pixelW: pixelW, pixelH: pixelH, size: t(r['SensorSize']), iface: isUsb ? 'USB3.0' : 'GigE', fps: parseFloat(t(r['FPS'])) || 0, mp: (resW * resH) / 1e6, effPx: effPixToWan_(t(r['EffectivePixels'])) || Math.floor((resW * resH) / 10000), pref: pref || undefined });
      return;
    }
    var mag = parseFloat(hwNum_(r['Magnification']));
    var f = parseFloat(hwNum_(r['FocalLength']));
    if (mag > 0) tele.push({ name: name, brand: brand, mag: mag, wd: t(r['WD']), dof: t(r['DOF']), sensorSize: t(r['SensorSize']), resolution: t(r['Resolution']), pref: pref || undefined });
    else if (f > 0) fa.push({ name: name, brand: brand, f: f, sensorSize: t(r['SensorSize']), resolution: t(r['Resolution']), focusWd: parseFloat(hwNum_(r['FocusWD'])) || 0, pref: pref || undefined });
  });
  return { cameras: cams, fa: fa, tele: tele, reply: botCalcReply_() };
}

/** 選型計算回覆格式設定（BOT 設定 → 回覆格式）：隨型錄一起交給機器人伺服器，客服與員工助理共用。 */
function botCalcReply_() {
  var c = botSettings_().calc;
  return { brief: c.brief, cameras: c.cameras, lenses: c.lenses, base: c.base };
}

/** 客服機器人用：選型計算的相機 / 鏡頭型錄（只有型號與規格，不含價格、供應商）。BOT 設定「選型計算」開關控制（預設開），跟「產品型號與規格」知識來源各自獨立。 */
function csCalcCatalog_() {
  var cs = botSettings_();
  if (!cs.sources.calc) return { cameras: [], fa: [], tele: [] };
  return botCalcCatalog_(null);
}

/** 知識庫向量（給機器人伺服器分頁取用）：只回傳目前這個 embedding 模型算的、且對應項目還在的。 */
function csVectors_(req, who) {
  who = who === 'staff' ? 'staff' : 'cs';
  var cfg = botEmbedCfg_();
  if (!cfg) return { model: '', items: [], total: 0, next: 0 };
  var alive = {};
  botKbRows_().forEach(function (r) { if (r.IsActive && botKbAud_(r.Audience)[who]) alive[r.ID] = true; });
  var all = botVecRows_().filter(function (v) { return v.model === cfg.key && alive[v.id]; });
  var after = Math.max(0, Number(req.after) || 0);
  var limit = Math.min(500, Math.max(1, Number(req.limit) || 300));
  var page = all.slice(after, after + limit).map(function (v) {
    var arr = [];
    try {
      arr = JSON.parse(v.vec);
    } catch (e) {
      arr = [];
    }
    return { id: 'k' + v.id, v: arr };
  });
  return { model: cfg.key, items: page, total: all.length, next: after + page.length };
}

// ------------------------------------------------------------
// 客服機器人：給 linebot 的操作
// ------------------------------------------------------------
function botHistGen_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty(BOT_GEN_PROP) || 0) || 0;
  } catch (e) {
    return 0;
  }
}

function csHistKey_(id) {
  var gen = botHistGen_();
  return 'csh:' + (gen ? gen + ':' : '') + id;
}

/** 現在是不是小編服務時間（跨夜的時段也可以，例如 22:00 ~ 02:00） */
function csInHours_(h, at) {
  var d = at || new Date();
  var hm = Utilities.formatDate(d, 'GMT+8', 'HH:mm');
  var u = Number(Utilities.formatDate(d, 'GMT+8', 'u')); // 1 = 週一 … 7 = 週日
  var day = u % 7; // 0 = 週日
  if (h.start <= h.end) return h.days.indexOf(day) >= 0 && hm >= h.start && hm < h.end;
  return (h.days.indexOf(day) >= 0 && hm >= h.start) || (h.days.indexOf((day + 6) % 7) >= 0 && hm < h.end);
}

function csHoursText_(h) {
  var names = '日一二三四五六';
  var days = h.days.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
  var text = days.length === 7 ? '每天' : '週' + days.map(function (d) { return names[d]; }).join('、');
  return text + ' ' + h.start + '–' + h.end;
}

function csBrand_() {
  var g = botCfg_('general', {}) || {};
  return String(g.brand || '').trim() || '鑫堡股份有限公司';
}

function csStart_(id, req) {
  var channel = id.charAt(0) === 'V' ? 'web' : id.charAt(0) === 'T' ? 'test' : 'line';
  var cs = botSettings_();
  var gen = botGeneral_();
  var topics = cs.topics.filter(function (t) { return t.on; }).map(function (t) { return { name: t.name, words: botWords_(t.words), ask: t.ask, askPos: t.askPos }; });
  var custom = botWords_(cs.customWords);
  if (custom.length) topics.push({ name: '其他指定問題', words: custom, ask: cs.customAsk, askPos: cs.customAskPos });

  var ais = botAiList_('cs');
  var enabled = channel === 'line' ? cs.enabled : channel === 'web' ? cs.enabled && cs.web.enabled : true;
  var guard = botGuardCfg_(cs.guard);
  var limitReason = '';
  if (channel === 'web') limitReason = botGuardCheck_(id, botGuardIp_(req && req.ip), guard); // 訪客 / IP / 全站流量上限
  var rateLimited = limitReason !== '';
  return {
    enabled: enabled,
    channel: channel,
    appName: csBrand_(),
    brand: csBrand_(),
    welcome: cs.welcome,
    replyDelay: gen.replyDelay,
    prompt: cs.prompt,
    handoffText: cs.handoffText,
    ai: ais.length ? ais[0] : null,
    aiFallback: ais.slice(1),
    search: botSearchCfg_(),
    embedAi: botEmbedCfg_(),
    kbVer: botKbVer_(),
    groundCheck: cs.groundCheck === true,
    handoffButton: cs.handoffButton,
    contactAfter: cs.contactAfter,
    sendImages: cs.sendImages,
    noThinking: cs.noThinking,
    turnCount: Number(botCacheGet_('cscnt:' + id) || 0),
    leadState: String(botCacheGet_('cslead:' + id) || ''),
    // 回覆檢查另外指定了一組 AI 才用它；沒指定就用客服這一組
    checkAi: botAiStored_().some(function (m) { return m.uses.indexOf('check') > -1; }) ? botAiList_('check')[0] || null : null,
    history: botCacheGet_(csHistKey_(id)) || [],
    known: !!botCache_().get('csname:' + id),
    paused: !!botCache_().get('cspause:' + id),
    rateLimited: rateLimited,
    limitReason: limitReason,
    guard: guard,
    replyWhen: cs.replyWhen,
    inHours: cs.hours.enabled ? csInHours_(cs.hours) : null,
    hoursText: cs.hours.enabled ? csHoursText_(cs.hours) : '',
    offText: cs.hours.offText,
    handoffWords: botWords_(cs.handoffWords),
    topics: topics,
    topicText: cs.topicText,
    unsure: cs.unsure,
    style: cs.style,
    buttons: botButtons_(cs.buttons),
    buttonsAlways: cs.buttonsAlways,
  };
}

/** 記錄這一輪對話：短期記憶（快取）+ 對話紀錄（BotMessages）。turns：[{u:true, t:客人說的}, {u:false, t:機器人回的}] */
function csRemember_(id, req) {
  var channel = id.charAt(0) === 'V' ? 'web' : id.charAt(0) === 'T' ? 'test' : 'line';
  var name = botClip_(req.displayName, 40);
  if (name) botCachePut_('csname:' + id, name, 21600);
  var m = botGeneral_().memory;
  var add = (Array.isArray(req.turns) ? req.turns : [])
    .map(function (x) { return { u: !!(x && x.u === true), t: String((x && x.t) || '').trim().slice(0, m.chars) }; })
    .filter(function (x) { return x.t; });
  var list = (botCacheGet_(csHistKey_(id)) || []).concat(add).slice(-m.turns);
  botCachePut_(csHistKey_(id), list, m.hours * 3600);
  if (add.some(function (x) { return x.u; })) botCachePut_('cscnt:' + id, Number(botCacheGet_('cscnt:' + id) || 0) + 1, 21600); // 這位客人聊了幾段
  if (req.askedContact === true && !botCache_().get('cslead:' + id)) botCachePut_('cslead:' + id, 'asked', 21600);
  // 對話紀錄：機器人這則附了圖片，在文字後面加上圖片標記（網站視窗還原對話時會顯示成圖片）
  var imgs = (Array.isArray(req.images) ? req.images : []).slice(0, 5).map(function (im) { return '[[img:' + String((im && im.url) || '').slice(0, 300) + '|' + String((im && im.caption) || '').replace(/[\]|\[]/g, ' ').slice(0, 60) + ']]'; });
  if (channel !== 'test') botLogTurns_(channel, id, name || String(botCacheGet_('csname:' + id) || ''), add.map(function (x) { return { role: x.u ? 'user' : 'bot', text: String(x.t) + (!x.u && imgs.length ? '\n' + imgs.join('\n') : '') }; }), String(req.topic || ''));
  return list.length;
}

function csForget_(id) {
  botCacheRemove_([csHistKey_(id), 'cscnt:' + id]);
  if (botCacheGet_('cslead:' + id) === 'asked') botCacheRemove_(['cslead:' + id]);
  // 對話紀錄裡記一筆「重新開始」：網站視窗重新整理後不再顯示這之前的對話
  if (id.charAt(0) !== 'T') botLogTurns_(id.charAt(0) === 'V' ? 'web' : 'line', id, '', [{ role: 'reset', text: '（客人重新開始對話）' }], '');
  return csResume_(id);
}

/** 這位客人目前有沒有「進行中」的對話：最後一次 reset（重新開始 / 關閉聊天室）之後還有客人或機器人的訊息。 */
function botSessionOpen_(id) {
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var from = Math.max(2, last - 400);
  var rows = sheet.getRange(from, 4, last - from + 1, 3).getValues(); // UserId, Name, Role
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) !== id) continue;
    return rows[i][2] !== 'reset';
  }
  return false;
}

/**
 * 客人關閉了網站客服視窗：這一段對話結束。後台記一筆「客人關閉聊天室」，下次開視窗是全新的一段（機器人不記得上一段）；
 * 之前的紀錄都還在，後台用不同顏色區分。跟「重新開始」不同：不會解除小編接手（還在等專人回覆時視窗不會呼叫這個）。
 */
function csEnd_(id) {
  if (id.charAt(0) === 'T') return true;
  var wasOpen = botSessionOpen_(id);
  botCacheRemove_([csHistKey_(id), 'cscnt:' + id]);
  if (botCacheGet_('cslead:' + id) === 'asked') botCacheRemove_(['cslead:' + id]);
  if (wasOpen) botLogTurns_(id.charAt(0) === 'V' ? 'web' : 'line', id, '', [{ role: 'reset', text: BOT_CLOSE_TEXT }], '');
  return wasOpen;
}

// ---- 對話紀錄（BotMessages） ----
function botNextMsgId_() {
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  if (last < 2) return 1;
  return (Number(sheet.getRange(last, 1).getValue()) || 0) + 1;
}

/** 一次寫入多筆對話紀錄；超過上限就刪最舊的。 */
function botLogTurns_(channel, userId, name, items, topic) {
  if (!items.length) return;
  withLock_(function () {
    var sheet = getSheet(SHEET_BOT_MSG);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var id = botNextMsgId_();
    var t = botNow_();
    var rows = items.map(function (x, i) {
      var o = { ID: id + i, Time: t, Channel: channel, UserId: userId, Name: name, Role: x.role, Text: String(x.text).slice(0, 3000), Topic: x.role === 'user' ? '' : topic };
      return header.map(function (h) { return o.hasOwnProperty(h) ? o[h] : ''; });
    });
    var start = sheet.getLastRow() + 1;
    ensureRows_(sheet, start + rows.length - 1);
    var range = sheet.getRange(start, 1, rows.length, header.length);
    range.setNumberFormat('@');
    range.setValues(rows);
    botLogTrim_(sheet, false);
  });
}

/**
 * 對話紀錄超過上限（BOT 設定可調）就刪掉最舊的。寫入時多留一點緩衝（上限的 10%，最少 10 筆、最多 300 筆）不用每則都刪；
 * force = true（上限改小時）立刻刪到剛好等於上限。回傳刪了幾筆。
 */
function botLogTrim_(sheet, force) {
  var max = botGeneral_().logMax;
  var total = sheet.getLastRow() - 1;
  var slack = force ? 0 : Math.min(300, Math.max(10, Math.floor(max * 0.1)));
  if (total <= max + slack) return 0;
  var n = total - max;
  sheet.deleteRows(2, n);
  return n;
}

/** 客人留下的聯繫資料：客人編號 → { name, company, phone, email, time }（同一位多次留，後面的覆蓋前面的）。 */
function botLeadMap_() {
  var map = {};
  sheetToObjects(SHEET_BOT_LEADS).rows.forEach(function (r) {
    var id = String(r['UserId'] || '');
    if (!id) return;
    var cur = map[id] || { name: '', company: '', phone: '', email: '', time: '' };
    ['Name', 'Company', 'Phone', 'Email'].forEach(function (k) {
      if (String(r[k] || '').trim()) cur[k.toLowerCase()] = String(r[k]).trim();
    });
    cur.time = String(r['Time'] || '');
    map[id] = cur;
  });
  return map;
}

// ---- 轉真人 / 小編接手 ----
function csPauseList_() {
  return (botCacheGet_('cspauses') || []).filter(function (p) { return p.until > Date.now(); });
}

function csPause_(id, name, minutes) {
  botCachePut_('cspause:' + id, 1, minutes * 60);
  withLock_(function () {
    var list = csPauseList_().filter(function (p) { return p.id !== id; });
    list.push({ id: id, name: name || '客人', at: botNow_(), until: Date.now() + minutes * 60000 });
    botCachePut_('cspauses', list.slice(-200), 21600);
  });
}

/** 恢復機器人：解除暫停；下次再找真人會重新通知。 */
function csResume_(id) {
  botCacheRemove_(['cspause:' + id, 'csho:' + id]);
  withLock_(function () {
    botCachePut_('cspauses', csPauseList_().filter(function (p) { return p.id !== id; }), 21600);
  });
  return true;
}

/**
 * 客人要找真人：首頁備忘錄通知（只有有「BOT 設定」權限的人看得到，附上最近的對話；同一位客人 30 分鐘內只通知一次）；
 * 設定「轉真人後暫停」時，這段時間機器人不回這位客人。提早恢復：備忘錄刪除、BOT 設定按「恢復機器人」、客人說「重新開始」。
 */
function csHandoff_(id, req) {
  var pause = botSettings_().pauseMinutes;
  var name = botClip_(req.displayName, 40) || String(botCacheGet_('csname:' + id) || '');
  if (pause > 0) csPause_(id, name, pause);
  if (botCache_().get('csho:' + id)) return false;
  botCachePut_('csho:' + id, 1, 1800);

  var topic = botClip_(req.topic, 40);
  var recent = (botCacheGet_(csHistKey_(id)) || []).slice(-6).map(function (x) { return (x.u ? '客人：' : '機器人：') + String(x.t || '').slice(0, 150); });
  var channelText = id.charAt(0) === 'V' ? '網站訪客' : 'LINE 客人';
  var today = todayStr();
  appendObjectRow(SHEET_MEMOS, {
    Owner: 'SYSTEM',
    OwnerName: '客服機器人',
    Title: '🛎️ 客人找真人：' + (name || channelText) + (topic ? '（' + topic + '）' : ''),
    Content:
      '客人說：' + String(req.text || '').slice(0, 300) +
      (recent.length ? '\n\n【之前的對話】\n' + recent.join('\n') : '') +
      '\n\n' + (id.charAt(0) === 'V' ? '請到「BOT 設定 → 對話與小編接手」回覆這位網站訪客' : '請到 LINE 官方帳號後台（LINE Official Account Manager）回覆') +
      (pause > 0 ? '；機器人 ' + pause + ' 分鐘內不會回這位客人' : '') +
      '\n處理完了把這則備忘錄刪除，機器人就會恢復回覆這位客人。',
    Shared: '是',
    CreatedDate: today,
    LastUpdated: today,
    LinkType: 'csHandoff',
    LinkId: id,
    NeedBlock: 'bot',
    CreatedAt: Date.now(),
  });
  botAlertsBust_();
  return true;
}

// ---- 聯繫名單（客人聊了幾段後留下的聯繫資料；網站視窗的表單、或 AI 聽到客人主動留資料）----
/** 客人留下聯繫資料：存進 BotLeads、首頁備忘錄通知有「BOT 設定」權限的人；至少要有電話或 Email。 */
function csLead_(id, req) {
  var name = botClip_(req.name, 40);
  var company = botClip_(req.company, 60);
  var phone = botClip_(req.phone, 30);
  var email = botClip_(req.email, 80);
  var note = botClip_(req.note, 300);
  if (!phone && !email) throw new Error('請留下電話或 Email，專人才能聯繫您');
  if (phone && phone.replace(/\D/g, '').length < 6) throw new Error('電話號碼看起來不完整');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email 格式不正確');
  var channel = id.charAt(0) === 'V' ? 'web' : id.charAt(0) === 'T' ? 'test' : 'line';
  var source = req.source === 'ai' ? 'ai' : 'form';
  var lineName = String(botCacheGet_('csname:' + id) || '');
  var sent = Number(botCacheGet_('cslc:' + id) || 0); // 同一位客人一小時最多留 5 次，避免被灌名單
  if (sent >= 5) throw new Error('送出太頻繁了，請稍後再試');
  botCachePut_('cslc:' + id, sent + 1, 3600);
  // 換訪客編號也繞不過：同一個 IP 每小時最多留幾次（設定在 BOT 設定 → 防濫用）
  var leadIp = botGuardIp_(req.ip);
  var leadCap = botSettings_().guard.leadPerHour;
  if (channel === 'web' && leadIp && leadCap && botGuardBump_('csg:ld:' + leadIp + ':' + Math.floor(Date.now() / 3600000), 7200) > leadCap) throw new Error('送出太頻繁了，請稍後再試');
  withLock_(function () {
    var max = 0;
    sheetToObjects(SHEET_BOT_LEADS).rows.forEach(function (r) { max = Math.max(max, Number(r['ID']) || 0); });
    appendObjectRow(SHEET_BOT_LEADS, { ID: max + 1, Time: botNow_(), Channel: channel, UserId: id, Name: name || lineName, Company: company, Phone: phone, Email: email, Note: note, Source: source });
  });
  botCachePut_('cslead:' + id, 'done', 21600);
  if (channel !== 'test') {
    var today = todayStr();
    var who = (name || lineName || (channel === 'web' ? '網站訪客' : 'LINE 客人')) + (company ? '（' + company + '）' : '');
    appendObjectRow(SHEET_MEMOS, {
      Owner: 'SYSTEM',
      OwnerName: '客服機器人',
      Title: '📇 新的聯繫名單：' + who,
      Content: ['姓名：' + (name || lineName || '—'), company ? '公司：' + company : '', phone ? '電話：' + phone : '', email ? 'Email：' + email : '', note ? '備註：' + note : '', '來源：' + (channel === 'web' ? '網站客服視窗' : 'LINE') + (source === 'ai' ? '（客人在聊天中主動留下）' : '（留資料表單）'), '\n完整名單在「BOT 設定 → 聯繫名單」。'].filter(Boolean).join('\n'),
      Shared: '是',
      CreatedDate: today,
      LastUpdated: today,
      LinkType: 'csLead',
      LinkId: id,
      NeedBlock: 'bot',
      CreatedAt: Date.now(),
    });
    botAlertsBust_();
  }
  return true;
}

function handleBotLeads(body) {
  var rows = sheetToObjects(SHEET_BOT_LEADS).rows.map(function (r) {
    return { id: Number(r['ID']) || 0, time: String(r['Time'] || ''), channel: String(r['Channel'] || ''), userId: String(r['UserId'] || ''), name: String(r['Name'] || ''), company: String(r['Company'] || ''), phone: String(r['Phone'] || ''), email: String(r['Email'] || ''), note: String(r['Note'] || ''), source: String(r['Source'] || '') };
  });
  rows.sort(function (a, b) { return b.id - a.id; });
  return { success: true, leads: rows.slice(0, 500), total: rows.length };
}

function handleBotLeadDelete(body) {
  var want = {};
  (Array.isArray(body.ids) ? body.ids : []).forEach(function (i) { want[Number(i)] = true; });
  return withLock_(function () {
    var sheet = getSheet(SHEET_BOT_LEADS);
    var rows = sheetToObjects(SHEET_BOT_LEADS).rows;
    var n = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      if (want[Number(rows[i]['ID'])]) {
        sheet.deleteRow(i + 2);
        n++;
      }
    }
    return { success: true, deleted: n };
  });
}

// ---- 知識庫圖片（架構圖、示意圖）：存在雲端硬碟「AOI機器人圖片」資料夾（設成知道連結的人可檢視），知識庫項目記下檔案代號與說明 ----
var BOT_IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
var BOT_IMG_MAX_BYTES = 8 * 1024 * 1024;

function botImgFolder_() {
  var id = getConfig('BotImagesFolderId');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // 資料夾被刪掉，往下重建
    }
  }
  var folder = DriveApp.createFolder('AOI機器人圖片');
  setConfig('BotImagesFolderId', folder.getId());
  return folder;
}

/** 知識庫項目的圖片清單：[{id: 雲端硬碟檔案代號, caption: 說明}]，最多 6 張，格式不對的丟掉。 */
function botKbImages_(raw) {
  var list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw || '[]');
    } catch (e) {
      list = [];
    }
  }
  var seen = {};
  return (Array.isArray(list) ? list : []).map(function (x) {
    return { id: String((x && x.id) || '').trim(), caption: botClip_(x && x.caption, 60) };
  }).filter(function (x) {
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(x.id) || seen[x.id]) return false;
    seen[x.id] = true;
    return true;
  }).slice(0, 6);
}

/** 上傳一張知識庫圖片（網頁端先縮到 1600px 以內再傳）。回傳雲端硬碟檔案代號。 */
function handleBotKbImageUpload(body) {
  var mime = String(body.mimeType || '').toLowerCase();
  if (!BOT_IMG_TYPES[mime]) return { success: false, message: '只能上傳 JPG / PNG / WebP / GIF 圖片' };
  var b64 = String(body.base64 || '');
  if (!b64) return { success: false, message: '沒有收到圖片內容' };
  var bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (e) {
    return { success: false, message: '圖片內容格式不正確' };
  }
  if (bytes.length > BOT_IMG_MAX_BYTES) return { success: false, message: '圖片太大了（上限 8MB），請縮小後再上傳' };
  var name = String(body.filename || 'image').replace(/[^\w.\-一-龥]+/g, '_').slice(0, 80) || 'image';
  var file = botImgFolder_().createFile(Utilities.newBlob(bytes, mime, name));
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e2) {
    file.setTrashed(true);
    return { success: false, message: '無法把圖片設成「知道連結的人可檢視」（可能是 Google Workspace 的組織政策擋住分享），客人才看不到圖片。請管理員開放分享，或改用個人 Google 帳號部署。' };
  }
  return { success: true, id: file.getId(), name: name };
}

/**
 * 網站訪客視窗用：這位訪客的對話（只算最後一次「重新開始」之後的）。
 * after = 最後一則的編號：只回比它新的（輪詢小編的回覆）；不帶 = 最近 40 則（重新整理後還原）。
 */
function csThread_(id, req) {
  var after = Number(req.after) || 0;
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var rows = [];
  if (last >= 2) {
    var from = Math.max(2, last - 400);
    sheet.getRange(from, 1, last - from + 1, 8).getValues().forEach(function (r) {
      if (String(r[3]) !== id) return;
      if (r[5] === 'reset') rows = [];
      else rows.push({ id: Number(r[0]), role: String(r[5]) === 'human' ? 'human' : String(r[5]) === 'bot' ? 'bot' : 'user', text: String(r[6]) });
    });
  }
  if (after > 0) rows = rows.filter(function (m) { return m.id > after; });
  else rows = rows.slice(-40);
  return { messages: rows, paused: !!botCache_().get('cspause:' + id) };
}

/** 網站訪客視窗輪詢：小編（真人）在後台回覆的訊息，以及現在是不是小編接手中。 */
function csMessages_(id, req) {
  var after = Number(req.after) || 0;
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    var from = Math.max(2, last - 150);
    sheet.getRange(from, 1, last - from + 1, 8).getValues().forEach(function (r) {
      if (String(r[3]) === id && r[5] === 'human' && Number(r[0]) > after) out.push({ id: Number(r[0]), text: String(r[6]) });
    });
  }
  return { messages: out, paused: !!botCache_().get('cspause:' + id) };
}

// ---- 知識庫（RAG 的資料來源；機器人端再做檢索） ----
function botChunkText_(text, size) {
  var paras = String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
  var out = [];
  var cur = '';
  paras.forEach(function (p) {
    while (p.length > size) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(p.slice(0, size));
      p = p.slice(size);
    }
    if ((cur + '\n' + p).length > size && cur) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + '\n' + p : p;
    }
  });
  if (cur) out.push(cur);
  return out;
}

/** 產品放進知識庫的文字：型號、品牌、類別與選型規格（不含底價、供應商與任何內部資料）。 */
/** 一個產品給客服看的文字：只含白名單欄位（fields 是管理員勾選的子集）；底價、供應商、備註不在白名單裡，無論如何不會出現。 */
function botProductText_(p, fields) {
  var t = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var use = botCsFields_(fields);
  var model = t(p['InternalModel']) || t(p['SupplierModel']);
  var lines = ['產品型號：' + model + (use.indexOf('SupplierModel') > -1 && t(p['SupplierModel']) && t(p['SupplierModel']) !== model ? '（原廠型號 ' + t(p['SupplierModel']) + '）' : '')];
  BOT_CS_PRODUCT_FIELDS.forEach(function (f) {
    if (f[0] === 'SupplierModel' || use.indexOf(f[0]) < 0) return;
    var v = t(p[f[0]]);
    if (v && v.indexOf('不納入選型') < 0) lines.push(f[1] + '：' + v);
  });
  return lines.join('\n');
}

/**
 * 客服能看到的產品列：符合類別、有型號的全部列，相機 / 鏡頭排在前面（超過筆數上限時，被截掉的先是光源、配件，不會是相機鏡頭）。
 * total = 符合的總數、shown = 實際給機器人的（受「最多 N 筆」限制）。
 */
function botCsProductRows_(cs) {
  var text = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  var cats = String(cs.sources.productCategories || '').split(/[,，、\n]+/).map(function (c) { return c.trim().toLowerCase(); }).filter(Boolean);
  var first = [];
  var rest = [];
  readProductsLite_().rows.forEach(function (p) {
    if (cats.length && cats.indexOf(text(p['Category']).toLowerCase()) < 0) return;
    if (!(text(p['InternalModel']) || text(p['SupplierModel']))) return;
    var c = text(p['Category']);
    (c === '相機' || c === '鏡頭' ? first : rest).push(p);
  });
  var all = first.concat(rest);
  return { total: all.length, shown: all.slice(0, cs.sources.productLimit) };
}

function csKnowledge_() {
  var cs = botSettings_();
  var out = [];
  var text = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  if (cs.sources.qa || cs.sources.docs) {
    sheetToObjects(SHEET_BOT_KB).rows.forEach(function (k) {
      if (k['IsActive'] === false || String(k['IsActive']).toUpperCase() === 'FALSE') return;
      if (k['Type'] === 'doc' ? !cs.sources.docs : !cs.sources.qa) return;
      if (!botKbAud_(k['Audience']).cs) return; // 這一筆沒有開放給對外客服
      out.push({
        id: 'k' + k['ID'],
        source: k['Type'] === 'doc' ? '文件' : '常見問題',
        title: text(k['Title']) || text(k['Question']),
        category: text(k['BigCategory']),
        topic: text(k['Topic']),
        notes: text(k['Notes']),
        tags: text(k['Tags']),
        images: cs.sendImages ? botKbImages_(k['Images']) : [],
        text: [k['Question'] ? '問：' + text(k['Question']) : '', k['Question'] ? '答：' + text(k['Content']) : text(k['Content']), k['Tags'] ? '關鍵字：' + text(k['Tags']) : ''].filter(Boolean).join('\n'),
      });
    });
  }
  if (cs.sources.brand && text(cs.brandInfo)) {
    botChunkText_(cs.brandInfo, 500).forEach(function (c, i) {
      out.push({ id: 'b' + i, source: '公司資訊', title: '公司資訊', text: c });
    });
  }
  if (cs.sources.products) {
    var n = 0;
    botCsProductRows_(cs).shown.forEach(function (p) {
      n++;
      out.push({ id: 'p' + n, source: '產品', title: text(p['InternalModel']) || text(p['SupplierModel']), text: botProductText_(p, cs.sources.productFields) });
    });
  }
  return out;
}

/**
 * 員工助理用的知識庫：全部「啟用中」的常見問答、文件與公司資訊（不受客服「可用來源」勾選限制，因為這是公司自己的資料）。
 * 產品另有產品查詢工具（含權限與底價隱藏），所以不放在這裡。id 與客服相同（向量共用）。
 */
function botStaffKnowledge_() {
  var cs = botSettings_();
  var out = [];
  var text = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };
  sheetToObjects(SHEET_BOT_KB).rows.forEach(function (k) {
    if (k['IsActive'] === false || String(k['IsActive']).toUpperCase() === 'FALSE') return;
    if (!botKbAud_(k['Audience']).staff) return; // 這一筆沒有開放給員工助理
    out.push({
      id: 'k' + k['ID'],
      source: k['Type'] === 'doc' ? '文件' : '常見問題',
      title: text(k['Title']) || text(k['Question']),
      category: text(k['BigCategory']),
      topic: text(k['Topic']),
      notes: text(k['Notes']),
      tags: text(k['Tags']),
      text: [k['Question'] ? '問：' + text(k['Question']) : '', k['Question'] ? '答：' + text(k['Content']) : text(k['Content']), k['Tags'] ? '關鍵字：' + text(k['Tags']) : ''].filter(Boolean).join('\n'),
    });
  });
  if (text(cs.brandInfo)) {
    botChunkText_(cs.brandInfo, 500).forEach(function (c, i) {
      out.push({ id: 'b' + i, source: '公司資訊', title: '公司資訊', text: c });
    });
  }
  return out;
}

/** 網站嵌入視窗的公開設定（外觀、歡迎詞、按鈕、允許嵌入的網站）；沒有任何金鑰。 */
function csWidgetConfig_() {
  var cs = botSettings_();
  return {
    enabled: cs.enabled && cs.web.enabled,
    title: cs.web.title,
    subtitle: cs.web.subtitle,
    color: cs.web.color,
    position: cs.web.position,
    autoOpen: cs.web.autoOpen,
    resetOnReload: cs.web.resetOnReload,
    allowedOrigins: cs.web.allowedOrigins,
    guard: cs.guard,
    welcome: cs.welcome || '👋 您好，我是' + csBrand_() + '的線上客服，有任何問題都可以直接問我；需要專人協助請輸入「' + (botWords_(cs.handoffWords)[0] || '真人') + '」。',
    buttons: botButtons_(cs.buttons),
    replyDelay: botGeneral_().replyDelay,
    handoffButton: cs.handoffButton,
    handoffWord: botWords_(cs.handoffWords)[0] || '真人',
  };
}

// ------------------------------------------------------------
// BOT 設定頁（需要「BOT 設定」權限）
// ------------------------------------------------------------
function botKeyHint_(role) {
  var s = botKey_(role);
  return s ? '••••' + s.slice(-4) : '';
}

function botMaskedAi_() {
  var cfg = botCfg_('ai', {}) || {};
  var list = (Array.isArray(cfg.models) ? cfg.models : []).filter(function (m) { return m && m.apiKey; });
  var stored = botAiStored_(); // 套用「舊設定第一組 = 整個系統」
  return list.map(function (m, i) {
    var def = BOT_AI_PROVIDERS[m.provider] || BOT_AI_PROVIDERS.gemini;
    return { provider: BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini', model: String(m.model || ''), endpoint: String(m.endpoint || ''), name: String(m.name || '').trim().slice(0, 30), uses: stored[i] ? stored[i].uses : [], hasKey: !!m.apiKey, keyHint: m.apiKey ? '••••' + String(m.apiKey).slice(-4) : '', defaultModel: def.model };
  });
}

/** 每個功能現在實際用哪一組（給設定畫面的「目前：…」摘要）。 */
function botAiAssign_() {
  var out = {};
  Object.keys(BOT_AI_FEATURES).forEach(function (f) {
    var l = f === 'vector' ? [] : botAiList_(f);
    if (f === 'vector') {
      var e = botEmbedCfg_();
      out[f] = e ? { name: '', provider: e.provider, model: e.model } : null;
    } else {
      out[f] = l.length ? { name: l[0].name, provider: l[0].provider, model: l[0].model } : null;
    }
  });
  return out;
}

function handleBotGetSettings(body) {
  var cs = botSettings_();
  var gen = botGeneral_();
  var url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }
  var ais = botAiList_('cs');
  var kbCount = Math.max(0, getSheet(SHEET_BOT_KB).getLastRow() - 1);
  return {
    success: true,
    cs: cs,
    general: { replyDelay: gen.replyDelay, botUrl: gen.botUrl, brand: csBrand_(), memory: gen.memory, logMax: gen.logMax },
    ai: botMaskedAi_(),
    aiFeatures: BOT_AI_FEATURES,
    aiSystem: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
    aiAssign: botAiAssign_(),
    aiRounds: botAiRounds_(),
    aiProviders: BOT_AI_PROVIDERS,
    aiUsing: ais.length ? { source: ais[0].source, name: BOT_AI_PROVIDERS[ais[0].provider].name, model: ais[0].model, count: ais.length } : null,
    keys: {
      cs: { has: !!botKey_('cs'), hint: botKeyHint_('cs'), shared: botKeyShared_('cs') },
      staff: { has: !!botKey_('staff'), hint: botKeyHint_('staff'), shared: botKeyShared_('staff') },
    },
    csProductFields: BOT_CS_PRODUCT_FIELDS,
    search: botSearchCfg_(),
    embed: (function () { var c = botEmbedCfg_(); return c ? { provider: c.provider, model: c.model, dim: c.dim } : null; })(),
    gasUrl: url,
    kbCount: kbCount,
    pauses: csPauseList_(),
    topicDefaults: BOT_CS_TOPICS,
  };
}

function handleBotSaveSettings(body) {
  botKbBump_(); // 客服可用來源 / 公司資訊 / 搜尋設定有變，機器人要重讀
  return withLock_(function () {
    var trimmed = 0;
    if (body.cs) {
      var cs = body.cs;
      // 表單送上來的 topics 是陣列 [{key,on,words,ask,askPos}]：轉成存檔格式再整理
      var stored = Object.assign({}, cs);
      if (Array.isArray(cs.topics)) {
        stored.topics = {};
        cs.topics.forEach(function (t) {
          stored.topics[t.key] = { on: t.on === true, words: t.words, ask: t.ask, askPos: t.askPos };
        });
      }
      if (stored.groundCheck === undefined) stored.groundCheck = (botCfg_('cs', {}) || {}).groundCheck === true; // 表單沒帶（例如只改別的設定）就沿用
      var clean = botCsConfig_(stored);
      botCfgSet_('cs', botCsStored_(clean));
    }
    if (body.groundCheck !== undefined && !body.cs) {
      var curCs = botCfg_('cs', {}) || {};
      curCs.groundCheck = body.groundCheck === true;
      botCfgSet_('cs', curCs);
    }
    if (body.search) {
      var sc = body.search;
      botCfgSet_('search', { mode: sc.mode, threshold: sc.threshold, topK: sc.topK, embedProvider: sc.embedProvider });
    }
    if (body.general) {
      var g = botCfg_('general', {}) || {};
      var gg = body.general;
      if (gg.replyDelay !== undefined) g.replyDelay = botInt_(gg.replyDelay, 0, 10, 2);
      if (gg.botUrl !== undefined) {
        var u = String(gg.botUrl || '').trim().replace(/\/+$/, '');
        if (u && !/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(u)) throw new Error('機器人網址格式不對（要是 https://你的專案.vercel.app）');
        g.botUrl = u;
      }
      if (gg.brand !== undefined) g.brand = botClip_(gg.brand, 60);
      if (gg.memory) g.memory = { turns: botInt_(gg.memory.turns, 2, 40, 10), hours: botInt_(gg.memory.hours, 1, 6, 6), chars: botInt_(gg.memory.chars, 50, 2000, 600) };
      if (gg.logMax !== undefined) g.logMax = botInt_(gg.logMax, 50, 20000, BOT_LOG_MAX);
      botCfgSet_('general', g);
      // 對話紀錄上限改小：立刻把超過的最舊紀錄刪掉
      if (gg.logMax !== undefined) trimmed = botLogTrim_(getSheet(SHEET_BOT_MSG), true);
    }
    return { success: true, trimmed: trimmed };
  });
}

/** 儲存 AI 模型清單（依順序備援）與各組用在哪些功能。每一筆金鑰留空 = 沿用原本同一位置、同一服務的金鑰。 */
function handleBotSaveAi(body) {
  return withLock_(function () {
    var oldCfg = botCfg_('ai', {}) || {};
    var old = oldCfg.models || [];
    var models = [];
    var taken = {}; // 每個功能只會用一組：重複勾選時，排在前面的保留
    (Array.isArray(body.models) ? body.models : []).slice(0, 8).forEach(function (m, i) {
      if (!m) return;
      var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
      var key = String(m.apiKey || '').trim();
      if (!key && old[i] && old[i].provider === provider) key = old[i].apiKey || '';
      if (!key) return; // 沒有金鑰的列略過
      var endpoint = String(m.endpoint || '').trim();
      if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error('Endpoint 要用 https:// 開頭');
      var uses = botAiUses_(m.uses).filter(function (u) {
        if (taken[u]) return false;
        taken[u] = true;
        return true;
      });
      models.push({ provider: provider, apiKey: key, model: String(m.model || '').trim(), endpoint: endpoint, name: String(m.name || '').trim().slice(0, 30), uses: uses });
    });
    var rounds = body.maxRounds !== undefined ? botInt_(body.maxRounds, 1, 12, 6) : botInt_(oldCfg.maxRounds, 1, 12, 6);
    botCfgSet_('ai', { models: models, maxRounds: rounds });
    botKbBump_(); // 向量用哪組 AI 可能變了
    return { success: true, ai: botMaskedAi_(), aiAssign: botAiAssign_(), aiRounds: botAiRounds_() };
  });
}

/** 用目前存的第 index 個 AI 發一句話測試（金鑰不會出現在回傳）。 */
function handleBotTestAi(body) {
  var list = botAiStored_();
  var i = Number(body.index) || 0;
  if (!list.length) return { success: false, message: '還沒有設定 AI（或金鑰是空的）' };
  if (!list[i]) return { success: false, message: '沒有第 ' + (i + 1) + ' 個 AI 模型' };
  try {
    var t0 = Date.now();
    var text = botCallAi_(list[i], '你是測試助理，請用繁體中文只回覆兩個字：成功。', [{ role: 'user', text: '測試' }]);
    return { success: true, reply: text.slice(0, 100), ms: Date.now() - t0, model: list[i].model, provider: BOT_AI_PROVIDERS[list[i].provider].name };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** 預覽客服機器人「現在實際看得到」的資料：各來源筆數、產品範例，以及永遠看不到的內部資料。 */
function handleBotCsPreview(body) {
  var chunks = csKnowledge_();
  var counts = {};
  var products = [];
  chunks.forEach(function (c) {
    counts[c.source] = (counts[c.source] || 0) + 1;
    if (c.source === '產品' && products.length < 3) products.push(c.text);
  });
  var cs = botSettings_();
  var prod = cs.sources.products ? botCsProductRows_(cs) : { total: 0, shown: [] };
  return {
    success: true,
    productTotal: prod.total,
    productShown: prod.shown.length,
    productLimit: cs.sources.productLimit,
    total: chunks.length,
    counts: counts,
    sampleProducts: products,
    productFields: cs.sources.productFields,
    blocked: ['產品底價、供應商、產品備註', '客戶資料、聯絡窗口、聯繫紀錄與追蹤', '案件與評估、報價', '員工、帳號與權限', '員工助理的記憶與對話', '其他試算表分頁'],
  };
}

function botKbRows_() {
  return sheetToObjects(SHEET_BOT_KB).rows.map(function (r, i) {
    return {
      RowIndex: i + 2,
      ID: Number(r['ID']) || 0,
      Type: r['Type'] === 'doc' ? 'doc' : 'qa',
      Title: String(r['Title'] || ''),
      Question: String(r['Question'] || ''),
      Content: String(r['Content'] || ''),
      Tags: String(r['Tags'] || ''),
      Source: String(r['Source'] || ''),
      IsActive: !(r['IsActive'] === false || String(r['IsActive']).toUpperCase() === 'FALSE'),
      UpdatedAt: String(r['UpdatedAt'] || ''),
      BigCategory: String(r['BigCategory'] || ''),
      Topic: String(r['Topic'] || ''),
      Notes: String(r['Notes'] || ''),
      Audience: String(r['Audience'] || ''),
      Overlap: Number(r['Overlap']) || 0,
      ChunkSize: r['ChunkSize'] === '' || r['ChunkSize'] == null ? '' : Number(r['ChunkSize']) || '',
      SortOrder: Number(r['SortOrder']) || 0,
      FileName: String(r['FileName'] || ''),
      Images: String(r['Images'] || ''),
    };
  });
}

/** 知識庫每一筆「誰看得到」：空白 = 都開放；cs = 對外客服、staff = 員工助理（逗號分隔）；none = 都不開放。 */
function botKbAud_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return { cs: true, staff: true };
  var parts = s.split(',').map(function (x) { return x.trim(); });
  return { cs: parts.indexOf('cs') > -1, staff: parts.indexOf('staff') > -1 };
}

function botKbAudList_(raw) {
  var a = botKbAud_(raw);
  return ['cs', 'staff'].filter(function (k) { return a[k]; });
}

/** 前端送來的 ['cs','staff'] 整理成要存的字串（沒帶 = 都開放）。 */
function botKbAudStore_(arr) {
  if (arr === undefined || arr === null) return 'cs,staff';
  var list = (Array.isArray(arr) ? arr : String(arr).split(',')).map(String);
  var out = ['cs', 'staff'].filter(function (k) { return list.indexOf(k) > -1; });
  return out.length ? out.join(',') : 'none';
}

/** 批次設定知識庫的「誰看得到」。ids = 知識庫項目編號陣列。 */
function handleBotKbSetAudience(body) {
  var ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(function (n) { return n > 0; });
  if (!ids.length) return { success: false, message: '沒有選任何項目' };
  var value = botKbAudStore_(body.audience || []);
  botKbBump_();
  return withLock_(function () {
    var want = {};
    ids.forEach(function (i) { want[i] = true; });
    var n = 0;
    botKbRows_().forEach(function (r) {
      if (!want[r.ID]) return;
      updateRowFields(SHEET_BOT_KB, r.RowIndex, { Audience: value });
      n++;
    });
    return { success: true, count: n, audience: botKbAudList_(value) };
  });
}

function handleBotKbList(body) {
  var cfg = botEmbedCfg_();
  var have = {};
  botVecRows_().forEach(function (v) { have[v.id] = v.model; });
  var items = botKbRows_().map(function (r) {
    r.HasVector = !!cfg && have[r.ID] === cfg.key;
    r.audience = botKbAudList_(r.Audience);
    r.images = botKbImages_(r.Images);
    return r;
  });
  var cats = {};
  items.forEach(function (r) { if (r.BigCategory) cats[r.BigCategory] = (cats[r.BigCategory] || 0) + 1; });
  return { success: true, items: items, embed: cfg ? { provider: cfg.provider, model: cfg.model, dim: cfg.dim } : null, categories: Object.keys(cats).sort(), pendingVectors: cfg ? items.filter(function (r) { return !r.HasVector && botKbEmbedText_(r); }).length : 0 };
}

var BOT_KB_SPLIT_MAX = 120000;
var BOT_KB_SPLIT_PROMPT = [
  '你是文件整理員，要把一份文件切成適合「向量搜尋」的段落：每一段要能單獨被看懂、只講一個主題。',
  '文件已經切成編號的句子（[編號] 句子；⏎ 代表換行）。請先讀完整份文件，再決定每一段從第幾句開始。',
  '規則：',
  '1. 每段大約 {target} 字，可以在 {min}～{max} 字之間調整，以「主題完整」優先。',
  '2. 不要把同一個重點、同一張表格、同一組條列、問題和它的答案拆到兩段。',
  '3. 第一段一定從 1 開始，start 要由小到大，不能跳號重複。',
  '4. 每段給一個 4～12 字的小標，說明這段在講什麼（例如：保險金額、保險期間）。',
  '只輸出 JSON，不要其他文字：{"chunks":[{"start":1,"title":"小標"},{"start":8,"title":"小標"}]}',
].join('\n');

/** 文件切成句子（句號、問號、驚嘆號、分號、換行後切開；太長的句子再硬切），接起來 = 原文。 */
function botKbUnits_(text, maxLen) {
  var out = [];
  var cur = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    cur += ch;
    var end = /[。！？!?；;\n]/.test(ch) && !/[。！？!?；;\n」』）)]/.test(text.charAt(i + 1) || '');
    if (end || cur.length >= maxLen) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 讓 AI 來切文件：先把文件切成編號的句子，AI 讀過整份文件後只回傳「每一段從第幾句開始」與小標（不重寫內容，原文不會被改）。
 * { text, target 每段大約幾字, profile 用哪一組 AI（空白 = 整個系統那組；sys = 系統共用 Gemini；數字 = 清單第幾組，從 0 開始）, model 指定模型（空白 = 那組設定的模型） }
 * → { chunks: [{ text, title }], model, name, units }；段落接起來 = 原文。費用記在選的那組金鑰，不備援。
 */
function handleBotKbAiSplit(body) {
  var text = String(body.text || '').replace(/\r/g, '').trim();
  if (!text) return { success: false, message: '請先貼上文件內容' };
  if (text.length > BOT_KB_SPLIT_MAX) return { success: false, message: '文件太長（超過 ' + BOT_KB_SPLIT_MAX + ' 字），請分成幾份文件' };
  var target = botInt_(body.target, 100, 3000, 500);
  var pick = body.profile === undefined || body.profile === null ? '' : String(body.profile);
  var ai = null;
  if (pick === '') ai = botAiList_('all')[0] || null;
  else if (pick === 'sys') ai = botAiList_().filter(function (m) { return m.source === 'system'; })[0] || null;
  else ai = botAiStored_()[Number(pick)] || null;
  if (!ai) return { success: false, message: '找不到這組 AI，或還沒有設定 AI：請到「AI 模型」新增' };
  var model = String(body.model || '').trim().slice(0, 100);
  if (model && !/^[\w.:\/@-]+$/.test(model)) return { success: false, message: '模型名稱格式不正確' };
  var use = { provider: ai.provider, apiKey: ai.apiKey, endpoint: ai.endpoint, model: model || ai.model };
  var units = botKbUnits_(text, Math.max(60, Math.floor(target / 2)));
  var listing = units.map(function (u, i) { return '[' + (i + 1) + '] ' + u.replace(/\n/g, '⏎'); }).join('\n');
  var system = BOT_KB_SPLIT_PROMPT.replace('{target}', target).replace('{min}', Math.round(target * 0.5)).replace('{max}', Math.round(target * 1.5));
  var reply;
  try {
    reply = botCallAi_(use, system, [{ role: 'user', text: listing }], { maxTokens: 8192 });
  } catch (e) {
    return { success: false, message: e.message };
  }
  var res = null;
  try {
    var m = String(reply).match(/\{[\s\S]*\}/);
    res = JSON.parse(m ? m[0] : '');
  } catch (e2) {
    res = null;
  }
  var list = res && Array.isArray(res.chunks) ? res.chunks : null;
  if (!list || !list.length) return { success: false, message: 'AI 回覆的格式不對（' + use.model + '），請再試一次，或取消勾選改用一般切段' };
  // 整理起點：整數、由小到大、第一段從 1 開始；不合理的丟掉
  var starts = [];
  var titles = [];
  list.forEach(function (c) {
    var n = Math.round(Number(c && c.start));
    if (!(n >= 1 && n <= units.length) || (starts.length && n <= starts[starts.length - 1])) return;
    starts.push(n);
    titles.push(botClip_(c.title, 20));
  });
  if (!starts.length) return { success: false, message: 'AI 回覆的段落編號不對，請再試一次，或取消勾選改用一般切段' };
  if (starts[0] !== 1) {
    starts.unshift(1);
    titles.unshift('');
  }
  var chunks = starts.map(function (st, i) {
    return { text: units.slice(st - 1, (starts[i + 1] || units.length + 1) - 1).join(''), title: titles[i] };
  }).filter(function (c) { return c.text; });
  return { success: true, chunks: chunks, model: use.model, name: ai.source === 'system' ? '系統共用' : ai.name || '', units: units.length };
}

function botNextKbId_() {
  var max = 0;
  sheetToObjects(SHEET_BOT_KB).rows.forEach(function (r) {
    max = Math.max(max, Number(r['ID']) || 0);
  });
  return max + 1;
}

function handleBotKbSave(body) {
  var type = body.type === 'doc' ? 'doc' : 'qa';
  var content = String(body.content || '').trim();
  var question = String(body.question || '').trim();
  var title = String(body.title || '').trim();
  if (type === 'qa' && !question) return { success: false, message: '請填問題' };
  if (!content) return { success: false, message: '請填內容 / 答案' };
  if (content.length > 20000) return { success: false, message: '內容太長了（上限 20000 字），長文件請用「文件」匯入，會自動切成小段' };
  return withLock_(function () {
    var fields = { Type: type, Title: title || (type === 'qa' ? question.slice(0, 40) : content.slice(0, 20)), Question: type === 'qa' ? question : '', Content: content, Tags: String(body.tags || '').trim(), Source: String(body.source || ''), IsActive: body.isActive === false ? false : true, UpdatedAt: botNow_(), BigCategory: botClip_(body.bigCategory, 40), Topic: botClip_(body.topic, 60), Notes: String(body.notes || '').trim().slice(0, 1000) };
    if (body.audience !== undefined) fields.Audience = botKbAudStore_(body.audience); // 沒帶 = 修改時不動、新增時都開放
    if (body.images !== undefined) fields.Images = JSON.stringify(botKbImages_(body.images)); // 沒帶 = 修改時不動
    botKbBump_();
    var id;
    if (body.rowIndex) {
      var sheet = getSheet(SHEET_BOT_KB);
      var rowNum = Number(body.rowIndex);
      if (!(rowNum >= 2 && rowNum <= sheet.getLastRow()) || Number(sheet.getRange(rowNum, 1).getValue()) !== Number(body.id)) return { success: false, message: '這筆資料已經被修改或刪除，請重新整理後再試' };
      updateRowFields(SHEET_BOT_KB, rowNum, fields);
      id = Number(body.id);
    } else {
      id = botNextKbId_();
      appendObjectRow(SHEET_BOT_KB, Object.assign({ ID: id, Audience: 'cs,staff' }, fields));
    }
    // 順便算這一筆的向量（失敗不影響儲存；之後可以按「重新計算向量」補上）
    var embedded = false;
    var embedError = '';
    var ecfg = botEmbedCfg_();
    if (ecfg) {
      try {
        var v = botEmbed_(ecfg, [botKbEmbedText_(Object.assign({ ID: id }, fields))], 'doc');
        botVecUpsert_([{ id: id, model: ecfg.key, vec: v[0] }]);
        embedded = true;
      } catch (e) {
        embedError = e.message;
      }
    }
    return { success: true, id: id, embedded: embedded, embedError: embedError };
  });
}

/**
 * 儲存一份文件（新增或整份重建）：chunks = [{ title(小標), content, overlap }] 前端已經切好段（一般切段或「讓 AI 來切」）。
 * key = 這份文件的代號（編輯既有文件時帶；沒帶就是新文件）：同一個 key 的舊段落會先整份刪掉（連同向量）再寫入新的。
 * 段落標題 = 文件名稱（第幾段/共幾段）｜小標；content 開頭的 overlap 個字是上一段結尾（接回原文時要去掉）。
 */
function handleBotKbDocSave(body) {
  var title = String(body.title || '').trim().slice(0, 100);
  if (!title) return { success: false, message: '請填文件名稱' };
  var chunks = (Array.isArray(body.chunks) ? body.chunks : []).map(function (c) {
    return { content: String((c && c.content) || '').trim().slice(0, 20000), overlap: Math.max(0, Number(c && c.overlap) || 0), title: botClip_(c && c.title, 40) };
  }).filter(function (c) { return c.content; });
  if (!chunks.length) return { success: false, message: '沒有可儲存的內容' };
  if (chunks.length > 1000) return { success: false, message: '這份文件太大了（超過 1000 段），請拆成幾份再儲存' };
  var size = botInt_(body.chunkSize, 100, 3000, 500);
  var key = String(body.key || '').trim().slice(0, 80) || 'doc-' + Date.now();
  botKbBump_();
  return withLock_(function () {
    // 舊段落（同一份文件）整份刪掉
    var sheet = getSheet(SHEET_BOT_KB);
    var gone = [];
    botKbRows_().filter(function (r) {
      return r.Type === 'doc' && (r.FileName === key || (!r.FileName && r.Source === key));
    }).sort(function (a, b) { return b.RowIndex - a.RowIndex; }).forEach(function (r) {
      gone.push(r.ID);
      sheet.deleteRow(r.RowIndex);
    });
    if (gone.length) botVecDelete_(gone);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var id = botNextKbId_();
    var t = botNow_();
    var n = chunks.length;
    var rows = chunks.map(function (c, i) {
      var o = {
        ID: id + i, Type: 'doc',
        Title: c.title ? title + '（' + (i + 1) + '/' + n + '）｜' + c.title : n > 1 ? title + '（' + (i + 1) + '/' + n + '）' : title,
        Question: '', Content: c.content, Tags: String(body.tags || '').trim().slice(0, 200), Source: title, IsActive: body.isActive === false ? false : true, UpdatedAt: t,
        BigCategory: botClip_(body.bigCategory, 40), Topic: botClip_(body.topic, 60), Notes: String(body.notes || '').trim().slice(0, 1000),
        Audience: botKbAudStore_(body.audience), Overlap: c.overlap, ChunkSize: size, SortOrder: i + 1, FileName: key, Images: JSON.stringify(botKbImages_(body.images)),
      };
      return o;
    });
    var values = rows.map(function (o) { return header.map(function (h) { return o.hasOwnProperty(h) ? o[h] : ''; }); });
    var start = sheet.getLastRow() + 1;
    ensureRows_(sheet, start + values.length - 1);
    sheet.getRange(start, 1, values.length, header.length).setValues(values);
    // 順便算向量（失敗不影響儲存；之後可以按「補算還沒有向量的」）
    var embedded = 0;
    var embedError = '';
    var ecfg = botEmbedCfg_();
    if (ecfg && rows.length <= 150) {
      try {
        for (var i = 0; i < rows.length; i += 50) {
          var part = rows.slice(i, i + 50);
          var vecs = botEmbed_(ecfg, part.map(botKbEmbedText_), 'doc');
          botVecUpsert_(part.map(function (o, j) { return { id: o.ID, model: ecfg.key, vec: vecs[j] }; }));
          embedded += part.length;
        }
      } catch (e) {
        embedError = e.message;
      }
    }
    return { success: true, key: key, count: rows.length, embedded: embedded, embedError: embedError };
  });
}

/** 匯入文件：rows = [{ title, content, source, tags }]（前端已經切好段），一次寫入。 */
function handleBotKbImport(body) {
  var rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return { success: false, message: '沒有要匯入的內容' };
  if (rows.length > 400) return { success: false, message: '一次最多匯入 400 段，請分批匯入' };
  botKbBump_();
  return withLock_(function () {
    var sheet = getSheet(SHEET_BOT_KB);
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var id = botNextKbId_();
    var t = botNow_();
    var values = [];
    rows.forEach(function (r) {
      var content = String(r.content || '').trim().slice(0, 20000);
      if (!content) return;
      var o = { ID: id++, Type: 'doc', Title: String(r.title || '').trim().slice(0, 120) || content.slice(0, 20), Question: '', Content: content, Tags: String(r.tags || ''), Source: String(r.source || '').slice(0, 120), IsActive: true, UpdatedAt: t, BigCategory: botClip_(r.bigCategory || body.bigCategory, 40), Topic: botClip_(r.topic || body.topic, 60), Notes: String(r.notes || body.notes || '').trim().slice(0, 1000), Audience: botKbAudStore_(body.audience) };
      values.push(header.map(function (h) { return o.hasOwnProperty(h) ? o[h] : ''; }));
    });
    if (!values.length) return { success: false, message: '沒有可匯入的內容' };
    var start = sheet.getLastRow() + 1;
    ensureRows_(sheet, start + values.length - 1);
    sheet.getRange(start, 1, values.length, header.length).setValues(values);
    return { success: true, count: values.length };
  });
}

/** 刪除知識庫項目：ids = ID 陣列；或 source = 整份文件（同一個來源名稱的全部段落）。 */
function handleBotKbDelete(body) {
  botKbBump_();
  return withLock_(function () {
    var sheet = getSheet(SHEET_BOT_KB);
    var data = sheet.getDataRange().getValues();
    var h = data[0];
    var idCol = h.indexOf('ID');
    var srcCol = h.indexOf('Source');
    var ids = {};
    (body.ids || []).forEach(function (x) { ids[String(x)] = true; });
    var source = body.source ? String(body.source) : '';
    var n = 0;
    var gone = [];
    for (var i = data.length - 1; i >= 1; i--) {
      if (ids[String(data[i][idCol])] || (source && String(data[i][srcCol]) === source)) {
        gone.push(Number(data[i][idCol]));
        sheet.deleteRow(i + 1);
        n++;
      }
    }
    if (gone.length) botVecDelete_(gone);
    return { success: true, deleted: n };
  });
}

/** 產生 / 重新產生某個角色（role = cs 客服 / staff 員工助理）的金鑰；舊版共用金鑰會先拆成兩把再各自更新。 */
function handleBotGenKey(body) {
  var role = body.role === 'staff' ? 'staff' : 'cs';
  var p = PropertiesService.getScriptProperties();
  var legacy = p.getProperty(BOT_SECRET_PROP);
  if (legacy) {
    if (!p.getProperty(BOT_CS_SECRET_PROP)) p.setProperty(BOT_CS_SECRET_PROP, legacy);
    if (!p.getProperty(BOT_STAFF_SECRET_PROP)) p.setProperty(BOT_STAFF_SECRET_PROP, legacy);
    p.deleteProperty(BOT_SECRET_PROP);
  }
  var key = botRandomKey_();
  p.setProperty(role === 'staff' ? BOT_STAFF_SECRET_PROP : BOT_CS_SECRET_PROP, key);
  return { success: true, key: key, keyHint: botKeyHint_(role), role: role };
}

function handleBotRevealKey(body) {
  var s = botKey_(body.role === 'staff' ? 'staff' : 'cs');
  if (!s) return { success: false, message: '還沒有產生這把金鑰' };
  return { success: true, key: s };
}

/** 對話列表：依客人分組（最近 N 筆紀錄），含最後一句、是否小編接手中。 */
function handleBotConversations(body) {
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var groups = {};
  var order = [];
  if (last >= 2) {
    var from = Math.max(2, last - 799);
    sheet.getRange(from, 1, last - from + 1, 8).getValues().forEach(function (r) {
      var id = String(r[3]);
      if (!id) return;
      if (!groups[id]) {
        groups[id] = { id: id, name: '', channel: String(r[2]), count: 0, lastAt: '', lastText: '', lastRole: '', topic: '', sessions: 0, closed: false, inSession: false };
        order.push(id);
      }
      var g = groups[id];
      g.lastAt = String(r[1]);
      if (String(r[5]) === 'reset') {
        // 重新開始 / 關閉聊天室：這一段對話結束（closed = 客人關閉了視窗，目前沒有進行中的對話）
        g.inSession = false;
        g.closed = String(r[6]).indexOf('關閉聊天室') > -1;
        return;
      }
      if (!g.inSession) {
        g.inSession = true;
        g.sessions++;
      }
      g.closed = false;
      g.count++;
      if (r[4]) g.name = String(r[4]);
      g.lastText = String(r[6]).slice(0, 80);
      g.lastRole = String(r[5]);
      if (r[7]) g.topic = String(r[7]);
    });
  }
  var paused = {};
  csPauseList_().forEach(function (p) { paused[p.id] = p; });
  var leads = botLeadMap_();
  var list = order.filter(function (id) { return groups[id].count > 0; }).map(function (id) {
    delete groups[id].inSession;
    return Object.assign(groups[id], { paused: !!paused[id], lead: leads[id] || null });
  });
  list.sort(function (a, b) { return String(b.lastAt).localeCompare(String(a.lastAt)); });
  return { success: true, conversations: list.slice(0, 100), pauses: csPauseList_(), total: Math.max(0, last - 1), max: botGeneral_().logMax };
}

function handleBotThread(body) {
  var id = String(body.userId || '');
  if (!id) return { success: false, message: '缺少客人編號' };
  var sheet = getSheet(SHEET_BOT_MSG);
  var last = sheet.getLastRow();
  var out = [];
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 8).getValues().forEach(function (r) {
      if (String(r[3]) === id) out.push({ id: Number(r[0]), time: String(r[1]), channel: String(r[2]), name: String(r[4]), role: String(r[5]), text: String(r[6]), topic: String(r[7]) });
    });
  }
  return { success: true, messages: out.slice(-150), paused: !!botCache_().get('cspause:' + id), lead: botLeadMap_()[id] || null };
}

/** 小編在後台回覆網站訪客：存成「真人」訊息，訪客視窗輪詢時會看到；LINE 客人請到官方帳號後台回覆。 */
function handleBotHumanReply(body) {
  var id = String(body.userId || '');
  var text = String(body.text || '').trim();
  if (id.charAt(0) !== 'V') return { success: false, message: 'LINE 客人請到 LINE 官方帳號後台（Official Account Manager）回覆；這裡只能回覆網站訪客' };
  if (!text) return { success: false, message: '請輸入回覆內容' };
  botLogTurns_('web', id, '', [{ role: 'human', text: text.slice(0, 1500) }], '');
  // 機器人之後接手時，看得到小編說過什麼
  var m = botGeneral_().memory;
  var list = (botCacheGet_(csHistKey_(id)) || []).concat([{ u: false, t: '（小編）' + text.slice(0, m.chars) }]).slice(-m.turns);
  botCachePut_(csHistKey_(id), list, m.hours * 3600);
  botAlertAck_('csHandoff', id, botAlertWho_(body)); // 有人回覆了 → 這位訪客的右下角提醒停止
  return { success: true };
}

function handleBotResume(body) {
  var id = String(body.userId || '');
  csResume_(id);
  botAlertAck_('csHandoff', id, botAlertWho_(body)); // 按「恢復機器人」= 已經處理
  return { success: true, pauses: csPauseList_() };
}

// ---- 待回覆提醒：每頁右下角持續跳通知，直到有人回覆 / 處理 ----
// 通知來源 = 首頁備忘錄裡的機器人通知（客人找真人 csHandoff、新的聯繫名單 csLead）；備忘錄的 AckAt 有值 = 已經有人處理，不再提醒。
// 網站訪客：小編在「BOT 設定」回覆（botHumanReply）或按「恢復機器人」就自動停止；LINE 客人是在 LINE 官方帳號後台回覆，系統看不到，所以由同事按「我已處理」。
var BOT_ALERT_TYPES = ['csHandoff', 'csLead'];

function botAlertWho_(body) {
  var u = (body && body._user) || {};
  return String(u.displayName || u.username || '');
}

function botAlertsBust_() {
  botCacheRemove_(['botalerts']);
}

/** 還沒有人處理的通知（同一位客人同一種通知只留最新一則）；快取 20 秒，有新通知 / 有人處理時立刻清掉。沒有建立時間的舊通知不提醒，避免上線當天一次跳出一堆。 */
function botAlertsPending_() {
  var cached = botCacheGet_('botalerts');
  if (cached) return cached;
  var latest = {};
  sheetToObjects(SHEET_MEMOS).rows.forEach(function (r) {
    var type = String(r['LinkType'] || '');
    var at = Number(r['CreatedAt']) || 0;
    if (BOT_ALERT_TYPES.indexOf(type) < 0 || r['AckAt'] || !at) return;
    var id = String(r['LinkId'] || '');
    var key = type + ':' + id;
    if (latest[key] && latest[key].at > at) return;
    latest[key] = { type: type, id: id, channel: id.charAt(0) === 'V' ? 'web' : 'line', title: String(r['Title'] || ''), content: String(r['Content'] || '').slice(0, 400), at: at };
  });
  var list = Object.keys(latest).map(function (k) { return latest[k]; }).sort(function (a, b) { return a.at - b.at; }).slice(-30);
  botCachePut_('botalerts', list, 20);
  return list;
}

/** 把某位客人的通知標成「已有人處理」。type 空白 = 全部種類。回傳處理了幾則。 */
function botAlertAck_(type, id, who) {
  if (!id) return 0;
  var n = 0;
  withLock_(function () {
    sheetToObjects(SHEET_MEMOS).rows.forEach(function (r, i) {
      var t = String(r['LinkType'] || '');
      if (BOT_ALERT_TYPES.indexOf(t) < 0 || r['AckAt'] || String(r['LinkId'] || '') !== id || (type && t !== type)) return;
      updateRowFields(SHEET_MEMOS, i + 2, { AckBy: who || '', AckAt: Date.now() });
      n++;
    });
  });
  if (n) botAlertsBust_();
  return n;
}

function botAlertCanAck_(body) {
  var a = accessOf_(findUserRow_(body._user.username));
  return !!(a.isAdmin || a.blocks.bot === 'edit');
}

function handleBotAlerts(body) {
  return { success: true, alerts: botAlertsPending_(), canAck: botAlertCanAck_(body), now: Date.now() };
}

function handleBotAlertAck(body) {
  botAlertAck_(String(body.type || ''), String(body.id || ''), botAlertWho_(body));
  return { success: true, alerts: botAlertsPending_(), canAck: true, now: Date.now() };
}

/** 後台「測試聊天」用：簽一個 5 分鐘有效的權杖給 linebot（用 Bot 金鑰簽，瀏覽器看不到金鑰）。 */
function handleBotTestToken(body) {
  var secret = botKey_('cs');
  if (!secret) return { success: false, message: '請先產生客服機器人的金鑰' };
  var url = botGeneral_().botUrl;
  if (!url) return { success: false, message: '請先填「機器人網址」（Vercel 專案網址）' };
  var ts = String(Date.now());
  var sig = Utilities.computeHmacSha256Signature(ts, secret).map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
  return { success: true, url: url, ts: ts, sig: sig, testId: 'T' + sha256('t:' + body._user.username).slice(0, 32) };
}

/**
 * 清除對話資料（只有系統管理員）：
 *   history 所有客人的短期記憶（最近對話）、pauses 小編接手中全部恢復、memos 首頁「客人找真人」通知（none / done / all，這裡 done = all）、
 *   messages 對話紀錄（all 全部 / 指定客人編號）。先回報筆數（dryRun）再真的清除。
 */
function handleBotClear(body) {
  var opts = body.options || {};
  var result = { messages: 0, memos: 0, pauses: csPauseList_().length };
  var sheet = getSheet(SHEET_BOT_MSG);
  var data = sheet.getDataRange().getValues();
  var target = String(opts.target || '');
  var delRows = [];
  if (opts.messages) {
    for (var i = 1; i < data.length; i++) if (!target || String(data[i][3]) === target) delRows.push(i + 1);
  }
  result.messages = delRows.length;
  var memoSheet = getSheet(SHEET_MEMOS);
  var memoRows = [];
  if (opts.memos) {
    var md = memoSheet.getDataRange().getValues();
    var lt = md[0].indexOf('LinkType');
    var li = md[0].indexOf('LinkId');
    for (var j = 1; j < md.length; j++) if (lt > -1 && md[j][lt] === 'csHandoff' && (!target || String(md[j][li]) === target)) memoRows.push(j + 1);
  }
  result.memos = memoRows.length;
  if (body.dryRun) return { success: true, dryRun: true, counts: result };
  return withLock_(function () {
    for (var a = delRows.length - 1; a >= 0; a--) sheet.deleteRow(delRows[a]);
    for (var b = memoRows.length - 1; b >= 0; b--) memoSheet.deleteRow(memoRows[b]);
    if (memoRows.length) botAlertsBust_();
    if (opts.history) {
      if (target) botCacheRemove_([csHistKey_(target)]);
      else PropertiesService.getScriptProperties().setProperty(BOT_GEN_PROP, String(botHistGen_() + 1));
    }
    if (opts.pauses) {
      if (target) csResume_(target);
      else {
        csPauseList_().forEach(function (p) { csResume_(p.id); });
      }
    }
    return { success: true, counts: result };
  });
}

/** setup 時順便做的事：BotConfig 預設的公司名稱。 */
function botSetup_(log) {
  var g = botCfg_('general', null);
  if (!g) {
    botCfgSet_('general', { replyDelay: 2, botUrl: '', brand: '鑫堡股份有限公司' });
    if (log) log.push('BOT 設定：已建立預設設定（請到「BOT 設定」頁完成 AI、知識庫與 LINE 設定）');
  }
}

// ============================================================
// ===== 以下來自 BotStaff.gs =====
// ============================================================
/**
 * ============================================================
 * BotStaff.gs - BOT 設定：員工助理（選用模組，需要 Bot.gs 一起貼上）
 * ------------------------------------------------------------
 * 員工在 LINE（員工助理官方帳號）或網站右下角的「智能助理」用聊天查資料、交代事情：
 *   「今天要追蹤哪些客戶？」「甲公司的聯絡人電話」「進行中的案件」「記一筆：今天電話聯繫乙公司，下週三再追蹤」
 * - 員工加官方帳號好友 → BotMembers 新增一列（待開通、沒有任何權限），首頁備忘錄通知有「BOT 設定」權限的人；
 *   在「BOT 設定 → 員工助理」開通並設定權限（跟網站帳號同一套：編輯者 / 查看 / 特定各功能區塊查看或編輯），可綁定網站帳號。
 * - 查詢只能用 BOT_STAFF_CALLS 這些動作，資料依這個人的權限過濾；
 *   新增 / 修改只能用 BOT_STAFF_WRITES 這些（白名單），AI 只能「提出」→ 暫存 15 分鐘 → 本人按「確認」才寫入；不能刪除。
 * - 網站智能助理（右下角）：同一個機器人，用登入帳號本人的權限（W 開頭的暫時編號，登入驗證過的 10 分鐘內有效）。
 * ============================================================
 */

var SHEET_BOT_MEMBERS = 'BotMembers';
var SHEET_BOT_MEMORY = 'BotMemory';
var SHEET_BOT_CARDS = 'BotCards';

var BOT_STAFF_CALLS = ['me', 'overview', 'customers', 'customer', 'followups', 'cases', 'case', 'products', 'product', 'priceHistory', 'inquiryDraft', 'logs', 'memos', 'calendar', 'todos', 'calcCatalog', 'kbChunks', 'kbVectors', 'copyPosts', 'copyStyle', 'cards'];
var BOT_STAFF_STATUS = { PENDING: '待開通', ACTIVE: '已開通', OFF: '停用' };
var BOT_PENDING_SECONDS = 900;
var BOT_CASE_STATUSES = ['需求單已發出', '評估單已發出', '已結案'];
var BOT_MEMORY_CATEGORIES = ['稱呼與職務', '負責的工作', '工作習慣', '回覆偏好', '客戶與專案', '產品與規格', '公司規定', '其他'];

function botStaffSchema_() {
  return {
    schema: {
      BotMembers: ['LineUserId', 'DisplayName', 'PictureUrl', 'Status', 'Role', 'Perms', 'LinkedUsername', 'Note', 'PushDaily', 'IsFollowing', 'FollowedAt', 'LastSeenAt', 'ApprovedBy', 'ApprovedAt'],
      BotMemory: ['ID', 'Scope', 'Owner', 'Category', 'Content', 'Importance', 'UpdatedAt'],
      BotCards: ['ID', 'Owner', 'Time', 'Status', 'Batch', 'Name', 'Title', 'Company', 'Phone', 'CompanyPhone', 'Fax', 'Email', 'Address', 'TaxId', 'Website', 'Note', 'Confidence', 'Result'],
    },
    text: { BotMembers: ['LineUserId'], BotMemory: ['Owner'], BotCards: ['Owner', 'Time', 'Phone', 'CompanyPhone', 'Fax', 'TaxId'] },
  };
}

function botStaffPerms_() {
  return {
    botGetStaff: ['bot', 'r'], botMemoryList: ['bot', 'r'],
    botSaveStaff: ['bot', 'w'], botMemberSave: ['bot', 'w'], botMemorySave: ['bot', 'w'], botPushNow: ['bot', 'w'],
    botMemberRemove: ['bot', 'd'], botMemoryDelete: ['bot', 'd'],
    botAssistInfo: ['*', 'r'], botAssist: ['*', 'w'],
  };
}

function botStaffRoutes_() {
  return {
    botGetStaff: { auth: true, fn: handleBotGetStaff },
    botSaveStaff: { auth: true, fn: handleBotSaveStaff },
    botMemberSave: { auth: true, fn: handleBotMemberSave },
    botMemberRemove: { auth: true, fn: handleBotMemberRemove },
    botMemorySave: { auth: true, fn: handleBotMemorySave },
    botMemoryDelete: { auth: true, fn: handleBotMemoryDelete },
    botPushNow: { auth: true, fn: handleBotPushNow },
    botAssistInfo: { auth: true, fn: handleBotAssistInfo },
    botAssist: { auth: true, fn: handleBotAssist },
  };
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------
function botStaffCfg_() {
  var c = botCfg_('staff', {}) || {};
  var m = c.memory || {};
  var push = c.push || {};
  return {
    enabled: c.enabled === true,
    welcome: String(c.welcome || ''),
    pendingText: String(c.pendingText || ''),
    prompt: String(c.prompt || ''),
    webEnabled: c.webEnabled !== false,
    push: { enabled: push.enabled === true, hour: botInt_(push.hour, 0, 23, 8), last: String(push.last || '') },
    // 助理能存取資料的上限：實際權限 = 成員（帳號）權限與這裡的上限取較小者
    ceiling: botStaffCeiling_(c.ceiling),
    // 助理可以提出的寫入動作（沒設定 = 全部）
    writes: botStaffWrites_(c.writes),
    // 助理永遠看不到產品底價與供應商（就算成員有產品權限）
    hidePrice: c.hidePrice === true,
    // 助理做的事都記在備忘錄（只有有「BOT 設定」權限的人看得到，只有系統管理員能改 / 刪）
    audit: { enabled: (c.audit || {}).enabled !== false, reads: (c.audit || {}).reads !== false },
    memory: {
      enabled: m.enabled !== false,
      maxItems: botInt_(m.maxItems, 5, 100, 30),
      confirm: m.confirm !== false, // 在 LINE 說「記住」要先按確認
      canShared: m.canShared === true, // 一般員工也可以新增 / 修改全公司的記憶
      auto: m.auto === true,
      autoEvery: botInt_(m.autoEvery, 2, 30, 6),
    },
  };
}

var BOT_STAFF_CEILING_BLOCKS = ['products', 'cases', 'customers'];

function botStaffCeiling_(c) {
  c = c || {};
  var out = {};
  BOT_STAFF_CEILING_BLOCKS.forEach(function (b) {
    out[b] = c[b] === 'none' || c[b] === 'view' ? c[b] : 'edit';
  });
  return out;
}

function botStaffWrites_(list) {
  var all = Object.keys(BOT_STAFF_WRITES);
  if (!Array.isArray(list)) return all;
  return all.filter(function (k) { return list.indexOf(k) > -1; });
}

/** 把帳號權限壓到管理員設定的上限以下（none < view < edit）。 */
function botCapAccess_(access) {
  var rank = { none: 0, view: 1, edit: 2 };
  var ceiling = botStaffCfg_().ceiling;
  BOT_STAFF_CEILING_BLOCKS.forEach(function (b) {
    if ((rank[access.blocks[b]] || 0) > rank[ceiling[b]]) access.blocks[b] = ceiling[b];
  });
  return access;
}

// ------------------------------------------------------------
// 成員與權限
// ------------------------------------------------------------
function botWebId_(username) {
  return 'W' + sha256('web:' + username).slice(0, 32);
}

function botMemberRows_() {
  return sheetToObjects(SHEET_BOT_MEMBERS).rows.map(function (r, i) {
    return Object.assign({ RowIndex: i + 2 }, r);
  });
}

function botMemberFind_(id) {
  var rows = botMemberRows_();
  for (var i = 0; i < rows.length; i++) if (String(rows[i]['LineUserId']) === id) return rows[i];
  return null;
}

/** 成員的權限（等級同網站帳號）：editor / viewer / limited；機器人沒有刪除功能，所以沒有系統管理員。 */
function botMemberAccess_(m, linkedUser) {
  var role = String(m['Role'] || '');
  if (role === 'admin') role = 'editor';
  if (role !== 'editor' && role !== 'viewer' && role !== 'limited') role = 'viewer';
  var a = accessOf_({ Role: role, Perms: m['Perms'] });
  a.canDelete = !!(linkedUser && accessOf_(linkedUser).canDelete); // 刪除只有「綁定的網站帳號本來就能刪除」的人（系統管理員）；沒綁定帳號就不能刪
  a.isAdmin = false;
  return botCapAccess_(a);
}

/** 這個編號（U 開頭 = LINE 成員；W 開頭 = 網站登入帳號）能做什麼；ok = 已開通可以用。 */
function botStaffCtx_(id) {
  var cfg = botStaffCfg_();
  if (id.charAt(0) === 'W') {
    var uname = botCacheGet_('webid:' + id);
    var u = uname ? findUserRow_(uname) : null;
    if (!u) return { ok: false, status: '未登入', problem: '網站登入已逾期，請重新整理頁面再試', id: id, web: true };
    var a = botCapAccess_(accessOf_(u));
    a.canDelete = !!accessOf_(u).canDelete;
    a.isAdmin = false;
    return { ok: cfg.enabled && cfg.webEnabled, status: '已開通', problem: !cfg.enabled ? '員工助理還沒啟用' : !cfg.webEnabled ? '網站智能助理沒有開放' : '', id: id, web: true, name: String(u['DisplayName'] || u['Username']), username: String(u['Username']), access: a, ownerKey: String(u['Username']) };
  }
  var m = botMemberFind_(id);
  if (!m) return { ok: false, status: '未登記', problem: '', id: id, web: false };
  var linked = String(m['LinkedUsername'] || '');
  var lu = linked ? findUserRow_(linked) : null;
  var access = botMemberAccess_(m, lu);
  return {
    ok: cfg.enabled && m['Status'] === BOT_STAFF_STATUS.ACTIVE,
    status: String(m['Status'] || BOT_STAFF_STATUS.PENDING),
    problem: !cfg.enabled ? '員工助理還沒啟用' : '',
    id: id,
    web: false,
    name: String(m['DisplayName'] || (lu && lu['DisplayName']) || ''),
    username: lu ? String(lu['Username']) : '',
    access: access,
    ownerKey: lu ? String(lu['Username']) : id,
    member: m,
  };
}

function botLevel_(ctx, block) {
  return (ctx.access && ctx.access.blocks[block]) || 'none';
}

function botNeed_(ctx, block, level) {
  var lv = botLevel_(ctx, block);
  var label = (PERM_BLOCKS.filter(function (b) { return b.key === block; })[0] || {}).label || block;
  label = label.replace(/（.*$/, '');
  if (lv === 'none' || (level === 'edit' && lv !== 'edit')) throw new Error(level === 'edit' ? '你沒有「' + label + '」的編輯權限' : '你沒有「' + label + '」的查看權限');
}

/** 員工在 LINE 加好友 / 傳訊息：登記成員（待開通），第一次出現時用備忘錄通知有「BOT 設定」權限的人。 */
function botMemberTouch_(id, profile) {
  var m = botMemberFind_(id);
  var now = botNow_();
  if (m) {
    var patch = {};
    if (profile.displayName && profile.displayName !== m['DisplayName']) patch.DisplayName = botClip_(profile.displayName, 60);
    if (profile.pictureUrl && profile.pictureUrl !== m['PictureUrl']) patch.PictureUrl = String(profile.pictureUrl).slice(0, 300);
    var last = String(m['LastSeenAt'] || '');
    // 最後使用時間約 10 分鐘更新一次，避免每則訊息都寫試算表
    if (!last || Date.now() - new Date(last.replace(' ', 'T') + '+08:00').getTime() > 600000) patch.LastSeenAt = now;
    if (m['IsFollowing'] === false) patch.IsFollowing = true;
    if (Object.keys(patch).length) updateRowFields(SHEET_BOT_MEMBERS, m.RowIndex, patch);
    return { row: m, isNew: false };
  }
  appendObjectRow(SHEET_BOT_MEMBERS, { LineUserId: id, DisplayName: botClip_(profile.displayName, 60), PictureUrl: String(profile.pictureUrl || '').slice(0, 300), Status: BOT_STAFF_STATUS.PENDING, Role: 'viewer', Perms: '', LinkedUsername: '', Note: '', PushDaily: false, IsFollowing: true, FollowedAt: now, LastSeenAt: now });
  var today = todayStr();
  appendObjectRow(SHEET_MEMOS, {
    Owner: 'SYSTEM',
    OwnerName: '員工助理',
    Title: '🤖 新的 LINE 員工助理成員等待開通：' + (profile.displayName || id.slice(0, 8)),
    Content: '有人加了員工助理官方帳號（' + (profile.displayName || '名稱未知') + '）。到「BOT 設定 → 員工助理」確認是同事後開通並設定權限；不認識的人設為「停用」或移除。',
    Shared: '是',
    CreatedDate: today,
    LastUpdated: today,
    LinkType: 'botMember',
    LinkId: id,
    NeedBlock: 'bot',
  });
  return { row: botMemberFind_(id), isNew: true };
}

// ------------------------------------------------------------
// 短期記憶 / 待確認
// ------------------------------------------------------------
function botStaffHistKey_(id) {
  var gen = botHistGen_();
  return 'lineh:' + (gen ? gen + ':' : '') + id;
}

function botStaffRemember_(id, turns) {
  var m = botGeneral_().memory;
  var add = (Array.isArray(turns) ? turns : [])
    .map(function (x) { return { u: !!(x && x.u === true), t: String((x && x.t) || '').trim().slice(0, m.chars) }; })
    .filter(function (x) { return x.t; });
  var list = (botCacheGet_(botStaffHistKey_(id)) || []).concat(add).slice(-m.turns);
  botCachePut_(botStaffHistKey_(id), list, m.hours * 3600);
  return list.length;
}

function botPendingGet_(id) {
  var p = botCacheGet_('linep:' + id);
  return p && p.ops ? p : null;
}

// ------------------------------------------------------------
// 給 linebot 的操作（Bot 金鑰）
// ------------------------------------------------------------
var BOT_AUDIT_ICON = { read: '🔎', stage: '📝', write: '✅', delete: '🗑️', cancel: '↩️', denied: '⛔', info: '•' };
var BOT_AUDIT_MAX = 40000;
var BOT_AUDIT_SKIP = ['me', 'kbChunks', 'kbVectors', 'calcCatalog'];
var BOT_AUDIT_LABEL = { customers: '客戶', customer: '客戶詳情', followups: '追蹤清單', cases: '案件', 'case': '案件詳情', products: '產品', product: '產品詳情', priceHistory: '報價紀錄', inquiryDraft: '詢價信草稿', logs: '聯繫紀錄', memos: '備忘錄', calendar: '行事曆', todos: '工作清單', overview: '今日總覽', copyPosts: '文案', copyStyle: '文案風格', cards: '名片收件匣' };

/**
 * 助理做的任何事，都記在「備忘錄」讓有「BOT 設定」權限的人檢查：每位成員每天一則（時間先後、持續追加）。
 * 查詢、提出修改、確認寫入、刪除、取消、被擋下的都記；只有系統管理員能改 / 刪這些備忘錄。記錄失敗不影響助理。
 */
function botAudit_(ctx, kind, line) {
  try {
    var cfg = botStaffCfg_().audit;
    if (!cfg.enabled || (kind === 'read' && !cfg.reads)) return;
    var key = String(ctx.ownerKey || ctx.id || '');
    if (!key) return;
    var today = todayStr();
    var linkId = key + '|' + today;
    var who = (ctx.name || key.slice(0, 8)) + (ctx.username && ctx.username !== ctx.name ? '／' + ctx.username : '');
    var entry = botNow_().slice(11, 16) + ' ' + (BOT_AUDIT_ICON[kind] || '•') + ' ' + String(line || '').replace(/\s+/g, ' ').slice(0, 400);
    var rows = sheetToObjects(SHEET_MEMOS).rows;
    var found = 0;
    rows.forEach(function (r, i) { if (r['LinkType'] === 'staffAudit' && r['LinkId'] === linkId) found = i + 2; });
    if (found) {
      var old = String(rows[found - 2]['Content'] || '');
      if (old.length + entry.length + 1 < BOT_AUDIT_MAX) {
        updateRowFields(SHEET_MEMOS, found, { Content: old + '\n' + entry, LastUpdated: today });
        return;
      }
      linkId = linkId + '#' + (rows.filter(function (r) { return r['LinkType'] === 'staffAudit' && String(r['LinkId']).indexOf(key + '|' + today) === 0; }).length + 1);
    }
    appendObjectRow(SHEET_MEMOS, {
      Owner: 'SYSTEM',
      OwnerName: '員工助理',
      Title: '🤖 助理紀錄 ' + today + '｜' + who + (ctx.web ? '（網站）' : '（LINE）') + (found ? '（續）' : ''),
      Content: entry,
      Shared: '是',
      CreatedDate: today,
      LastUpdated: today,
      LinkType: 'staffAudit',
      LinkId: linkId,
      NeedBlock: 'bot',
    });
  } catch (e) {
    Logger.log('助理紀錄失敗：' + e.message);
  }
}

function botAuditParams_(params) {
  var out = [];
  Object.keys(params || {}).forEach(function (k) {
    var v = params[k];
    if (k === 'limit' || v === '' || v == null || typeof v === 'object') return;
    out.push(k + '=' + String(v).slice(0, 40));
  });
  return out.join('、').slice(0, 120);
}

function botStaffOp_(op, id, body) {
  if (id.charAt(0) !== 'U' && id.charAt(0) !== 'W') throw new Error('使用者編號格式錯誤');
  if (op === 'start') return botStaffStart_(id, body);
  if (op === 'call') return botStaffCall_(botStaffCtx_(id), String(body.call || ''), body.params || {});
  if (op === 'stage') {
    var sctx = botStaffCtx_(id);
    try {
      var staged = botStage_(id, body);
      botAudit_(sctx, 'stage', '提出修改，等本人確認：' + String(staged.summary).replace(/\n/g, '；'));
      return staged;
    } catch (e) {
      botAudit_(sctx, 'denied', '提出修改被擋：' + e.message);
      throw e;
    }
  }
  if (op === 'commit') return botCommit_(id, body);
  if (op === 'cancel') {
    var hadPending = botPendingGet_(id);
    botCacheRemove_(['linep:' + id]);
    if (hadPending) botAudit_(botStaffCtx_(id), 'cancel', '取消待確認的修改：' + String(hadPending.summary).replace(/\n/g, '；'));
    return true;
  }
  if (op === 'audit') return botStaffAuditOp_(id, body);
  if (op === 'cards') return botStaffCardsOp_(id, body);
  if (op === 'remember') return botStaffRemember_(id, body.turns);
  if (op === 'forget') {
    botCacheRemove_([botStaffHistKey_(id)]);
    return true;
  }
  if (op === 'unfollow') {
    var m = id.charAt(0) === 'U' ? botMemberFind_(id) : null;
    if (m) updateRowFields(SHEET_BOT_MEMBERS, m.RowIndex, { IsFollowing: false });
    return true;
  }
  if (op === 'memory') {
    var ctx = botStaffCtx_(id);
    if (!botStaffCfg_().memory.enabled) throw new Error('長期記憶沒有開啟');
    var mres = withLock_(function () { return botMemoryWrite_(ctx, body.data || {}); });
    var md = body.data || {};
    botAudit_(ctx, md.mode === 'delete' ? 'delete' : 'write', '長期記憶 ' + (md.mode === 'delete' ? '刪除 #' + md.id : '新增 / 修改：' + String(md.content || '').slice(0, 80)));
    return mres;
  }
  throw new Error('未知的 Bot 操作：' + op);
}

/** 機器人伺服器回報它自己做的事（例如搜尋知識庫、選型計算），記進助理紀錄。 */
function botStaffAuditOp_(id, body) {
  var ctx = botStaffCtx_(id);
  if (!ctx.ok) return false;
  var kind = ['read', 'write', 'info'].indexOf(body.kind) > -1 ? body.kind : 'info';
  botAudit_(ctx, kind, String(body.text || '').slice(0, 300));
  return true;
}

function botStaffStart_(id, body) {
  var cfg = botStaffCfg_();
  var prof = { displayName: botClip_(body.displayName, 60), pictureUrl: String(body.pictureUrl || '') };
  var isNew = false;
  if (id.charAt(0) === 'U') isNew = botMemberTouch_(id, prof).isNew;
  var ctx = botStaffCtx_(id);
  var ais = botAiList_('staff');
  var base = {
    status: ctx.status,
    allowed: !!ctx.ok,
    problem: ctx.problem || '',
    isNew: isNew,
    name: ctx.name || prof.displayName || '',
    appName: csBrand_(),
    channel: id.charAt(0) === 'W' ? 'web' : 'line',
    replyDelay: botGeneral_().replyDelay,
    texts: {
      welcome: cfg.welcome || '👋 您好，我是' + csBrand_() + '的員工助理。',
      pending: cfg.pendingText || '👋 您好！你的帳號還在等待管理員開通，開通後就可以用我查詢客戶、案件與行程囉。',
    },
  };
  if (!ctx.ok) return base;
  var blocks = ctx.access.blocks;
  var mem = cfg.memory;
  var pending = botPendingGet_(id);
  return Object.assign(base, {
    userId: id,
    linked: !!ctx.username,
    username: ctx.username || '',
    blocks: blocks,
    prompt: cfg.prompt,
    ai: ais.length ? ais[0] : null,
    aiFallback: ais.slice(1),
    search: botSearchCfg_(),
    embedAi: botEmbedCfg_(),
    kbVer: botKbVer_(),
    history: botCacheGet_(botStaffHistKey_(id)) || [],
    writable: botWritableOps_(ctx),
    pending: pending ? pending.summary : '',
    today: todayStr(),
    memory: {
      enabled: mem.enabled,
      maxItems: mem.maxItems,
      confirm: mem.confirm,
      canShared: mem.canShared || blocksCanShare_(ctx),
      categories: BOT_MEMORY_CATEGORIES,
      items: mem.enabled ? botMemoryFor_(ctx) : [],
    },
  });
}

function blocksCanShare_(ctx) {
  return botLevel_(ctx, 'bot') === 'edit';
}

// ------------------------------------------------------------
// 查詢（依權限過濾）
// ------------------------------------------------------------
function botTrimRow_(obj, keys, noteLimit) {
  var out = {};
  keys.forEach(function (k) {
    var v = obj[k];
    if (v === '' || v === null || v === undefined) return;
    out[k] = typeof v === 'string' && v.length > noteLimit ? v.slice(0, noteLimit) + '…' : v;
  });
  return out;
}

var BOT_CUSTOMER_KEYS = ['CompanyName', 'Contact', 'Phone', 'CompanyPhone', 'Email', 'Address', 'TaxId', 'Website', 'Category', 'Urgency', 'NextFollowUpDate', 'NextFollowUpTime', 'NextFollowUpNote', 'Notes', 'HasTransacted', 'LastTransactionDate'];
var BOT_CASE_KEYS = ['CaseID', 'CustomerName', 'EndCustomerName', 'ProjectContact', 'ContactPhone', 'Status', 'Urgency', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'SoftwareName', 'CreatedDate', 'RequirementDetails', 'EvaluationResult'];
var BOT_PRODUCT_KEYS = ['InternalModel', 'SupplierModel', 'Brand', 'Category', 'Interface', 'Resolution', 'PixelSize', 'SensorSize', 'FPS', 'Mount', 'FocalLength', 'Magnification', 'WD', 'DOF', 'FocusWD', 'EffectivePixels', 'Notes'];

/** 用內部型號（不分大小寫）或供應商型號找產品；找不到回傳 near（名稱相近的）。 */
function botFindProduct_(model) {
  var key = String(model || '').trim().toLowerCase();
  var rows = readProductsLite_().rows;
  var found = null;
  var idx = 0;
  if (key) {
    for (var i = 0; i < rows.length && !found; i++) if (String(rows[i]['InternalModel']).trim().toLowerCase() === key) { found = rows[i]; idx = i + 2; }
    for (var j = 0; j < rows.length && !found; j++) if (String(rows[j]['SupplierModel']).trim().toLowerCase() === key) { found = rows[j]; idx = j + 2; }
  }
  var near = [];
  if (!found && key) near = rows.filter(function (r) { return String(r['InternalModel'] + ' ' + r['SupplierModel']).toLowerCase().indexOf(key) > -1; }).slice(0, 5).map(function (r) { return r['InternalModel'] || r['SupplierModel']; });
  return { obj: found, row: idx, near: near };
}

/** 用日期 + 價格找出唯一一筆報價紀錄（刪除用）；找不到或有好幾筆都丟錯誤。 */
function botPriceMatch_(model, date, price) {
  var pf = botFindProduct_(model);
  var m = pf.obj ? pf.obj['InternalModel'] : String(model || '').trim();
  if (!pf.obj) throw new Error('找不到產品「' + m + '」' + (pf.near.length ? '，你是不是要找：' + pf.near.join('、') : ''));
  if (!isDateStr(String(date || ''))) throw new Error('要刪哪一筆報價？請提供日期（YYYY-MM-DD）與價格，先用 price_history 查');
  var num = Number(String(price == null ? '' : price).replace(/,/g, ''));
  var hits = (handleGetPriceHistory({ internalModel: m }).history || []).filter(function (h) { return dateKey_(h['Date']) === date && Number(h['Price']) === num; });
  if (!hits.length) throw new Error('找不到 ' + date + ' 價格 ' + price + ' 的報價紀錄');
  if (hits.length > 1) throw new Error('同一天同樣價格有 ' + hits.length + ' 筆報價紀錄，無法確定要刪哪一筆，請到網站刪除');
  return { model: m, row: hits[0] };
}

/** 自己的備忘錄（助理只能刪自己建立的一般備忘錄；機器人通知與助理紀錄不行）。 */
function botMemoOwn_(ctx, rowIndex, title) {
  var rowNum = Number(rowIndex);
  var sheet = getSheet(SHEET_MEMOS);
  if (!(rowNum >= 2 && rowNum <= sheet.getLastRow())) throw new Error('找不到這則備忘錄（可能已被刪除），請用 list_memos 重新查');
  var memo = readRowAsObject(SHEET_MEMOS, rowNum);
  if (String(memo['Owner']) !== ctx.username) throw new Error('這不是你的備忘錄，只有擁有者可以刪除');
  if (memo['LinkType']) throw new Error('這是系統通知 / 助理紀錄，不能用助理刪除');
  if (String(title || '').trim() && String(memo['Title'] || '').trim() !== String(title).trim()) throw new Error('備忘錄的標題對不上（列號可能已經變動），請用 list_memos 重新查');
  return memo;
}

function botPriceOut_(h) {
  return { Date: dateKey_(h['Date']) || String(h['Date'] || ''), Supplier: h['Supplier'], Price: h['Price'], Currency: h['Currency'] || 'TWD', CaseID: h['CaseID'] || undefined, Notes: h['Notes'] ? String(h['Notes']).slice(0, 100) : undefined };
}

function botMatch_(row, fields, kws) {
  var hay = fields.map(function (f) { return String(row[f] || ''); }).join(' ').toLowerCase().replace(/\s+/g, '');
  return kws.every(function (k) { return hay.indexOf(k) > -1; });
}

function botKws_(keyword) {
  return String(keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** 查詢（記錄在助理紀錄備忘錄）。 */
function botStaffCall_(ctx, action, params) {
  var skip = BOT_AUDIT_SKIP.indexOf(action) > -1 || !ctx.ok;
  var out;
  try {
    out = botStaffCallRun_(ctx, action, params);
  } catch (e) {
    if (!skip) botAudit_(ctx, 'denied', '查詢「' + (BOT_AUDIT_LABEL[action] || action) + '」被擋 / 失敗：' + e.message);
    throw e;
  }
  if (!skip) {
    var n = out && typeof out.total === 'number' ? '，共 ' + out.total + ' 筆' : '';
    botAudit_(ctx, 'read', '查詢 ' + (BOT_AUDIT_LABEL[action] || action) + (botAuditParams_(params) ? '（' + botAuditParams_(params) + '）' : '') + n);
  }
  return out;
}

function botStaffCallRun_(ctx, action, params) {
  if (BOT_STAFF_CALLS.indexOf(action) < 0) throw new Error('員工助理不能使用：' + action);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  var limit = botInt_(params.limit, 1, 30, 10);
  var today = todayStr();

  if (action === 'me') return { name: ctx.name, username: ctx.username, role: ctx.access.roleLabel, blocks: ctx.access.blocks, today: today };

  if (action === 'customers') {
    botNeed_(ctx, 'customers', 'view');
    var kws = botKws_(params.keyword);
    var rows = sheetToObjects(SHEET_CUSTOMERS).rows.filter(function (r) { return !kws.length || botMatch_(r, ['CompanyName', 'Contact', 'Phone', 'CompanyPhone', 'Email', 'Address', 'TaxId', 'Notes'], kws); });
    return { total: rows.length, items: rows.slice(0, limit).map(function (r) { var o = botTrimRow_(r, BOT_CUSTOMER_KEYS, 200); o.NextFollowUpTime = normTimeStr_(r['NextFollowUpTime']) || undefined; return o; }) };
  }

  if (action === 'customer') {
    botNeed_(ctx, 'customers', 'view');
    var name = String(params.companyName || '').trim();
    var key = normCompanyName_(name);
    var found = null;
    sheetToObjects(SHEET_CUSTOMERS).rows.forEach(function (r) {
      if (!found && normCompanyName_(r['CompanyName']) === key) found = r;
    });
    if (!found) {
      var near = sheetToObjects(SHEET_CUSTOMERS).rows.filter(function (r) { return normCompanyName_(r['CompanyName']).indexOf(key) > -1; }).slice(0, 5).map(function (r) { return r['CompanyName']; });
      throw new Error('找不到客戶「' + name + '」' + (near.length ? '，你是不是要找：' + near.join('、') : ''));
    }
    var cname = String(found['CompanyName']);
    var out = { customer: botTrimRow_(found, BOT_CUSTOMER_KEYS, 600) };
    out.contacts = sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.filter(function (r) { return String(r['CompanyName']) === cname; }).map(function (r) { return botTrimRow_(r, ['ContactName', 'Title', 'Phone', 'Email', 'Notes'], 100); });
    out.logs = sheetToObjects(SHEET_CONTACT_LOGS).rows
      .filter(function (r) { return String(r['CompanyName']) === cname; })
      .map(function (r) { return { Date: dateKey_(r['Date']), Method: r['Method'], Contact: r['Contact'], Summary: String(r['Summary'] || '').slice(0, 200), Changes: String(r['Changes'] || '').slice(0, 150) }; })
      .slice(-5)
      .reverse();
    if (botLevel_(ctx, 'cases') !== 'none') out.cases = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return String(r['CustomerName']) === cname; }).slice(0, 10).map(function (r) { return botTrimRow_(r, ['CaseID', 'Status', 'Urgency', 'ProductApplication', 'CreatedDate'], 80); });
    return out;
  }

  if (action === 'followups') {
    botNeed_(ctx, 'customers', 'view');
    var days = botInt_(params.days, 0, 60, 0);
    var until = addDaysStr(today, days);
    var list = sheetToObjects(SHEET_CUSTOMERS).rows
      .map(function (r) { return { r: r, d: dateKey_(r['NextFollowUpDate']) }; })
      .filter(function (x) { return x.d && x.d <= until; })
      .sort(function (a, b) { return a.d.localeCompare(b.d) || normTimeStr_(a.r['NextFollowUpTime']).localeCompare(normTimeStr_(b.r['NextFollowUpTime'])); });
    return {
      today: today,
      total: list.length,
      items: list.slice(0, limit * 2).map(function (x) {
        var o = botTrimRow_(x.r, ['CompanyName', 'Contact', 'Phone', 'Urgency', 'NextFollowUpNote'], 200);
        o.NextFollowUpDate = x.d;
        var t = normTimeStr_(x.r['NextFollowUpTime']);
        if (t) o.NextFollowUpTime = t;
        o.status = x.d < today ? '已逾期' : x.d === today ? '今天' : '之後';
        return o;
      }),
    };
  }

  if (action === 'cases') {
    botNeed_(ctx, 'cases', 'view');
    var ckws = botKws_(params.keyword);
    var status = String(params.status || '');
    var crows = sheetToObjects(SHEET_CASES).rows.filter(function (r) {
      if (status === '進行中' ? r['Status'] === '已結案' : status && r['Status'] !== status) return false;
      return !ckws.length || botMatch_(r, ['CaseID', 'CustomerName', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject'], ckws);
    });
    return { total: crows.length, items: crows.slice(0, limit).map(function (r) { return botTrimRow_(r, ['CaseID', 'CustomerName', 'Status', 'Urgency', 'Salesperson', 'FAE', 'ProductApplication', 'TestObject', 'CreatedDate'], 80); }) };
  }

  if (action === 'case') {
    botNeed_(ctx, 'cases', 'view');
    var cid = String(params.caseId || '').trim();
    var c = findCase(cid);
    if (!c) {
      var like = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return String(r['CaseID']).toLowerCase().indexOf(cid.toLowerCase()) > -1; }).slice(0, 5).map(function (r) { return r['CaseID']; });
      throw new Error('找不到案件「' + cid + '」' + (like.length ? '，你是不是要找：' + like.join('、') : ''));
    }
    var co = botTrimRow_(c, BOT_CASE_KEYS, 600);
    co.CCD = getCcdRequirementsForCase(String(c['CaseID'])).map(function (x) { return botTrimRow_(x, ['CcdIndex', 'Description', 'FovLengthMm', 'FovWidthMm', 'WdMm', 'AccuracyUm', 'FlyingSpeedMmS', 'InspectionSpeedPs', 'LightingNote'], 120); });
    return co;
  }

  if (action === 'products') {
    botNeed_(ctx, 'products', 'view');
    var pkws = botKws_(params.keyword);
    var prows = readProductsLite_().rows.filter(function (r) { return !pkws.length || botMatch_(r, ['InternalModel', 'SupplierModel', 'Brand', 'Category', 'Supplier', 'Notes'], pkws); });
    return {
      total: prows.length,
      items: prows.slice(0, Math.min(limit, 15)).map(function (r) {
        var o = botTrimRow_(r, BOT_PRODUCT_KEYS, 120);
        if (!botStaffCfg_().hidePrice) {
          o.Supplier = r['Supplier'] || undefined;
          o.RefPrice = r['RefPrice'] || undefined; // 底價：有「產品與詢價」查看權限的人才看得到（跟網站一樣），管理員也可以全部隱藏
        }
        return o;
      }),
    };
  }

  if (action === 'calcCatalog') {
    botNeed_(ctx, 'products', 'view');
    return botCalcCatalog_(null);
  }

  if (action === 'product') {
    botNeed_(ctx, 'products', 'view');
    var pf = botFindProduct_(params.internalModel);
    if (!pf.obj) throw new Error('找不到產品「' + String(params.internalModel || '').trim() + '」' + (pf.near.length ? '，你是不是要找：' + pf.near.join('、') : ''));
    var hide = botStaffCfg_().hidePrice;
    var po = botTrimRow_(pf.obj, BOT_PRODUCT_KEYS.concat(['CompatibleGroup', 'Origin']), 300);
    if (!hide) {
      ['Supplier', 'SupplierContact', 'SupplierContactEmail', 'RefPrice'].forEach(function (k) { if (pf.obj[k] !== '' && pf.obj[k] != null) po[k] = pf.obj[k]; }); // 供應商與底價：跟網站一樣有「產品與詢價」查看權限才看得到
    }
    var pout = { product: po };
    var grp = String(pf.obj['CompatibleGroup'] || '');
    if (grp) pout.compatible = readProductsLite_().rows.filter(function (r) { return r['CompatibleGroup'] === grp && r['InternalModel'] !== pf.obj['InternalModel']; }).slice(0, 10).map(function (r) { return botTrimRow_(r, ['InternalModel', 'SupplierModel', 'Brand', 'Category'], 80); });
    if (!hide) {
      var hist = handleGetPriceHistory({ internalModel: pf.obj['InternalModel'] }).history || [];
      pout.priceCount = hist.length;
      pout.priceHistory = hist.slice(0, 5).map(botPriceOut_);
    }
    return pout;
  }

  if (action === 'priceHistory') {
    botNeed_(ctx, 'products', 'view');
    if (botStaffCfg_().hidePrice) throw new Error('管理員設定助理不顯示價格與供應商資料');
    var ph = botFindProduct_(params.internalModel);
    var phm = ph.obj ? ph.obj['InternalModel'] : String(params.internalModel || '').trim();
    var phist = handleGetPriceHistory({ internalModel: phm }).history || [];
    if (!ph.obj && !phist.length) throw new Error('找不到產品「' + phm + '」' + (ph.near.length ? '，你是不是要找：' + ph.near.join('、') : ''));
    return { internalModel: phm, total: phist.length, items: phist.slice(0, limit).map(botPriceOut_) };
  }

  if (action === 'inquiryDraft') {
    botNeed_(ctx, 'products', 'view');
    if (botStaffCfg_().hidePrice) throw new Error('管理員設定助理不顯示價格與供應商資料');
    var iq = botFindProduct_(params.internalModel);
    if (!iq.obj) throw new Error('找不到產品「' + String(params.internalModel || '').trim() + '」' + (iq.near.length ? '，你是不是要找：' + iq.near.join('、') : ''));
    var ihist = handleGetPriceHistory({ internalModel: iq.obj['InternalModel'] }).history || [];
    var itext = inquiryText_(iq.obj, ihist.length ? ihist[0] : null, params.quantity);
    return { to: iq.obj['SupplierContactEmail'] || '', supplier: iq.obj['Supplier'] || '', subject: itext.subject, body: itext.body, note: '這只是文字草稿，還沒有建立 Gmail 草稿；要建立請用 create_inquiry_draft（會先請同事確認）' };
  }

  if (action === 'kbChunks') return botStaffKnowledge_(); // 公司知識庫：每位已開通的同事都能查（客服能看的，同事一定也能看）
  if (action === 'kbVectors') return csVectors_({ after: params.after, limit: params.limit }, 'staff');

  if (action === 'copyPosts') {
    botNeed_(ctx, 'copy', 'view');
    var cps = sheetToObjects(SHEET_COPY_POSTS).rows.map(copyPostOut_);
    var cstatus = String(params.status || '');
    var ckw = botKws_(params.keyword);
    cps = cps.filter(function (x) { return (!cstatus || x.status === cstatus) && (!ckw.length || botMatch_({ t: x.topic, k: x.keywords, c: x.content, p: x.platform }, ['t', 'k', 'c', 'p'], ckw)); });
    cps.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
    return { total: cps.length, items: cps.slice(0, Math.min(limit, 15)).map(function (x) { return { id: x.id, platform: x.platform, topic: x.topic, status: x.status, scheduled_for: x.scheduled_for, tone: x.tone, content: String(x.content).slice(0, 400) }; }) };
  }

  if (action === 'copyStyle') {
    botNeed_(ctx, 'copy', 'view');
    var st = copyStyle_();
    return {
      platforms: COPY_PLATFORMS,
      style: st.enabled ? st.profile : '',
      library: sheetToObjects(SHEET_COPY_LIB).rows.map(copyLibOut_).filter(function (x) { return x.enabled; }).slice(0, 30).map(function (x) { return { kind: x.kind, name: x.name, text: String(x.text).slice(0, 300), platform: x.platform }; }),
    };
  }

  if (action === 'cards') {
    botNeed_(ctx, 'customers', 'view');
    var cstatus = ['pending', 'saved', 'discarded', 'all'].indexOf(String(params.status)) > -1 ? String(params.status) : 'pending';
    if (String(params.note || '').trim()) {
      botNeed_(ctx, 'customers', 'edit');
      botCardSetNote_(ctx, String(params.note));
    }
    var mineCards = botCardRows_().filter(function (c) { return c.owner === ctx.ownerKey && (cstatus === 'all' || c.status === cstatus); });
    var shownCards = mineCards.slice(-40);
    return { total: mineCards.length, batchNote: botCardNote_(ctx), items: shownCards.map(function (c) { return botCardOut_(c); }) };
  }

  if (action === 'logs') {
    botNeed_(ctx, 'customers', 'view');
    var cn = String(params.companyName || '').trim();
    var lrows = sheetToObjects(SHEET_CONTACT_LOGS).rows.filter(function (r) { return !cn || normCompanyName_(r['CompanyName']).indexOf(normCompanyName_(cn)) > -1; });
    return {
      total: lrows.length,
      items: lrows.slice(-limit).reverse().map(function (r) { return { Date: dateKey_(r['Date']), Company: r['CompanyName'], Method: r['Method'], Contact: r['Contact'], Summary: String(r['Summary'] || '').slice(0, 200), Salesperson: r['Salesperson'] }; }),
    };
  }

  if (action === 'memos') {
    var me = ctx.username;
    var mctx = wsShareCtx_(me);
    var mrows = sheetToObjects(SHEET_MEMOS).rows.map(function (r, i) { r.RowIndex = i + 2; return r; }).filter(function (r) {
      var need = String(r['NeedBlock'] || '');
      if (need && botLevel_(ctx, need) === 'none') return false;
      return (me && r['Owner'] === me) || (me && wsVisible_(r, me, mctx.myGroups));
    });
    return { total: mrows.length, items: mrows.slice(-limit).reverse().map(function (r) { return { ref: r['Owner'] === me && !r['LinkType'] ? r.RowIndex : undefined, Title: r['Title'], Content: String(r['Content'] || '').slice(0, 200), Shared: wsMode_(r) !== 'self', Mine: r['Owner'] === me, Owner: r['Owner'] === me ? undefined : r['OwnerName'] || r['Owner'], Date: dateKey_(r['LastUpdated']) }; }) };
  }

  if (action === 'calendar') {
    if (!ctx.username) throw new Error('行事曆是每個帳號各自的，請先把你的 LINE 綁定到網站帳號');
    var cdays = botInt_(params.days, 1, 30, 7);
    var evs = wsEventsFor_(ctx.username, todayStr(), addDaysStr(todayStr(), cdays - 1), 'all');
    return { today: today, total: evs.length, items: evs.slice(0, 30).map(wsEventBrief_) };
  }

  if (action === 'todos') {
    if (!ctx.username) throw new Error('工作清單是每個帳號各自的，請先把你的 LINE 綁定到網站帳號');
    var tl = wsTodosFor_(ctx.username, String(params.scope || 'all'), String(params.status || 'open'));
    return { today: today, total: tl.length, items: tl.slice(0, limit * 2).map(wsTodoBrief_) };
  }

  if (action === 'overview') {
    var ov = { today: today, weekday: '日一二三四五六'.charAt(new Date(today + 'T12:00:00+08:00').getDay()) };
    if (botLevel_(ctx, 'customers') !== 'none') {
      var fu = botStaffCallRun_(ctx, 'followups', { days: 3, limit: 10 });
      ov.followups = { total: fu.total, items: fu.items.slice(0, 15) };
    }
    if (botLevel_(ctx, 'cases') !== 'none') {
      var open = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return r['Status'] !== '已結案'; });
      var byStatus = {};
      open.forEach(function (r) { byStatus[r['Status']] = (byStatus[r['Status']] || 0) + 1; });
      ov.openCases = { total: open.length, byStatus: byStatus, high: open.filter(function (r) { return r['Urgency'] === '高'; }).slice(0, 5).map(function (r) { return botTrimRow_(r, ['CaseID', 'CustomerName', 'Status'], 60); }) };
    }
    try {
      if (ctx.username) {
      var ovEv = wsEventsFor_(ctx.username, today, addDaysStr(today, 1), 'all').filter(function (e) { return e.source !== 'followup'; });
      if (ovEv.length) ov.events = ovEv.slice(0, 10).map(wsEventBrief_);
      var ovTodo = wsTodosFor_(ctx.username, 'all', 'open').filter(function (t) { return t.dueDate && t.dueDate <= addDaysStr(today, 1); });
      if (ovTodo.length) ov.todos = ovTodo.slice(0, 10).map(wsTodoBrief_);
      }
    } catch (e) {
      // 沒有日曆權限就略過
    }
    return ov;
  }
  throw new Error('未知的查詢：' + action);
}

// ------------------------------------------------------------
// 新增 / 修改（白名單；AI 只能提出，本人確認才寫入）
// ------------------------------------------------------------
var BOT_STAFF_WRITES = {
  addMemo: { block: '', label: '新增備忘錄' },
  logFollowUp: { block: 'customers', label: '記錄追蹤 / 改下次追蹤' },
  updateCustomer: { block: 'customers', label: '修改客戶資料' },
  addCustomer: { block: 'customers', label: '新增客戶' },
  createCase: { block: 'cases', label: '建立案件' },
  updateCaseStatus: { block: 'cases', label: '修改案件狀態 / 緊急程度' },
  updateCase: { block: 'cases', label: '修改案件內容（聯絡人 / 需求說明 / 評估結果…）' },
  addContact: { block: 'customers', label: '新增客戶聯絡窗口' },
  addPriceRecord: { block: 'products', label: '記錄報價（價格紀錄）' },
  addProduct: { block: 'products', label: '新增產品' },
  updateProduct: { block: 'products', label: '修改產品資料' },
  createInquiryDraft: { block: 'products', label: '建立詢價信 Gmail 草稿（不會寄出）' },
  saveCopyPost: { block: 'copy', label: '儲存文案草稿' },
  deleteCustomer: { block: 'customers', del: true, label: '🗑️ 刪除客戶（網站帳號有刪除權限才能用）' },
  deleteContact: { block: 'customers', del: true, label: '🗑️ 刪除客戶聯絡窗口' },
  deleteCase: { block: 'cases', del: true, label: '🗑️ 刪除案件' },
  deleteProduct: { block: 'products', del: true, label: '🗑️ 刪除產品' },
  deletePriceRecord: { block: 'products', del: true, label: '🗑️ 刪除報價紀錄' },
  deleteCopyPost: { block: 'copy', del: true, label: '🗑️ 刪除文案' },
  deleteEvent: { block: '', del: true, label: '🗑️ 刪除行事曆行程（自己的）' },
  deleteTodo: { block: '', del: true, label: '🗑️ 刪除工作清單項目（自己的）' },
  deleteMemo: { block: '', del: true, label: '🗑️ 刪除備忘錄（自己的）' },
  saveCards: { block: 'customers', label: '名片：把收件匣的名片整批存成客戶 / 聯絡窗口' },
  discardCards: { block: 'customers', label: '名片：丟棄收件匣裡的名片（不存入客戶）' },
  addEvent: { block: '', label: '新增行事曆行程（自己的）' },
  addTodo: { block: '', label: '新增工作清單項目（自己的）' },
  completeTodo: { block: '', label: '完成 / 重開工作清單項目（自己的）' },
  remember: { block: '', label: '記住（長期記憶）' },
};
var BOT_PRICE_WRITES = ['addPriceRecord', 'createInquiryDraft', 'deletePriceRecord']; // 管理員設定「助理不顯示價格」時，這些也不開放
var BOT_CASE_EDITABLE = { ProjectContact: '專案聯絡人', ContactPhone: '聯絡電話', EndCustomerName: '終端客戶', Salesperson: '業務', FAE: 'FAE', RequirementDetails: '需求說明', EvaluationResult: '評估結果' };
var BOT_PRODUCT_EDITABLE = { SupplierModel: '供應商型號', Brand: '品牌', Category: '類別', Interface: '介面', Resolution: '解析度', PixelSize: '像素尺寸', SensorSize: '靶面', FPS: '幀率', Mount: '接口', FocalLength: '焦距', Magnification: '倍率', WD: '工作距離', DOF: '景深', FocusWD: '對焦距離', EffectivePixels: '有效像素', CompatibleGroup: '相容群組', Origin: '產地', Notes: '備註' };
var BOT_PRODUCT_PRICEY = { Supplier: '供應商', SupplierContact: '供應商聯絡人', SupplierContactEmail: '供應商 Email', RefPrice: '參考底價' }; // 有價格權限（沒被隱藏）才能改
var BOT_CUSTOMER_EDITABLE = { Contact: '聯絡人', Phone: '聯繫人電話', Email: 'Email', CompanyPhone: '公司電話', Address: '地址', TaxId: '統一編號', Website: '公司網址', Category: '分類', Urgency: '急迫性', Notes: '客戶備註' };

function botWritableOps_(ctx) {
  var allowed = botStaffCfg_().writes;
  return Object.keys(BOT_STAFF_WRITES).filter(function (k) {
    if (allowed.indexOf(k) < 0) return false;
    if (k === 'remember') return botStaffCfg_().memory.enabled;
    if (botStaffCfg_().hidePrice && BOT_PRICE_WRITES.indexOf(k) > -1) return false;
    if (BOT_STAFF_WRITES[k].del && BOT_STAFF_WRITES[k].block && !ctx.access.canDelete) return false; // 系統資料的刪除：要有刪除權限
    if (BOT_STAFF_WRITES[k].del && !BOT_STAFF_WRITES[k].block && !ctx.username) return false; // 自己的行事曆 / 工作 / 備忘錄：要綁定網站帳號
    var b = BOT_STAFF_WRITES[k].block;
    return !b || botLevel_(ctx, b) === 'edit';
  });
}

function botFindCustomerRow_(name) {
  var key = normCompanyName_(name);
  var rows = sheetToObjects(SHEET_CUSTOMERS).rows;
  for (var i = 0; i < rows.length; i++) if (normCompanyName_(rows[i]['CompanyName']) === key) return { row: i + 2, obj: rows[i] };
  return null;
}

/** 檢查一筆要寫入的操作並產生給本人確認的說明（不寫入）。回傳 { line }。 */
function botWriteCheck_(ctx, w) {
  var spec = BOT_STAFF_WRITES[w.action];
  if (!spec) throw new Error('不能執行：' + w.action);
  if (botStaffCfg_().writes.indexOf(w.action) < 0) throw new Error('管理員沒有開放「' + spec.label + '」給助理使用');
  if (spec.block) botNeed_(ctx, spec.block, 'edit');
  if (spec.del && spec.block && !ctx.access.canDelete) throw new Error('刪除需要網站帳號有刪除權限（只有系統管理員），你的帳號不能用助理刪除這類資料');
  if (spec.del && !spec.block && !ctx.username) throw new Error('請先把你的 LINE 綁定到網站帳號，才能刪除自己的行事曆 / 工作 / 備忘錄');
  var d = w.data || {};
  var s = function (k) { return String(d[k] == null ? '' : d[k]).trim(); };
  if (w.action === 'remember') {
    if (!botStaffCfg_().memory.enabled) throw new Error('長期記憶沒有開啟');
    if (!s('content')) throw new Error('要記住的內容不能空白');
    if (d.scope === 'all' && !(botStaffCfg_().memory.canShared || blocksCanShare_(ctx))) throw new Error('你不能新增全公司的記憶');
    return { line: '🧠 記住' + (d.scope === 'all' ? '（全公司）' : '') + '：' + s('content').slice(0, 80) };
  }
  if (w.action === 'addMemo') {
    if (!s('title') && !s('content')) throw new Error('備忘錄標題或內容至少要填一個');
    return { line: '📝 新增備忘錄：' + (s('title') || s('content').slice(0, 30)) + (s('content') && s('title') ? '（' + s('content').slice(0, 60) + '）' : '') };
  }
  if (w.action === 'logFollowUp') {
    var c = botFindCustomerRow_(s('company'));
    if (!c) throw new Error('找不到客戶「' + s('company') + '」，請先確認公司名稱（或先新增客戶）');
    if (!s('summary') && !s('nextDate') && !s('nextNote') && d.stop !== true) throw new Error('請提供這次聯繫的內容，或要改的下次追蹤日 / 洽談內容');
    if (s('nextDate') && !isDateStr(s('nextDate'))) throw new Error('下次追蹤日要是 YYYY-MM-DD');
    if (s('nextTime') && !normTimeStr_(s('nextTime'))) throw new Error('預約時間要是 HH:mm');
    if (s('caseId') && !findCase(s('caseId'))) throw new Error('找不到案件「' + s('caseId') + '」');
    var parts = [];
    if (s('summary')) parts.push('聯繫（' + (s('method') || '其他') + '）：' + s('summary').slice(0, 80));
    if (d.stop === true) parts.push('不再追蹤');
    else if (s('nextDate')) parts.push('下次追蹤 ' + s('nextDate') + (s('nextTime') ? ' ' + normTimeStr_(s('nextTime')) : '') + (s('nextNote') ? '：' + s('nextNote').slice(0, 60) : ''));
    return { line: '📞 ' + c.obj['CompanyName'] + ' → ' + parts.join('；') };
  }
  if (w.action === 'updateCustomer') {
    var cu = botFindCustomerRow_(s('company'));
    if (!cu) throw new Error('找不到客戶「' + s('company') + '」');
    var ch = [];
    Object.keys(d.fields || {}).forEach(function (k) {
      if (!BOT_CUSTOMER_EDITABLE[k]) throw new Error('不能用助理修改這個欄位：' + k + '（只能改 ' + Object.keys(BOT_CUSTOMER_EDITABLE).join('、') + '；公司名稱請到網站改）');
      ch.push(BOT_CUSTOMER_EDITABLE[k] + '：' + String(d.fields[k]).slice(0, 60));
    });
    if (!ch.length) throw new Error('沒有要修改的欄位');
    return { line: '✏️ 修改客戶「' + cu.obj['CompanyName'] + '」：' + ch.join('、') };
  }
  if (w.action === 'addCustomer') {
    if (!s('companyName')) throw new Error('公司名稱不能空白');
    var dup = findDuplicateCustomerRow_(s('companyName'), 0);
    if (dup) throw new Error('已經有「' + s('companyName') + '」這間客戶了');
    return { line: '🏢 新增客戶：' + s('companyName') + (s('contact') ? '（聯絡人 ' + s('contact') + (s('phone') ? ' ' + s('phone') : '') + '）' : '') };
  }
  if (w.action === 'createCase') {
    if (!botFindCustomerRow_(s('customerName'))) throw new Error('案件要掛在已存在的客戶底下，找不到客戶「' + s('customerName') + '」');
    var miss = [];
    if (!s('softwareName')) miss.push('使用軟體名稱');
    if (!s('testObject')) miss.push('待測物件');
    if (!s('productApplication')) miss.push('產品應用');
    if (miss.length) throw new Error('建立案件還缺：' + miss.join('、') + '（這三項會組成案件編號）');
    return { line: '📁 建立案件：' + s('customerName') + '｜' + s('softwareName') + '｜' + s('testObject') + '｜' + s('productApplication') };
  }
  if (w.action === 'updateCaseStatus') {
    var cs = findCase(s('caseId'));
    if (!cs) throw new Error('找不到案件「' + s('caseId') + '」');
    var ps = [];
    if (s('status')) {
      if (BOT_CASE_STATUSES.indexOf(s('status')) < 0) throw new Error('案件狀態只能是：' + BOT_CASE_STATUSES.join('、'));
      ps.push('狀態：' + cs['Status'] + ' → ' + s('status'));
    }
    if (s('urgency')) {
      if (['高', '中', '低'].indexOf(s('urgency')) < 0) throw new Error('緊急程度只能是 高 / 中 / 低');
      ps.push('緊急程度：' + (cs['Urgency'] || '中') + ' → ' + s('urgency'));
    }
    if (!ps.length) throw new Error('請提供要改的狀態或緊急程度');
    return { line: '📁 案件「' + cs['CaseID'] + '」' + ps.join('；') };
  }
  if (w.action === 'updateCase') {
    var uc = findCase(s('caseId'));
    if (!uc) throw new Error('找不到案件「' + s('caseId') + '」');
    var ucs = [];
    Object.keys(d.fields || {}).forEach(function (k) {
      if (!BOT_CASE_EDITABLE[k]) throw new Error('不能用助理修改這個欄位：' + k + '（只能改 ' + Object.keys(BOT_CASE_EDITABLE).join('、') + '；狀態請用 update_case，案件編號 / 客戶請到網站改）');
      ucs.push(BOT_CASE_EDITABLE[k] + '：' + String(d.fields[k]).slice(0, 60));
    });
    if (!ucs.length) throw new Error('沒有要修改的欄位');
    return { line: '📁 修改案件「' + uc['CaseID'] + '」：' + ucs.join('、') };
  }
  if (w.action === 'addContact') {
    var ac = botFindCustomerRow_(s('company'));
    if (!ac) throw new Error('找不到客戶「' + s('company') + '」，請先確認公司名稱');
    if (!s('contactName')) throw new Error('聯絡人姓名不能空白');
    var acn = String(ac.obj['CompanyName']);
    if (sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.some(function (r) { return String(r['CompanyName']) === acn && String(r['ContactName']).trim() === s('contactName'); })) throw new Error(acn + ' 已經有聯絡人「' + s('contactName') + '」了');
    return { line: '👤 ' + acn + ' 新增聯絡窗口：' + s('contactName') + (s('title') ? '（' + s('title') + '）' : '') + (s('phone') ? ' ' + s('phone') : '') + (s('email') ? ' ' + s('email') : '') };
  }
  if (w.action === 'addPriceRecord') {
    if (botStaffCfg_().hidePrice) throw new Error('管理員設定助理不處理價格資料');
    var ap = botFindProduct_(s('internalModel'));
    if (!ap.obj) throw new Error('找不到產品「' + s('internalModel') + '」' + (ap.near.length ? '，你是不是要找：' + ap.near.join('、') : '') + '（要先有這個產品才能記報價）');
    var price = Number(String(d.price == null ? '' : d.price).replace(/,/g, ''));
    if (!(price > 0)) throw new Error('價格要是大於 0 的數字');
    var cur = (s('currency') || 'TWD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new Error('幣別要是 3 碼代號，例如 TWD、USD、CNY');
    if (s('caseId') && !findCase(s('caseId'))) throw new Error('找不到案件「' + s('caseId') + '」');
    return { line: '💲 記錄報價：' + ap.obj['InternalModel'] + '｜' + (s('supplier') || ap.obj['Supplier'] || '（供應商未填）') + '｜' + price + ' ' + cur + (s('caseId') ? '｜案件 ' + s('caseId') : '') };
  }
  if (w.action === 'addProduct') {
    if (!s('internalModel')) throw new Error('內部型號不能空白');
    if (botFindProduct_(s('internalModel')).obj) throw new Error('內部型號「' + s('internalModel') + '」已經存在，要改請用修改產品');
    var apf = [];
    Object.keys(d.fields || {}).forEach(function (k) {
      if (!BOT_PRODUCT_EDITABLE[k] && !BOT_PRODUCT_PRICEY[k]) throw new Error('不能設定這個欄位：' + k + '（可設 ' + Object.keys(BOT_PRODUCT_EDITABLE).join('、') + '）');
      if (BOT_PRODUCT_PRICEY[k] && botStaffCfg_().hidePrice) throw new Error('管理員設定助理不處理價格與供應商資料：' + BOT_PRODUCT_PRICEY[k]);
      apf.push((BOT_PRODUCT_EDITABLE[k] || BOT_PRODUCT_PRICEY[k]) + '：' + String(d.fields[k]).slice(0, 40));
    });
    return { line: '📦 新增產品：' + s('internalModel') + (apf.length ? '（' + apf.join('、') + '）' : '') };
  }
  if (w.action === 'updateProduct') {
    var up = botFindProduct_(s('internalModel'));
    if (!up.obj) throw new Error('找不到產品「' + s('internalModel') + '」' + (up.near.length ? '，你是不是要找：' + up.near.join('、') : ''));
    var ups = [];
    Object.keys(d.fields || {}).forEach(function (k) {
      if (!BOT_PRODUCT_EDITABLE[k] && !BOT_PRODUCT_PRICEY[k]) throw new Error('不能用助理修改這個欄位：' + k + '（內部型號請到網站改；可改 ' + Object.keys(BOT_PRODUCT_EDITABLE).join('、') + '）');
      if (BOT_PRODUCT_PRICEY[k] && botStaffCfg_().hidePrice) throw new Error('管理員設定助理不處理價格與供應商資料：' + BOT_PRODUCT_PRICEY[k]);
      ups.push((BOT_PRODUCT_EDITABLE[k] || BOT_PRODUCT_PRICEY[k]) + '：' + String(d.fields[k]).slice(0, 60));
    });
    if (!ups.length) throw new Error('沒有要修改的欄位');
    return { line: '✏️ 修改產品「' + up.obj['InternalModel'] + '」：' + ups.join('、') };
  }
  if (w.action === 'createInquiryDraft') {
    if (botStaffCfg_().hidePrice) throw new Error('管理員設定助理不處理價格與供應商資料');
    var cd = botFindProduct_(s('internalModel'));
    if (!cd.obj) throw new Error('找不到產品「' + s('internalModel') + '」' + (cd.near.length ? '，你是不是要找：' + cd.near.join('、') : ''));
    if (!String(cd.obj['SupplierContactEmail'] || '').trim()) throw new Error('「' + cd.obj['InternalModel'] + '」沒有填供應商 Email，沒辦法建立詢價信草稿');
    return { line: '✉️ 建立詢價信草稿（只存草稿、不寄出）：' + cd.obj['InternalModel'] + ' → ' + cd.obj['SupplierContactEmail'] + (s('quantity') ? '｜數量 ' + s('quantity') : '') };
  }
  if (w.action === 'saveCards' || w.action === 'discardCards') {
    var targets = botCardTargets_(ctx, d);
    if (!targets.length) throw new Error('名片收件匣裡沒有符合的待整理名片（先傳名片照片給我，或用 list_cards 查編號）');
    if (w.action === 'discardCards') return { line: '🗑️ 丟棄 ' + targets.length + ' 張名片：' + targets.slice(0, 8).map(function (c) { return c.name || c.company || '#' + c.id; }).join('、') + (targets.length > 8 ? '…' : '') + '（不會存進客戶資料）' };
    var plan = botCardPlan_(targets, d.overrides || {}, d.category);
    var counts = { newCustomer: 0, addContact: 0, skip: 0 };
    plan.forEach(function (x) { counts[x.kind]++; });
    return {
      line: '📇 名片整批存入（新增客戶 ' + counts.newCustomer + ' 間、補聯絡窗口 ' + counts.addContact + ' 位' + (counts.skip ? '、略過 ' + counts.skip + ' 張' : '') + '）：\n' +
        plan.map(function (x) { return '  ' + x.text; }).join('\n'),
    };
  }
  if (w.action === 'addEvent' || w.action === 'addTodo' || w.action === 'completeTodo') {
    if (!ctx.username) throw new Error('行事曆與工作清單是每個帳號各自的，請先把你的 LINE 綁定到網站帳號');
  }
  if (w.action === 'addEvent') {
    var ec = wsCleanEvent_({ title: s('title'), startDate: s('date'), startTime: s('time'), endDate: s('endDate'), endTime: s('endTime'), allDay: d.allDay === true, location: s('location'), notes: s('notes') });
    return { line: '📅 新增行程：' + ec.startDate + (ec.allDay ? '（全天）' : ' ' + ec.startTime + '–' + ec.endTime) + ' ' + ec.title + (ec.location ? '＠' + ec.location : '') + (d.shareAll === true ? '｜分享給全部同事（只能看）' : '') };
  }
  if (w.action === 'addTodo') {
    var tc = wsCleanTodo_({ title: s('title'), notes: s('notes'), dueDate: s('dueDate'), priority: s('priority') });
    return { line: '✅ 新增工作：' + tc.title + (tc.dueDate ? '｜期限 ' + tc.dueDate : '') + '｜' + tc.priority + (d.shareAll === true ? '｜分享給全部同事（只能看）' : '') };
  }
  if (w.action === 'completeTodo') {
    var ct = wsFindById_(SHEET_TODOS, d.id);
    if (!ct) throw new Error('找不到工作 #' + d.id);
    if (String(ct.row['Owner']) !== ctx.username) throw new Error('這不是你的工作，只有擁有者可以改');
    var tto = d.reopen === true ? 'todo' : 'done';
    return { line: (tto === 'done' ? '☑️ 完成工作：' : '↩️ 重開工作：') + ct.row['Title'] };
  }
  if (w.action === 'deleteCustomer') {
    var dc = botFindCustomerRow_(s('company'));
    if (!dc) throw new Error('找不到客戶「' + s('company') + '」');
    var dcn = String(dc.obj['CompanyName']);
    var dcases = sheetToObjects(SHEET_CASES).rows.filter(function (r) { return String(r['CustomerName']).trim() === dcn; }).length;
    if (dcases && d.force !== true) throw new Error('「' + dcn + '」底下還有 ' + dcases + ' 個案件，刪除客戶後這些案件會找不到客戶資料。要連同刪除請跟同事再確認一次，確定後把 force 設為 true');
    return { line: '🗑️ ⚠️ 刪除客戶「' + dcn + '」' + (dcases ? '（底下還有 ' + dcases + ' 個案件）' : '') + '（無法復原）' };
  }
  if (w.action === 'deleteContact') {
    var dct = botFindCustomerRow_(s('company'));
    if (!dct) throw new Error('找不到客戶「' + s('company') + '」');
    var dctn = String(dct.obj['CompanyName']);
    var dctRow = sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.filter(function (r) { return String(r['CompanyName']) === dctn && String(r['ContactName']).trim() === s('contactName'); }).length;
    if (!dctRow) throw new Error(dctn + ' 沒有叫「' + s('contactName') + '」的聯絡窗口');
    return { line: '🗑️ ⚠️ 刪除 ' + dctn + ' 的聯絡窗口「' + s('contactName') + '」（無法復原）' };
  }
  if (w.action === 'deleteCase') {
    var dcs = findCase(s('caseId'));
    if (!dcs) throw new Error('找不到案件「' + s('caseId') + '」');
    return { line: '🗑️ ⚠️ 刪除案件「' + dcs['CaseID'] + '」（連同 CCD 需求與相關公司，無法復原）' };
  }
  if (w.action === 'deleteProduct') {
    var dpf = botFindProduct_(s('internalModel'));
    if (!dpf.obj) throw new Error('找不到產品「' + s('internalModel') + '」' + (dpf.near.length ? '，你是不是要找：' + dpf.near.join('、') : ''));
    return { line: '🗑️ ⚠️ 刪除產品「' + dpf.obj['InternalModel'] + '」（無法復原）' };
  }
  if (w.action === 'deletePriceRecord') {
    if (botStaffCfg_().hidePrice) throw new Error('管理員設定助理不處理價格資料');
    var dpr = botPriceMatch_(s('internalModel'), s('date'), d.price);
    return { line: '🗑️ ⚠️ 刪除報價紀錄：' + dpr.model + '｜' + dateKey_(dpr.row['Date']) + '｜' + dpr.row['Price'] + ' ' + (dpr.row['Currency'] || 'TWD') + '（無法復原）' };
  }
  if (w.action === 'deleteCopyPost') {
    var dcp = copyFindRow_(SHEET_COPY_POSTS, d.id);
    if (!dcp) throw new Error('找不到這篇文案 #' + d.id);
    return { line: '🗑️ ⚠️ 刪除文案 #' + d.id + '：' + String(dcp.row['Topic'] || dcp.row['Content'] || '').slice(0, 30) + '（無法復原）' };
  }
  if (w.action === 'deleteEvent') {
    var dev = wsFindById_(SHEET_CAL, d.id);
    if (!dev) throw new Error('找不到行程 #' + d.id);
    if (String(dev.row['Owner']) !== ctx.username) throw new Error('這不是你的行程，只有擁有者可以刪除');
    return { line: '🗑️ 刪除行程：' + dateKey_(dev.row['StartDate']) + ' ' + dev.row['Title'] };
  }
  if (w.action === 'deleteTodo') {
    var dtd = wsFindById_(SHEET_TODOS, d.id);
    if (!dtd) throw new Error('找不到工作 #' + d.id);
    if (String(dtd.row['Owner']) !== ctx.username) throw new Error('這不是你的工作，只有擁有者可以刪除');
    return { line: '🗑️ 刪除工作：' + dtd.row['Title'] };
  }
  if (w.action === 'deleteMemo') {
    var dmm = botMemoOwn_(ctx, d.rowIndex, s('title'));
    return { line: '🗑️ 刪除備忘錄：' + (dmm['Title'] || String(dmm['Content'] || '').slice(0, 20)) };
  }
  if (w.action === 'saveCopyPost') {
    if (!s('content') && !s('topic')) throw new Error('主題與內文至少要填一個');
    if (s('platform') && COPY_PLATFORMS.indexOf(s('platform')) < 0) throw new Error('平台只能是：' + COPY_PLATFORMS.join('、'));
    if (s('scheduledFor') && !isDateStr(s('scheduledFor'))) throw new Error('預排日期要是 YYYY-MM-DD');
    if (d.id && !copyFindRow_(SHEET_COPY_POSTS, d.id)) throw new Error('找不到這篇文案 #' + d.id);
    return { line: '📣 ' + (d.id ? '修改' : '儲存') + '文案草稿（' + (s('platform') || 'Threads') + '）：' + (s('topic') || s('content').slice(0, 30)) + (s('scheduledFor') ? '｜預排 ' + s('scheduledFor') : '') };
  }
  throw new Error('不能執行：' + w.action);
}

function botStage_(id, body) {
  var ctx = botStaffCtx_(id);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  var ops = Array.isArray(body.ops) ? body.ops : [];
  if (!ops.length) throw new Error('沒有要寫入的內容');
  if (ops.length > 10) throw new Error('一次最多 10 項修改');
  var lines = ops.map(function (w) { return botWriteCheck_(ctx, w).line; });
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  var summary = lines.join('\n');
  botCachePut_('linep:' + id, { token: token, ops: ops, summary: summary, at: botNow_() }, BOT_PENDING_SECONDS);
  return { token: token, summary: summary };
}

function botCommit_(id, body) {
  var ctx = botStaffCtx_(id);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  var p = botPendingGet_(id);
  if (!p) throw new Error('沒有等待確認的修改（可能已經超過 15 分鐘，請重新說一次）');
  if (body.token && String(body.token) !== p.token) throw new Error('這不是最新一筆等待確認的修改，請用最新的確認按鈕');
  var results = [];
  botCacheRemove_(['linep:' + id]); // 先清掉，避免按兩次寫兩次
  var lines = String(p.summary).split('\n');
  withLock_(function () {
    p.ops.forEach(function (w, i) {
      var isDel = String(w.action).indexOf('delete') === 0;
      try {
        botWriteCheck_(ctx, w); // 確認當下再檢查一次權限與資料
        results.push(botWriteRun_(ctx, w));
      } catch (e) {
        botAudit_(ctx, 'denied', '確認後執行失敗：' + (lines[i] || w.action) + '（' + e.message + '）');
        throw e;
      }
      botAudit_(ctx, isDel ? 'delete' : 'write', '已執行：' + (lines[i] || w.action));
    });
  });
  return { summary: p.summary, count: results.length, results: results };
}

function botUserFor_(ctx) {
  return { username: ctx.username || ctx.name || 'LINE', displayName: ctx.name || ctx.username || 'LINE' };
}

function botWriteRun_(ctx, w) {
  var d = w.data || {};
  var s = function (k) { return String(d[k] == null ? '' : d[k]).trim(); };
  var user = botUserFor_(ctx);
  WS_ACTOR_ = ctx.username || '';
  if (w.action === 'remember') {
    botMemoryWrite_(ctx, { mode: 'add', scope: d.scope === 'all' ? 'all' : 'user', category: s('category'), content: s('content'), importance: d.importance });
    return { action: w.action, ok: true };
  }
  if (w.action === 'addMemo') {
    var today = todayStr();
    appendObjectRow(SHEET_MEMOS, { Owner: ctx.username || user.username, OwnerName: user.displayName, Title: s('title'), Content: s('content'), Shared: d.shared === true ? '是' : '', ShareMode: d.shared === true ? 'all' : 'self', ShareWith: '[]', CreatedDate: today, LastUpdated: today });
    return { action: w.action, ok: true };
  }
  if (w.action === 'logFollowUp') {
    var c = botFindCustomerRow_(s('company'));
    var fields = {};
    if (d.stop === true) {
      fields.NextFollowUpDate = '';
      fields.NextFollowUpNote = '';
    } else {
      if (s('nextDate')) fields.NextFollowUpDate = s('nextDate');
      if (s('nextTime')) fields.NextFollowUpTime = s('nextTime');
      if (s('nextNote')) fields.NextFollowUpNote = s('nextNote');
    }
    var res = handleSaveFollowUp({
      _user: user,
      rowIndex: c.row,
      companyName: c.obj['CompanyName'],
      fields: fields,
      caseId: s('caseId'),
      log: s('summary') ? { method: s('method') || '其他', contact: s('contact'), summary: s('summary'), caseId: s('caseId') } : undefined,
    });
    if (!res.success) throw new Error(res.message);
    return { action: w.action, ok: true, company: c.obj['CompanyName'] };
  }
  if (w.action === 'updateCustomer') {
    var cu = botFindCustomerRow_(s('company'));
    var r2 = handleUpdateCustomer({ _user: user, rowIndex: cu.row, companyName: cu.obj['CompanyName'], fields: d.fields });
    if (!r2.success) throw new Error(r2.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'addCustomer') {
    var r3 = handleAddCustomer({ _user: user, companyName: s('companyName'), contact: s('contact'), phone: s('phone'), email: s('email'), category: s('category') || '一般客戶', urgency: s('urgency') || '中', notes: s('notes') });
    if (!r3.success) throw new Error(r3.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'createCase') {
    var r4 = handleCreateCase({ _user: user, customerName: botFindCustomerRow_(s('customerName')).obj['CompanyName'], projectContact: s('projectContact'), contactPhone: s('contactPhone'), salesperson: s('salesperson') || ctx.name, productApplication: s('productApplication'), testObject: s('testObject'), softwareName: s('softwareName'), requirementDetails: s('requirementDetails'), urgency: s('urgency') });
    if (!r4.success) throw new Error(r4.message);
    return { action: w.action, ok: true, caseId: r4.caseId };
  }
  if (w.action === 'updateCaseStatus') {
    var f = {};
    if (s('status')) f.Status = s('status');
    if (s('urgency')) f.Urgency = s('urgency');
    var r5 = handleUpdateCase({ _user: user, caseId: s('caseId'), fields: f });
    if (!r5.success) throw new Error(r5.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'updateCase') {
    var r6 = handleUpdateCase({ _user: user, caseId: s('caseId'), fields: d.fields });
    if (!r6.success) throw new Error(r6.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'addContact') {
    var r7 = handleAddCustomerContact({ _user: user, companyName: botFindCustomerRow_(s('company')).obj['CompanyName'], contactName: s('contactName'), title: s('title'), phone: s('phone'), email: s('email'), notes: s('notes') });
    if (!r7.success) throw new Error(r7.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'addPriceRecord') {
    var pp = botFindProduct_(s('internalModel')).obj;
    var r8 = handleAddPriceRecord({ _user: user, internalModel: pp['InternalModel'], supplier: s('supplier') || pp['Supplier'], price: Number(String(d.price).replace(/,/g, '')), currency: (s('currency') || 'TWD').toUpperCase(), caseId: s('caseId'), notes: s('notes') });
    if (!r8.success) throw new Error(r8.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'addProduct') {
    var fl = d.fields || {};
    var camel = function (k) { return k.charAt(0).toLowerCase() + k.slice(1); };
    var np = { _user: user, internalModel: s('internalModel') };
    Object.keys(fl).forEach(function (k) { np[k === 'FPS' ? 'fps' : k === 'WD' ? 'wd' : k === 'DOF' ? 'dof' : k === 'FocusWD' ? 'focusWd' : camel(k)] = fl[k]; });
    var r9 = handleAddProduct(np);
    if (!r9.success) throw new Error(r9.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'updateProduct') {
    var fp = botFindProduct_(s('internalModel'));
    var r10 = handleUpdateProduct({ _user: user, rowIndex: fp.row, fields: d.fields });
    if (!r10.success) throw new Error(r10.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'createInquiryDraft') {
    var ip = botFindProduct_(s('internalModel')).obj;
    var ih = handleGetPriceHistory({ internalModel: ip['InternalModel'] }).history || [];
    var tx = inquiryText_(ip, ih.length ? ih[0] : null, s('quantity'));
    var r11 = handleCreateGmailDraft({ _user: user, to: ip['SupplierContactEmail'], subject: tx.subject, body: tx.body });
    if (!r11.success) throw new Error(r11.message);
    return { action: w.action, ok: true, draftUrl: r11.draftUrl };
  }
  if (w.action === 'addEvent') {
    var er = handleCalSaveEvent({ _user: user, title: s('title'), startDate: s('date'), startTime: s('time'), endDate: s('endDate'), endTime: s('endTime'), allDay: d.allDay === true, location: s('location'), notes: s('notes'), shareMode: d.shareAll === true ? 'all' : 'self' });
    if (!er.success) throw new Error(er.message);
    return { action: w.action, ok: true, id: er.id };
  }
  if (w.action === 'addTodo') {
    var tr = handleTodoSave({ _user: user, title: s('title'), notes: s('notes'), dueDate: s('dueDate'), priority: s('priority'), shareMode: d.shareAll === true ? 'all' : 'self' });
    if (!tr.success) throw new Error(tr.message);
    return { action: w.action, ok: true, id: tr.id };
  }
  if (w.action === 'completeTodo') {
    var cr = handleTodoSetStatus({ _user: user, id: d.id, status: d.reopen === true ? 'todo' : 'done' });
    if (!cr.success) throw new Error(cr.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'saveCards' || w.action === 'discardCards') {
    return botCardsRun_(ctx, w, user);
  }
  if (w.action === 'deleteCustomer') {
    var dcr = botFindCustomerRow_(s('company'));
    var rdc = handleDeleteCustomer({ _user: user, rowIndex: dcr.row, companyName: dcr.obj['CompanyName'], force: d.force === true });
    if (!rdc.success) throw new Error(rdc.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteContact') {
    var dctn2 = String(botFindCustomerRow_(s('company')).obj['CompanyName']);
    var crow = 0;
    sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.forEach(function (r, i) { if (!crow && String(r['CompanyName']) === dctn2 && String(r['ContactName']).trim() === s('contactName')) crow = i + 2; });
    var rct = handleDeleteCustomerContact({ _user: user, rowIndex: crow, expect: { CompanyName: dctn2, ContactName: s('contactName') } });
    if (!rct.success) throw new Error(rct.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteCase') {
    var rcs = handleDeleteCase({ _user: user, caseId: findCase(s('caseId'))['CaseID'] });
    if (!rcs.success) throw new Error(rcs.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteProduct') {
    var rdp = handleDeleteProduct({ _user: user, rowIndex: botFindProduct_(s('internalModel')).row });
    if (!rdp.success) throw new Error(rdp.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deletePriceRecord') {
    var rpr = handleDeletePriceRecord({ _user: user, rowIndex: botPriceMatch_(s('internalModel'), s('date'), d.price).row.RowIndex });
    if (!rpr.success) throw new Error(rpr.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteCopyPost') {
    var rcp = handleCopyDeletePost({ _user: user, id: d.id });
    if (!rcp.success) throw new Error(rcp.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteEvent') {
    var rev = handleCalDeleteEvent({ _user: user, id: d.id });
    if (!rev.success) throw new Error(rev.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteTodo') {
    var rtd = handleTodoDelete({ _user: user, id: d.id });
    if (!rtd.success) throw new Error(rtd.message);
    return { action: w.action, ok: true };
  }
  if (w.action === 'deleteMemo') {
    botMemoOwn_(ctx, d.rowIndex, s('title'));
    var rmm = handleDeleteMemo({ _user: user, rowIndex: Number(d.rowIndex) });
    if (!rmm.success) throw new Error(rmm.message || '刪除失敗');
    return { action: w.action, ok: true };
  }
  if (w.action === 'saveCopyPost') {
    var post = { platform: s('platform') || 'Threads', topic: s('topic'), keywords: s('keywords'), tone: s('tone'), content: s('content'), status: s('scheduledFor') ? 'scheduled' : 'draft', scheduled_for: s('scheduledFor') };
    if (d.id) {
      var old = copyPostOut_(copyFindRow_(SHEET_COPY_POSTS, d.id).row);
      post = { platform: s('platform') || old.platform, topic: d.topic != null ? s('topic') : old.topic, keywords: d.keywords != null ? s('keywords') : old.keywords, tone: d.tone != null ? s('tone') : old.tone, content: d.content != null ? s('content') : old.content, status: s('scheduledFor') ? 'scheduled' : old.status, scheduled_for: s('scheduledFor') || old.scheduled_for, marketing: old.marketing, event: old.event, note: old.note };
    }
    var r12 = handleCopySavePost({ _user: user, id: d.id || 0, post: post });
    if (!r12.success) throw new Error(r12.message);
    return { action: w.action, ok: true, id: r12.id };
  }
  throw new Error('不能執行：' + w.action);
}

// ------------------------------------------------------------
// 名片收件匣：在 LINE 傳名片照片（單張或一次多張），機器人用視覺模型讀出欄位存進收件匣（BotCards），
// 同事說「整理名片」→ 助理列出清單 → 按確認才整批存成客戶 / 聯絡窗口。每個人的收件匣各自獨立。
// ------------------------------------------------------------
var BOT_CARD_FIELDS = { name: 'Name', title: 'Title', company: 'Company', phone: 'Phone', companyPhone: 'CompanyPhone', fax: 'Fax', email: 'Email', address: 'Address', taxId: 'TaxId', website: 'Website', note: 'Note' };
var BOT_CARD_MAX_INBOX = 300;

function botCardRows_() {
  return sheetToObjects(SHEET_BOT_CARDS).rows.map(function (r, i) {
    return { RowIndex: i + 2, id: Number(r['ID']) || 0, owner: String(r['Owner'] || ''), time: String(r['Time'] || ''), status: String(r['Status'] || 'pending'), batch: String(r['Batch'] || ''), name: String(r['Name'] || ''), title: String(r['Title'] || ''), company: String(r['Company'] || ''), phone: String(r['Phone'] || ''), companyPhone: String(r['CompanyPhone'] || ''), fax: String(r['Fax'] || ''), email: String(r['Email'] || ''), address: String(r['Address'] || ''), taxId: String(r['TaxId'] || ''), website: String(r['Website'] || ''), note: String(r['Note'] || ''), confidence: String(r['Confidence'] || ''), result: String(r['Result'] || '') };
  });
}

function botCardOut_(c) {
  var o = { id: c.id, status: c.status };
  ['name', 'title', 'company', 'phone', 'companyPhone', 'fax', 'email', 'address', 'taxId', 'website', 'note', 'batch', 'confidence', 'result'].forEach(function (k) { if (c[k]) o[k] = c[k]; });
  if (c.status === 'pending' && c.company) {
    var hit = botFindCustomerRow_(c.company);
    if (hit) o.existingCustomer = String(hit.obj['CompanyName']);
  }
  return o;
}

function botCardNote_(ctx) {
  return String(botCacheGet_('cardnote:' + ctx.ownerKey) || '');
}

/** 設定這批名片的註記（例如展會名稱），之後傳的名片都會帶上，也一併套用到收件匣裡待整理且還沒有註記的名片。 */
function botCardSetNote_(ctx, note) {
  note = botClip_(note, 60);
  botCachePut_('cardnote:' + ctx.ownerKey, note, 43200);
  withLock_(function () {
    botCardRows_().forEach(function (c) {
      if (c.owner === ctx.ownerKey && c.status === 'pending' && !c.batch) updateRowFields(SHEET_BOT_CARDS, c.RowIndex, { Batch: note });
    });
  });
  return note;
}

function botCardClean_(raw, field, n) {
  return botClip_(raw && raw[field], n).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** linebot 讀完名片照片後把結果丟進收件匣。body.cards = [{name,title,company,phone,companyPhone,fax,email,address,taxId,website,note,confidence}] */
function botStaffCardsOp_(id, body) {
  var ctx = botStaffCtx_(id);
  if (!ctx.ok) throw new Error(ctx.problem || '這個帳號還沒開通');
  botNeed_(ctx, 'customers', 'edit');
  var list = (Array.isArray(body.cards) ? body.cards : []).slice(0, 10);
  if (!list.length) return { added: [], pending: botCardRows_().filter(function (c) { return c.owner === ctx.ownerKey && c.status === 'pending'; }).length };
  var note = botCardNote_(ctx);
  var added = [];
  withLock_(function () {
    var rows = botCardRows_();
    var mine = rows.filter(function (c) { return c.owner === ctx.ownerKey; });
    if (mine.length >= BOT_CARD_MAX_INBOX) throw new Error('名片收件匣滿了（' + BOT_CARD_MAX_INBOX + ' 張），請先整理或丟棄舊的');
    var max = 0;
    rows.forEach(function (c) { max = Math.max(max, c.id); });
    list.forEach(function (raw) {
      var card = {};
      Object.keys(BOT_CARD_FIELDS).forEach(function (k) { card[k] = botCardClean_(raw, k, k === 'note' || k === 'address' ? 200 : 80); });
      if (!card.name && !card.company && !card.phone && !card.email) return; // 什麼都讀不到
      var row = { ID: ++max, Owner: ctx.ownerKey, Time: botNow_(), Status: 'pending', Batch: note, Confidence: botCardClean_(raw, 'confidence', 10), Result: '' };
      Object.keys(BOT_CARD_FIELDS).forEach(function (k) { row[BOT_CARD_FIELDS[k]] = card[k]; });
      // 收件匣裡已經有同一個人（Email 或 姓名 + 電話相同）→ 提醒重複，仍然收下（由同事決定）
      var dup = mine.filter(function (c) { return c.status === 'pending' && ((card.email && c.email.toLowerCase() === card.email.toLowerCase()) || (card.name && c.name === card.name && card.phone && c.phone === card.phone)); })[0];
      appendObjectRow(SHEET_BOT_CARDS, row);
      var out = { id: row.ID, name: card.name, title: card.title, company: card.company, phone: card.phone, email: card.email };
      if (dup) out.duplicateOf = dup.id;
      var hit = card.company ? botFindCustomerRow_(card.company) : null;
      if (hit) out.existingCustomer = String(hit.obj['CompanyName']);
      added.push(out);
      mine.push({ id: row.ID, status: 'pending', email: card.email, name: card.name, phone: card.phone });
    });
  });
  var pending = botCardRows_().filter(function (c) { return c.owner === ctx.ownerKey && c.status === 'pending'; }).length;
  botAudit_(ctx, 'write', '名片收件匣收下 ' + added.length + ' 張名片（待整理共 ' + pending + ' 張）');
  return { added: added, pending: pending, batchNote: note };
}

/** 這次要處理的名片：data.ids 有給就只處理那些，沒給就是這個人收件匣裡全部待整理的（最多 40 張）。 */
function botCardTargets_(ctx, d) {
  var want = null;
  if (Array.isArray(d.ids) && d.ids.length) {
    want = {};
    d.ids.forEach(function (i) { want[Number(i)] = true; });
  }
  return botCardRows_().filter(function (c) { return c.owner === ctx.ownerKey && c.status === 'pending' && (!want || want[c.id]); }).slice(0, 40);
}

function botCardMerge_(card, ov) {
  var m = Object.assign({}, card);
  Object.keys(BOT_CARD_FIELDS).forEach(function (k) {
    if (ov && ov[k] !== undefined && ov[k] !== null) m[k] = botClip_(ov[k], k === 'note' || k === 'address' ? 200 : 80);
  });
  return m;
}

/** 每張名片要怎麼處理：公司不存在 → 新增客戶；公司已存在（含這次前面剛要新增的）→ 新增聯絡窗口；沒有公司名稱 → 略過。 */
function botCardPlan_(cards, overrides, category) {
  var planned = {};
  var plan = [];
  cards.forEach(function (c) {
    var m = botCardMerge_(c, overrides[String(c.id)] || overrides[c.id]);
    var label = (m.name || '（無姓名）') + (m.title ? ' ' + m.title : '');
    if (!m.company) {
      plan.push({ id: c.id, kind: 'skip', card: m, text: '⚠️ #' + c.id + ' ' + label + '：名片上沒有公司名稱，略過（請告訴我公司名稱，或丟棄）' });
      return;
    }
    var key = normCompanyName_(m.company);
    var hit = botFindCustomerRow_(m.company);
    if (hit || planned[key]) {
      var cname = hit ? String(hit.obj['CompanyName']) : planned[key];
      var exists = hit && (normCompanyName_(hit.obj['Contact']) === normCompanyName_(m.name) || sheetToObjects(SHEET_CUSTOMER_CONTACTS).rows.some(function (r) { return String(r['CompanyName']) === cname && String(r['ContactName']).trim() === m.name; }));
      if (!m.name) {
        plan.push({ id: c.id, kind: 'skip', card: m, text: '⚠️ #' + c.id + ' ' + cname + '：名片上沒有姓名，略過' });
      } else if (exists) {
        plan.push({ id: c.id, kind: 'skip', card: m, text: '・#' + c.id + ' ' + cname + ' 已經有聯絡人「' + m.name + '」，略過' });
      } else {
        plan.push({ id: c.id, kind: 'addContact', company: cname, card: m, text: '・#' + c.id + ' ' + cname + ' 已是客戶 → 新增聯絡窗口 ' + label + (m.phone ? ' ' + m.phone : '') + (m.email ? ' ' + m.email : '') });
      }
      return;
    }
    planned[key] = m.company;
    plan.push({ id: c.id, kind: 'newCustomer', company: m.company, card: m, category: category, text: '・#' + c.id + ' 新增客戶 ' + m.company + '（' + label + (m.phone ? ' ' + m.phone : '') + (m.email ? ' ' + m.email : '') + '）' });
  });
  return plan;
}

function botCardNotes_(m, batch) {
  return [m.title ? '職稱：' + m.title : '', m.website ? '網站：' + m.website : '', m.fax ? '傳真：' + m.fax : '', m.note, '名片登入' + (batch ? '（' + batch + '）' : '') + ' ' + todayStr()].filter(Boolean).join('；');
}

function botCardsRun_(ctx, w, user) {
  var d = w.data || {};
  var targets = botCardTargets_(ctx, d);
  if (!targets.length) throw new Error('名片收件匣裡沒有符合的待整理名片');
  if (w.action === 'discardCards') {
    targets.forEach(function (c) { updateRowFields(SHEET_BOT_CARDS, c.RowIndex, { Status: 'discarded', Result: '已丟棄 ' + todayStr() }); });
    return { action: w.action, ok: true, discarded: targets.length };
  }
  var plan = botCardPlan_(targets, d.overrides || {}, d.category);
  var byId = {};
  targets.forEach(function (c) { byId[c.id] = c; });
  var done = { newCustomers: 0, contacts: 0, skipped: 0, failed: [] };
  plan.forEach(function (x) {
    var m = x.card;
    var batch = byId[x.id].batch;
    var result = '';
    try {
      if (x.kind === 'newCustomer') {
        var r1 = handleAddCustomer({ _user: user, companyName: m.company, contact: m.name, phone: m.phone, email: m.email, companyPhone: m.companyPhone, address: m.address, taxId: m.taxId, website: m.website, category: x.category || '一般客戶', urgency: '中', notes: botCardNotes_(m, batch) });
        if (!r1.success) throw new Error(r1.message);
        done.newCustomers++;
        result = '新增客戶 ' + m.company;
      } else if (x.kind === 'addContact') {
        var r2 = handleAddCustomerContact({ _user: user, companyName: x.company, contactName: m.name, title: m.title, phone: m.phone, email: m.email, notes: botCardNotes_({ website: m.website, fax: m.fax, note: m.note }, batch) });
        if (!r2.success) throw new Error(r2.message);
        done.contacts++;
        result = '新增聯絡窗口 → ' + x.company;
      } else {
        done.skipped++;
        return; // 略過的留在收件匣，請同事補資料或丟棄
      }
      updateRowFields(SHEET_BOT_CARDS, byId[x.id].RowIndex, { Status: 'saved', Result: result + ' ' + todayStr(), Company: m.company, Name: m.name, Title: m.title, Phone: m.phone, CompanyPhone: m.companyPhone, Email: m.email, Address: m.address, TaxId: m.taxId, Website: m.website, Fax: m.fax, Note: m.note });
    } catch (e) {
      done.failed.push('#' + x.id + '：' + e.message);
    }
  });
  if (done.failed.length) throw new Error('有 ' + done.failed.length + ' 張存入失敗（' + done.failed.join('；') + '）；已成功的 ' + (done.newCustomers + done.contacts) + ' 張不會重複存入');
  return { action: w.action, ok: true, newCustomers: done.newCustomers, contactsAdded: done.contacts, skipped: done.skipped };
}

// ------------------------------------------------------------
// 名片客戶專區（網頁 nameCards.html）：同一個收件匣（BotCards）的網頁版，每個人看自己的名片。
// 列表一次看完整欄位 → 編輯修正 → 登入成客戶（公司已是客戶就新增為聯絡窗口）/ 建立案件 / 新增聯繫行事曆 / 刪除。
// LINE 傳來的名片要先把 LINE 綁定到網站帳號（BOT 設定 → 員工助理），名片才會歸到這個帳號底下。
// ------------------------------------------------------------
function nameCardMine_(body, id) {
  var me = body._user.username;
  var card = botCardRows_().filter(function (c) { return c.owner === me && c.id === Number(id); })[0];
  if (!card) throw new Error('找不到這張名片（可能已經被刪除）');
  return card;
}

function nameCardOut_(c, customerNames) {
  var o = { id: c.id, status: c.status, time: c.time, batch: c.batch, confidence: c.confidence, result: c.result };
  Object.keys(BOT_CARD_FIELDS).forEach(function (k) { o[k] = c[k]; });
  if (c.company) o.existingCustomer = customerNames[normCompanyName_(c.company)] || '';
  return o;
}

function handleGetNameCards(body) {
  var me = body._user.username;
  var names = {};
  sheetToObjects(SHEET_CUSTOMERS).rows.forEach(function (r) { names[normCompanyName_(r['CompanyName'])] = String(r['CompanyName']); });
  var rows = botCardRows_().filter(function (c) { return c.owner === me && (c.status === 'pending' || c.status === 'saved'); });
  rows.sort(function (a, b) { return b.id - a.id; });
  return {
    success: true,
    pending: rows.filter(function (c) { return c.status === 'pending'; }).length,
    saved: rows.filter(function (c) { return c.status === 'saved'; }).length,
    cards: rows.slice(0, 300).map(function (c) { return nameCardOut_(c, names); }),
  };
}

/** 手動修正名片欄位（辨識錯的地方）。只改這張名片的紀錄，不會動已經登入的客戶資料。 */
function handleCardUpdate(body) {
  return withLock_(function () {
    var card;
    try {
      card = nameCardMine_(body, body.id);
    } catch (e) {
      return { success: false, message: e.message };
    }
    if (card.status !== 'pending' && card.status !== 'saved') return { success: false, message: '這張名片已經不在專區裡了' };
    var f = body.fields || {};
    var patch = {};
    Object.keys(BOT_CARD_FIELDS).forEach(function (k) {
      if (f[k] === undefined || f[k] === null) return;
      var v = botCardClean_(f, k, k === 'note' || k === 'address' ? 200 : 80);
      if (k === 'email') v = v.toLowerCase();
      patch[BOT_CARD_FIELDS[k]] = v;
    });
    if (!Object.keys(patch).length) return { success: false, message: '沒有要修改的欄位' };
    var merged = { name: card.name, company: card.company, phone: card.phone, email: card.email };
    Object.keys(BOT_CARD_FIELDS).forEach(function (k) { if (patch[BOT_CARD_FIELDS[k]] !== undefined) merged[k] = patch[BOT_CARD_FIELDS[k]]; });
    if (!merged.name && !merged.company && !merged.phone && !merged.email) return { success: false, message: '姓名、公司、電話、Email 至少要留一項' };
    patch.Confidence = 'edited';
    updateRowFields(SHEET_BOT_CARDS, card.RowIndex, patch);
    return { success: true };
  });
}

/** 登入成客戶：公司還不是客戶 → 新增客戶；已經是客戶 → 新增為聯絡窗口。回傳這次做了什麼，前端據此提示。 */
function handleCardToCustomer(body) {
  var card;
  try {
    card = nameCardMine_(body, body.id);
  } catch (e) {
    return { success: false, message: e.message };
  }
  if (card.status === 'saved') return { success: false, message: '這張名片已經登入過了（' + card.result + '）' };
  if (card.status !== 'pending') return { success: false, message: '這張名片已經不在專區裡了' };
  var ov = {};
  if (body.company) ov.company = String(body.company);
  var ovAll = {};
  ovAll[card.id] = ov;
  var plan = botCardPlan_([card], ovAll, body.category)[0];
  if (plan.kind === 'skip') {
    return { success: false, needCompany: !botCardMerge_(card, ov).company, message: plan.text.replace(/^[⚠️・\s]+#\d+\s*/, '') };
  }
  var ctx = { ownerKey: body._user.username };
  try {
    botCardsRun_(ctx, { action: 'saveCards', data: { ids: [card.id], overrides: ovAll, category: body.category } }, body._user);
  } catch (e) {
    return { success: false, message: e.message };
  }
  var after = nameCardMine_(body, card.id);
  return { success: true, kind: plan.kind, company: after.company, result: after.result };
}

function handleCardDelete(body) {
  return withLock_(function () {
    var card;
    try {
      card = nameCardMine_(body, body.id);
    } catch (e) {
      return { success: false, message: e.message };
    }
    getSheet(SHEET_BOT_CARDS).deleteRow(card.RowIndex);
    return { success: true };
  });
}

// ------------------------------------------------------------
// 長期記憶：個人的（只有本人的助理知道）與全公司的（每個人的助理都知道）
// ------------------------------------------------------------
function botMemoryAll_() {
  return sheetToObjects(SHEET_BOT_MEMORY).rows.map(function (r, i) {
    return { RowIndex: i + 2, id: Number(r['ID']) || 0, scope: r['Scope'] === 'all' ? 'all' : 'user', owner: String(r['Owner'] || ''), category: String(r['Category'] || ''), content: String(r['Content'] || ''), importance: botInt_(r['Importance'], 1, 5, 3), updatedAt: String(r['UpdatedAt'] || '') };
  });
}

/** 這個人的助理帶著的記憶：全公司 + 自己的，依重要度、最近修改排序（上限 maxItems）。 */
function botMemoryFor_(ctx) {
  var max = botStaffCfg_().memory.maxItems;
  var items = botMemoryAll_().filter(function (m) { return m.scope === 'all' || m.owner === ctx.ownerKey; });
  items.sort(function (a, b) { return b.importance - a.importance || String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  return items.slice(0, Math.max(max, 1) * 3 > 300 ? 300 : max * 3).map(function (m) { return { id: m.id, scope: m.scope, category: m.category, content: m.content, importance: m.importance, updatedAt: m.updatedAt }; });
}

function botMemoryNextId_() {
  var max = 0;
  botMemoryAll_().forEach(function (m) { max = Math.max(max, m.id); });
  return max + 1;
}

/** 新增 / 修改 / 刪除一筆記憶（個人的只能動自己的；全公司的要有權限）。 */
function botMemoryWrite_(ctx, op) {
  var mode = String(op.mode || 'add');
  var scope = op.scope === 'all' ? 'all' : 'user';
  var cfg = botStaffCfg_().memory;
  if (scope === 'all' && !(cfg.canShared || blocksCanShare_(ctx))) throw new Error('只有有「BOT 設定」編輯權限的人（或管理員開放後）可以新增 / 修改全公司的記憶');
  var content = botClip_(op.content, 300);
  var category = BOT_MEMORY_CATEGORIES.indexOf(op.category) > -1 ? op.category : '其他';
  var importance = botInt_(op.importance, 1, 5, 3);
  if (mode === 'add') {
    if (!content) throw new Error('記憶內容不能空白');
    var mine = botMemoryAll_().filter(function (m) { return m.scope === scope && (scope === 'all' || m.owner === ctx.ownerKey); });
    if (mine.some(function (m) { return m.content === content; })) return { id: 0, duplicate: true };
    if (mine.length >= 200) throw new Error('記憶太多了（上限 200 筆），請先刪掉不需要的');
    var id = botMemoryNextId_();
    appendObjectRow(SHEET_BOT_MEMORY, { ID: id, Scope: scope, Owner: scope === 'all' ? '' : ctx.ownerKey, Category: category, Content: content, Importance: importance, UpdatedAt: botNow_() });
    return { id: id, content: content };
  }
  var target = botMemoryAll_().filter(function (m) { return m.id === Number(op.id); })[0];
  if (!target) throw new Error('找不到這筆記憶');
  if (target.scope === 'user' && target.owner !== ctx.ownerKey) throw new Error('這是別人的個人記憶');
  if (target.scope === 'all' && !(cfg.canShared || blocksCanShare_(ctx))) throw new Error('沒有權限修改全公司的記憶');
  if (mode === 'delete') {
    getSheet(SHEET_BOT_MEMORY).deleteRow(target.RowIndex);
    return { id: target.id, deleted: true };
  }
  if (!content) throw new Error('記憶內容不能空白');
  updateRowFields(SHEET_BOT_MEMORY, target.RowIndex, { Category: category, Content: content, Importance: importance, UpdatedAt: botNow_() });
  return { id: target.id, content: content };
}

// ------------------------------------------------------------
// BOT 設定頁（員工助理）
// ------------------------------------------------------------
function handleBotGetStaff(body) {
  var cfg = botStaffCfg_();
  var accounts = sheetToObjects(SHEET_USERS).rows.map(function (u) { return { username: String(u['Username']), name: String(u['DisplayName'] || u['Username']) }; });
  var names = {};
  accounts.forEach(function (a) { names[a.username] = a.name; });
  var members = botMemberRows_().map(function (m) {
    return {
      LineUserId: String(m['LineUserId']),
      DisplayName: String(m['DisplayName'] || ''),
      PictureUrl: String(m['PictureUrl'] || ''),
      Status: String(m['Status'] || BOT_STAFF_STATUS.PENDING),
      Role: String(m['Role'] || 'viewer'),
      PermsObj: cleanPerms_(m['Perms']),
      LinkedUsername: String(m['LinkedUsername'] || ''),
      LinkedName: m['LinkedUsername'] ? names[m['LinkedUsername']] || '（帳號已不存在）' : '',
      Note: String(m['Note'] || ''),
      PushDaily: m['PushDaily'] === true || String(m['PushDaily']).toUpperCase() === 'TRUE',
      IsFollowing: !(m['IsFollowing'] === false || String(m['IsFollowing']).toUpperCase() === 'FALSE'),
      FollowedAt: String(m['FollowedAt'] || ''),
      LastSeenAt: String(m['LastSeenAt'] || ''),
      ApprovedBy: String(m['ApprovedBy'] || ''),
    };
  });
  return {
    success: true,
    config: cfg,
    members: members,
    accounts: accounts,
    me: body._user.username,
    canLinkOthers: accessOf_(findUserRow_(body._user.username)).isAdmin,
    memory: botMemoryAll_(),
    memoryCategories: BOT_MEMORY_CATEGORIES,
    blocks: PERM_BLOCKS,
    writes: Object.keys(BOT_STAFF_WRITES).map(function (k) { return { key: k, label: BOT_STAFF_WRITES[k].label, block: BOT_STAFF_WRITES[k].block }; }),
  };
}

function handleBotSaveStaff(body) {
  return withLock_(function () {
    var cur = botCfg_('staff', {}) || {};
    var c = body.config || {};
    var next = Object.assign({}, cur);
    ['enabled', 'webEnabled'].forEach(function (k) { if (c[k] !== undefined) next[k] = c[k] === true; });
    ['welcome', 'pendingText', 'prompt'].forEach(function (k) { if (c[k] !== undefined) next[k] = String(c[k]).slice(0, 4000); });
    if (c.ceiling) next.ceiling = botStaffCeiling_(c.ceiling);
    if (Array.isArray(c.writes)) next.writes = botStaffWrites_(c.writes);
    if (c.hidePrice !== undefined) next.hidePrice = c.hidePrice === true;
    if (c.audit) next.audit = { enabled: c.audit.enabled !== false, reads: c.audit.reads !== false };
    if (c.push) next.push = Object.assign({}, cur.push || {}, { enabled: c.push.enabled === true, hour: botInt_(c.push.hour, 0, 23, 8) });
    if (c.memory) {
      var m = c.memory;
      next.memory = { enabled: m.enabled !== false, maxItems: botInt_(m.maxItems, 5, 100, 30), confirm: m.confirm !== false, canShared: m.canShared === true, auto: m.auto === true, autoEvery: botInt_(m.autoEvery, 2, 30, 6) };
    }
    botCfgSet_('staff', next);
    if (next.push && next.push.enabled) botInstallPushTrigger_();
    return { success: true, config: botStaffCfg_() };
  });
}

/** 儲存成員設定：{ lineUserId, status, role, perms, linkedUsername, note, pushDaily }（沒帶的欄位不改）。 */
function handleBotMemberSave(body) {
  return withLock_(function () {
    var m = botMemberFind_(String(body.lineUserId || ''));
    if (!m) return { success: false, message: '找不到這位成員' };
    var patch = {};
    if (body.status !== undefined) {
      var statuses = Object.keys(BOT_STAFF_STATUS).map(function (k) { return BOT_STAFF_STATUS[k]; });
      if (statuses.indexOf(body.status) < 0) return { success: false, message: '狀態不正確' };
      patch.Status = body.status;
      if (body.status === BOT_STAFF_STATUS.ACTIVE && m['Status'] !== BOT_STAFF_STATUS.ACTIVE) {
        patch.ApprovedBy = body._user.displayName || body._user.username;
        patch.ApprovedAt = botNow_();
      }
    }
    if (body.role !== undefined) {
      if (['editor', 'viewer', 'limited'].indexOf(body.role) < 0) return { success: false, message: '角色要是 編輯者 / 查看 / 特定' };
      patch.Role = body.role;
      var perms = body.role === 'limited' ? cleanPerms_(body.perms !== undefined ? body.perms : m['Perms']) : {};
      if (body.role === 'limited' && !Object.keys(perms).length) return { success: false, message: '「特定」至少要開放一個功能區塊' };
      patch.Perms = body.role === 'limited' ? JSON.stringify(perms) : '';
    }
    if (body.linkedUsername !== undefined) {
      var link = String(body.linkedUsername || '');
      if (link !== String(m['LinkedUsername'] || '')) {
        if (link && !findUserRow_(link)) return { success: false, message: '找不到網站帳號' };
        // 綁定別人的帳號 = 看得到那個人的個人備忘錄：只有系統管理員可以；其他人只能綁定自己的
        if (link && link !== body._user.username && !accessOf_(findUserRow_(body._user.username)).isAdmin) return { success: false, message: '🔐 只有系統管理員可以綁定其他人的網站帳號（你只能綁定自己的）' };
        patch.LinkedUsername = link;
      }
    }
    if (body.note !== undefined) patch.Note = botClip_(body.note, 300);
    if (body.pushDaily !== undefined) patch.PushDaily = body.pushDaily === true;
    updateRowFields(SHEET_BOT_MEMBERS, m.RowIndex, patch);
    // 開通 / 停用後，「新成員」通知就算處理完了
    if (patch.Status && patch.Status !== BOT_STAFF_STATUS.PENDING) botMemoDone_('botMember', m['LineUserId']);
    return { success: true };
  });
}

function botMemoDone_(linkType, linkId) {
  var sheet = getSheet(SHEET_MEMOS);
  var data = sheet.getDataRange().getValues();
  var h = data[0];
  var lt = h.indexOf('LinkType');
  var li = h.indexOf('LinkId');
  if (lt < 0 || li < 0) return;
  for (var i = data.length - 1; i >= 1; i--) if (data[i][lt] === linkType && String(data[i][li]) === String(linkId)) sheet.deleteRow(i + 1);
}

function handleBotMemberRemove(body) {
  return withLock_(function () {
    var m = botMemberFind_(String(body.lineUserId || ''));
    if (!m) return { success: false, message: '找不到這位成員' };
    getSheet(SHEET_BOT_MEMBERS).deleteRow(m.RowIndex);
    botMemoDone_('botMember', m['LineUserId']);
    botCacheRemove_([botStaffHistKey_(String(m['LineUserId'])), 'linep:' + m['LineUserId']]);
    return { success: true };
  });
}

function handleBotMemorySave(body) {
  var ctx = { ownerKey: body._user.username, access: accessOf_(findUserRow_(body._user.username)) };
  var d = body.data || {};
  try {
    // 後台新增的個人記憶歸「這個帳號」；全公司的不限
    var res = withLock_(function () { return botMemoryWrite_(ctx, d); });
    return { success: true, result: res };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function handleBotMemoryDelete(body) {
  var all = botMemoryAll_();
  var ids = {};
  (body.ids || []).forEach(function (x) { ids[Number(x)] = true; });
  return withLock_(function () {
    var n = 0;
    all.slice().sort(function (a, b) { return b.RowIndex - a.RowIndex; }).forEach(function (m) {
      if (ids[m.id]) {
        getSheet(SHEET_BOT_MEMORY).deleteRow(m.RowIndex);
        n++;
      }
    });
    return { success: true, deleted: n };
  });
}

// ------------------------------------------------------------
// 每日早報：每小時檢查一次，到設定的時間（台灣時間）通知機器人伺服器推播給勾了「每天推播早報」的成員
// ------------------------------------------------------------
function botInstallPushTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'botPushTick'; });
  if (!exists) ScriptApp.newTrigger('botPushTick').timeBased().everyHours(1).create();
}

function botPushTick() {
  var cfg = botStaffCfg_();
  if (!cfg.enabled || !cfg.push.enabled) return;
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, 'GMT+8', 'H'));
  var today = todayStr();
  if (hour !== cfg.push.hour || cfg.push.last === today) return;
  var c = botCfg_('staff', {}) || {};
  c.push = Object.assign({}, c.push || {}, { last: today });
  botCfgSet_('staff', c);
  botPushRequest_();
}

function botPushRequest_() {
  var url = botGeneral_().botUrl;
  var secret = botKey_('staff');
  if (!url || !secret) throw new Error('還沒有設定機器人網址或 Bot 金鑰');
  var res = UrlFetchApp.fetch(url.replace(/\/+$/, '') + '/api/push', { method: 'post', contentType: 'application/json', headers: { 'x-bot-secret': secret }, muteHttpExceptions: true, payload: '{}' });
  return { code: res.getResponseCode(), body: String(res.getContentText()).slice(0, 300) };
}

/** 按「立即推播一次」：馬上請機器人伺服器推播早報給勾選的成員（測試用）。 */
function handleBotPushNow(body) {
  try {
    var r = botPushRequest_();
    if (r.code < 200 || r.code >= 300) return { success: false, message: '機器人伺服器回應 ' + r.code + '：' + r.body };
    return { success: true, message: r.body };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** linebot 的 pushTargets：要推早報的成員編號。 */
function botPushTargets_() {
  return botMemberRows_()
    .filter(function (m) { return m['Status'] === BOT_STAFF_STATUS.ACTIVE && (m['PushDaily'] === true || String(m['PushDaily']).toUpperCase() === 'TRUE') && !(m['IsFollowing'] === false || String(m['IsFollowing']).toUpperCase() === 'FALSE'); })
    .map(function (m) { return String(m['LineUserId']); });
}

// ------------------------------------------------------------
// 網站智能助理（右下角）：同一個機器人，用登入帳號本人的權限
//   網站 → 這裡驗證登入、記下「W 編號 → 帳號」10 分鐘 → 轉給機器人伺服器 /api/web；機器人拿不到登入權杖，
//   只能用 W 編號回頭查詢（權限 = 這個網站帳號）。
// ------------------------------------------------------------
function handleBotAssistInfo(body) {
  var cfg = botStaffCfg_();
  var reason = '';
  if (!cfg.enabled) reason = '員工助理還沒有啟用';
  else if (!cfg.webEnabled) reason = '網站智能助理沒有開放';
  else if (!botGeneral_().botUrl) reason = '機器人伺服器（Vercel）還沒有連線';
  else if (!botKey_('staff')) reason = '還沒有產生員工助理金鑰';
  return { success: true, enabled: !reason, reason: reason };
}

function handleBotAssist(body) {
  var cfg = botStaffCfg_();
  if (!cfg.enabled || !cfg.webEnabled) return { success: false, message: '網站智能助理沒有開放' };
  var url = botGeneral_().botUrl;
  var secret = botKey_('staff');
  if (!url || !secret) return { success: false, message: '機器人還沒連線：請系統管理員到「BOT 設定 → 連線與設定」完成設定' };
  var id = botWebId_(body._user.username);
  botCachePut_('webid:' + id, body._user.username, 600);
  var payload = { secret: secret, id: id, text: String(body.text || '').slice(0, 1500), confirm: body.confirm === true ? true : body.confirm === false ? false : undefined, token: body.token || '', reset: body.reset === true, displayName: body._user.displayName || body._user.username };
  var res;
  try {
    res = UrlFetchApp.fetch(url.replace(/\/+$/, '') + '/api/web', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(payload) });
  } catch (e) {
    return { success: false, message: '連不上機器人伺服器，請稍後再試' };
  }
  var json = {};
  try {
    json = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    return { success: false, message: '機器人伺服器回應格式錯誤（' + res.getResponseCode() + '）' };
  }
  if (res.getResponseCode() !== 200) return { success: false, message: json.error || '機器人伺服器錯誤（' + res.getResponseCode() + '）' };
  return { success: true, reply: json.reply || '', choices: json.choices || [], pending: json.pending || null };
}

// ============================================================
// ===== 以下來自 Copy.gs =====
// ============================================================
/**
 * ============================================================
 * Copy.gs - 文案製作（選用模組）
 * ------------------------------------------------------------
 * 社群 / 長文文案：選平台與主題 → 確認提示詞 → AI 產生 → 套用、改寫、儲存。
 * 提示詞在瀏覽器組好（讓使用者看過、可微調才送出），這裡只負責：
 *   - 存文案（CopyPosts）、素材庫（CopyLibrary：人設 / 發文風格 / 固定結尾）、AI 學習風格與文案專用 AI 模型（CopyConfig）
 *   - 呼叫 AI（文案專用模型依序備援；沒設定就沿用「BOT 設定 → AI 模型」）
 *   - 匯入 CetusSalesAgent 發文助手的 settings.json / data.json
 * AI 的呼叫函式在 Bot.gs（botCallAi_），所以要跟 Bot.gs 一起貼上。
 * 權限區塊 copy：查看 = 看文案 / 素材（可複製）；編輯 = 產生、儲存、改素材；刪除只有系統管理員。
 * ============================================================
 */

var SHEET_COPY_POSTS = 'CopyPosts';
var SHEET_COPY_LIB = 'CopyLibrary';
var SHEET_COPY_CFG = 'CopyConfig';

var COPY_PLATFORMS = ['Threads', 'Instagram', 'Facebook', 'X', 'LINE', 'YouTube', '方格子'];
var COPY_STATUS = ['draft', 'scheduled', 'posted'];
var COPY_KINDS = ['prompt', 'style', 'ending'];
var COPY_EVENT_FIELDS = ['theme', 'host', 'cohost', 'address', 'landmark', 'promo'];
var COPY_MAX_PROMPT = 40000;
var COPY_CELL_MAX = 49000;

function copySchema_() {
  return {
    schema: {
      CopyPosts: ['ID', 'Platform', 'Topic', 'Keywords', 'Tone', 'Marketing', 'EventJson', 'Content', 'Note', 'Status', 'ScheduledFor', 'Liked', 'CreatedBy', 'CreatedAt', 'UpdatedAt'],
      CopyLibrary: ['ID', 'Kind', 'Name', 'Text', 'Platform', 'Enabled'],
      CopyConfig: ['Key', 'Value'],
    },
    text: { CopyPosts: ['ScheduledFor'], CopyLibrary: [], CopyConfig: [] },
  };
}

function copyPerms_() {
  return {
    copyGetData: ['copy', 'r'],
    copySavePost: ['copy', 'w'], copySetLiked: ['copy', 'w'], copyGenerate: ['copy', 'w'], copySaveLib: ['copy', 'w'], copyToggleLib: ['copy', 'w'],
    copyImport: ['copy', 'w'], copySaveStyle: ['copy', 'w'], copySaveModels: ['copy', 'w'], copyTestModel: ['copy', 'w'],
    copyDeletePost: ['copy', 'd'], copyDeleteLib: ['copy', 'd'],
  };
}

function copyRoutes_() {
  return {
    copyGetData: { auth: true, fn: handleCopyGetData },
    copySavePost: { auth: true, fn: handleCopySavePost },
    copySetLiked: { auth: true, fn: handleCopySetLiked },
    copyDeletePost: { auth: true, fn: handleCopyDeletePost },
    copyGenerate: { auth: true, fn: handleCopyGenerate },
    copySaveLib: { auth: true, fn: handleCopySaveLib },
    copyToggleLib: { auth: true, fn: handleCopyToggleLib },
    copyDeleteLib: { auth: true, fn: handleCopyDeleteLib },
    copyImport: { auth: true, fn: handleCopyImport },
    copySaveStyle: { auth: true, fn: handleCopySaveStyle },
    copySaveModels: { auth: true, fn: handleCopySaveModels },
    copyTestModel: { auth: true, fn: handleCopyTestModel },
  };
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------
function copyNow_() {
  return Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
}

function copyClip_(v, n) {
  var t = String(v == null ? '' : v);
  return t.length > n ? t.slice(0, n) : t;
}

function copyIsTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function copyCfgGet_(key, def) {
  var rows = sheetToObjects(SHEET_COPY_CFG).rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['Key'] === key) {
      try {
        var v = JSON.parse(String(rows[i]['Value'] || 'null'));
        return v === null || v === undefined ? def : v;
      } catch (e) {
        return def;
      }
    }
  }
  return def;
}

function copyCfgSet_(key, value) {
  withLock_(function () {
    var sheet = getSheet(SHEET_COPY_CFG);
    var data = sheet.getDataRange().getValues();
    var json = JSON.stringify(value);
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(json);
        return;
      }
    }
    appendObjectRow(SHEET_COPY_CFG, { Key: key, Value: json });
  });
}

function copyNextId_(sheetName) {
  var max = 0;
  sheetToObjects(sheetName).rows.forEach(function (r) {
    max = Math.max(max, Number(r['ID']) || 0);
  });
  return max + 1;
}

// ------------------------------------------------------------
// 文案
// ------------------------------------------------------------
function copyCleanEvent_(input) {
  var raw = input && typeof input === 'object' ? input : {};
  var schedule = (Array.isArray(raw.schedule) ? raw.schedule : [])
    .map(function (r) { return { date: copyClip_((r || {}).date, 40), time: copyClip_((r || {}).time, 40) }; })
    .slice(0, 31);
  var out = { schedule: schedule.length ? schedule : [{ date: '', time: '' }] };
  COPY_EVENT_FIELDS.forEach(function (k) { out[k] = copyClip_(raw[k], 200); });
  return out;
}

/** 整理一篇文案的輸入；回傳要寫進試算表的欄位。 */
function copyCleanPost_(p) {
  p = p || {};
  var platform = COPY_PLATFORMS.indexOf(p.platform) > -1 ? p.platform : 'Threads';
  var status = COPY_STATUS.indexOf(p.status) > -1 ? p.status : 'draft';
  var when = String(p.scheduled_for || '').slice(0, 10);
  var marketing = (Array.isArray(p.marketing) ? p.marketing : []).map(String).filter(function (k) { return /^[a-z]{2,12}$/.test(k); }).slice(0, 20);
  return {
    Platform: platform,
    Topic: copyClip_(p.topic, 2000),
    Keywords: copyClip_(p.keywords, 300),
    Tone: copyClip_(p.tone, 40),
    Marketing: marketing.join(','),
    EventJson: JSON.stringify(copyCleanEvent_(p.event)),
    Content: copyClip_(p.content, COPY_CELL_MAX),
    Note: copyClip_(p.note, 300),
    Status: status,
    ScheduledFor: /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : '',
  };
}

function copyPostOut_(r) {
  var ev;
  try {
    ev = copyCleanEvent_(JSON.parse(String(r['EventJson'] || '{}')));
  } catch (e) {
    ev = copyCleanEvent_({});
  }
  return {
    id: Number(r['ID']) || 0,
    platform: String(r['Platform'] || 'Threads'),
    topic: String(r['Topic'] || ''),
    keywords: String(r['Keywords'] || ''),
    tone: String(r['Tone'] || ''),
    marketing: String(r['Marketing'] || '').split(',').filter(Boolean),
    event: ev,
    content: String(r['Content'] || ''),
    note: String(r['Note'] || ''),
    status: COPY_STATUS.indexOf(r['Status']) > -1 ? r['Status'] : 'draft',
    scheduled_for: String(r['ScheduledFor'] || '').slice(0, 10),
    liked: copyIsTrue_(r['Liked']),
    created_by: String(r['CreatedBy'] || ''),
    created_at: String(r['CreatedAt'] || ''),
    updated_at: String(r['UpdatedAt'] || ''),
  };
}

function copyFindRow_(sheetName, id) {
  var rows = sheetToObjects(sheetName).rows;
  for (var i = 0; i < rows.length; i++) if (Number(rows[i]['ID']) === Number(id)) return { rowIndex: i + 2, row: rows[i] };
  return null;
}

function copyLibOut_(r) {
  return {
    id: Number(r['ID']) || 0,
    kind: COPY_KINDS.indexOf(r['Kind']) > -1 ? r['Kind'] : 'prompt',
    name: String(r['Name'] || ''),
    text: String(r['Text'] || ''),
    platform: String(r['Platform'] || ''),
    enabled: !(r['Enabled'] === false || String(r['Enabled']).toUpperCase() === 'FALSE'),
  };
}

function copyStyle_() {
  var s = copyCfgGet_('style', {}) || {};
  return { profile: String(s.profile || ''), enabled: s.enabled !== false, updatedAt: String(s.updatedAt || '') };
}

function handleCopyGetData(body) {
  var posts = sheetToObjects(SHEET_COPY_POSTS).rows.map(copyPostOut_);
  posts.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  var models = copyMaskedModels_();
  var botAvailable = typeof botAiList_ === 'function';
  var botUsing = botAvailable ? botAiList_().length : 0;
  return {
    success: true,
    posts: posts.slice(0, 300),
    total: posts.length,
    library: sheetToObjects(SHEET_COPY_LIB).rows.map(copyLibOut_),
    style: copyStyle_(),
    models: models,
    providers: typeof BOT_AI_PROVIDERS !== 'undefined' ? BOT_AI_PROVIDERS : {},
    aiReady: copyAiList_().length > 0,
    usingBotModels: models.length === 0 && botUsing > 0,
    botAvailable: botAvailable,
    today: todayStr(),
  };
}

function handleCopySavePost(body) {
  return withLock_(function () {
    var clean = copyCleanPost_(body.post);
    if (!clean.Content.trim() && !clean.Topic.trim()) return { success: false, message: '主題與內文都是空的' };
    var now = copyNow_();
    var id = Number(body.id) || 0;
    if (id) {
      var found = copyFindRow_(SHEET_COPY_POSTS, id);
      if (!found) return { success: false, message: '找不到這篇文案（可能已被刪除）' };
      clean.UpdatedAt = now;
      updateRowFields(SHEET_COPY_POSTS, found.rowIndex, clean);
      return { success: true, id: id };
    }
    id = copyNextId_(SHEET_COPY_POSTS);
    appendObjectRow(SHEET_COPY_POSTS, Object.assign({ ID: id, Liked: false, CreatedBy: body._user.username, CreatedAt: now, UpdatedAt: now }, clean));
    return { success: true, id: id };
  });
}

function handleCopySetLiked(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_POSTS, body.id);
    if (!found) return { success: false, message: '找不到這篇文案' };
    var liked = body.liked === true;
    if (liked && !String(found.row['Content'] || '').trim()) return { success: false, message: '內文是空的' };
    updateRowFields(SHEET_COPY_POSTS, found.rowIndex, { Liked: liked, UpdatedAt: copyNow_() });
    return { success: true, liked: liked };
  });
}

function handleCopyDeletePost(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_POSTS, body.id);
    if (!found) return { success: false, message: '找不到這篇文案' };
    getSheet(SHEET_COPY_POSTS).deleteRow(found.rowIndex);
    return { success: true };
  });
}

// ------------------------------------------------------------
// 素材庫
// ------------------------------------------------------------
function copyCleanLib_(it) {
  it = it || {};
  var kind = COPY_KINDS.indexOf(it.kind) > -1 ? it.kind : '';
  var name = copyClip_(String(it.name || '').trim(), 60);
  var text = copyClip_(String(it.text || '').trim(), 6000);
  if (!kind) throw new Error('素材類型不正確');
  if (!name) throw new Error('請輸入名稱');
  if (!text) throw new Error('內容不能空白');
  var platform = String(it.platform || '').trim();
  if (platform && platform !== '@social' && COPY_PLATFORMS.indexOf(platform) < 0) platform = '';
  return { Kind: kind, Name: name, Text: text, Platform: platform, Enabled: it.enabled !== false };
}

function handleCopySaveLib(body) {
  return withLock_(function () {
    var clean;
    try {
      clean = copyCleanLib_(body.item);
    } catch (e) {
      return { success: false, message: e.message };
    }
    var id = Number(body.id) || 0;
    if (id) {
      var found = copyFindRow_(SHEET_COPY_LIB, id);
      if (!found) return { success: false, message: '找不到這個素材' };
      updateRowFields(SHEET_COPY_LIB, found.rowIndex, clean);
      return { success: true, id: id };
    }
    id = copyNextId_(SHEET_COPY_LIB);
    appendObjectRow(SHEET_COPY_LIB, Object.assign({ ID: id }, clean));
    return { success: true, id: id };
  });
}

function handleCopyToggleLib(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_LIB, body.id);
    if (!found) return { success: false, message: '找不到這個素材' };
    updateRowFields(SHEET_COPY_LIB, found.rowIndex, { Enabled: body.enabled === true });
    return { success: true };
  });
}

function handleCopyDeleteLib(body) {
  return withLock_(function () {
    var found = copyFindRow_(SHEET_COPY_LIB, body.id);
    if (!found) return { success: false, message: '找不到這個素材' };
    getSheet(SHEET_COPY_LIB).deleteRow(found.rowIndex);
    return { success: true };
  });
}

/** 匯入發文助手的檔案：settings.json（prompts / styles / endings）或 data.json（文案陣列） */
function handleCopyImport(body) {
  return withLock_(function () {
    var text = String(body.json || '');
    if (!text) return { success: false, message: '沒有內容' };
    if (text.length > 5000000) return { success: false, message: '檔案太大（上限 5MB）' };
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { success: false, message: '檔案不是正確的 JSON' };
    }
    var now = copyNow_();
    if (Array.isArray(data)) {
      var rows = data.filter(function (p) { return p && typeof p === 'object' && (String(p.content || '').trim() || String(p.topic || '').trim()); }).slice(0, 500);
      if (!rows.length) return { success: false, message: '檔案裡沒有可匯入的文案' };
      var id = copyNextId_(SHEET_COPY_POSTS);
      rows.forEach(function (p) {
        var when = String(p.when || '').slice(0, 10);
        var clean = copyCleanPost_({ platform: p.platform, topic: p.topic, keywords: p.keywords, tone: p.tone, marketing: p.marketing, event: p.event, content: p.content, note: p.note, status: p.status, scheduled_for: when });
        appendObjectRow(SHEET_COPY_POSTS, Object.assign({ ID: id++, Liked: false, CreatedBy: body._user.username, CreatedAt: now, UpdatedAt: now }, clean));
      });
      return { success: true, message: '已匯入 ' + rows.length + ' 篇文案', count: rows.length };
    }
    if (!data || typeof data !== 'object' || (!data.prompts && !data.styles && !data.endings)) {
      return { success: false, message: '看不出這是發文助手的檔案（要有 prompts／styles／endings，或是文案陣列）' };
    }
    var have = {};
    sheetToObjects(SHEET_COPY_LIB).rows.forEach(function (r) { have[r['Kind'] + '|' + r['Name']] = true; });
    var nid = copyNextId_(SHEET_COPY_LIB);
    var added = 0;
    [['prompts', 'prompt'], ['styles', 'style'], ['endings', 'ending']].forEach(function (pair) {
      (Array.isArray(data[pair[0]]) ? data[pair[0]] : []).forEach(function (it) {
        if (added >= 200) return;
        var c;
        try {
          c = copyCleanLib_({ kind: pair[1], name: it && it.name, text: it && it.text, platform: it && it.platform, enabled: true });
        } catch (e) {
          return; // 格式不對的項目略過
        }
        if (have[c.Kind + '|' + c.Name]) return;
        have[c.Kind + '|' + c.Name] = true;
        appendObjectRow(SHEET_COPY_LIB, Object.assign({ ID: nid++ }, c));
        added++;
      });
    });
    if (!added) return { success: false, message: '沒有新的素材可匯入（名稱相同的會略過）' };
    return { success: true, message: '已匯入 ' + added + ' 個素材', count: added };
  });
}

// ------------------------------------------------------------
// AI 學習風格 / AI 模型
// ------------------------------------------------------------
function handleCopySaveStyle(body) {
  var s = copyStyle_();
  if (body.profile !== undefined) s.profile = copyClip_(body.profile, 3000);
  if (body.enabled !== undefined) s.enabled = body.enabled === true;
  s.updatedAt = copyNow_();
  copyCfgSet_('style', s);
  return { success: true, style: s };
}

function copyStoredModels_() {
  var m = copyCfgGet_('models', []);
  return Array.isArray(m) ? m : [];
}

function copyMaskedModels_() {
  var providers = typeof BOT_AI_PROVIDERS !== 'undefined' ? BOT_AI_PROVIDERS : {};
  return copyStoredModels_().map(function (m) {
    var def = providers[m.provider] || providers.gemini || { model: '' };
    return { provider: providers[m.provider] ? m.provider : 'gemini', model: String(m.model || ''), endpoint: String(m.endpoint || ''), hasKey: !!m.apiKey, keyHint: m.apiKey ? '••••' + String(m.apiKey).slice(-4) : '', defaultModel: def.model };
  });
}

/** 文案專用 AI 清單（含金鑰，只在伺服器內部用）；沒設定就沿用 BOT 設定的 AI。 */
function copyAiList_() {
  if (typeof BOT_AI_PROVIDERS === 'undefined') return [];
  var out = [];
  copyStoredModels_().forEach(function (m) {
    if (!m || !m.apiKey) return;
    var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
    var def = BOT_AI_PROVIDERS[provider];
    out.push({ source: 'copy', provider: provider, apiKey: String(m.apiKey), model: String(m.model || '').trim() || def.model, endpoint: String(m.endpoint || '').trim() || def.endpoint });
  });
  if (!out.length && typeof botAiList_ === 'function') return botAiList_('copy');
  return out;
}

function handleCopySaveModels(body) {
  if (typeof BOT_AI_PROVIDERS === 'undefined') return { success: false, message: '需要同時貼上 Bot.gs（AI 呼叫在那裡）' };
  return withLock_(function () {
    var old = copyStoredModels_();
    var models = [];
    (Array.isArray(body.models) ? body.models : []).slice(0, 5).forEach(function (m, i) {
      if (!m) return;
      var provider = BOT_AI_PROVIDERS[m.provider] ? m.provider : 'gemini';
      var key = String(m.apiKey || '').trim();
      if (!key && old[i] && old[i].provider === provider) key = old[i].apiKey || '';
      if (!key) return;
      var endpoint = String(m.endpoint || '').trim();
      if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error('Endpoint 要用 https:// 開頭');
      models.push({ provider: provider, apiKey: key, model: String(m.model || '').trim(), endpoint: endpoint });
    });
    copyCfgSet_('models', models);
    return { success: true, models: copyMaskedModels_() };
  });
}

function handleCopyTestModel(body) {
  var list = copyAiList_();
  var i = Number(body.index) || 0;
  if (!list.length) return { success: false, message: '還沒有設定 AI（或金鑰是空的）' };
  if (!list[i]) return { success: false, message: '沒有第 ' + (i + 1) + ' 個 AI 模型' };
  try {
    var t0 = Date.now();
    var text = botCallAi_(list[i], '你是測試助理，請用繁體中文只回覆兩個字：成功。', [{ role: 'user', text: '測試' }]);
    return { success: true, reply: text.slice(0, 100), ms: Date.now() - t0, model: list[i].model, provider: BOT_AI_PROVIDERS[list[i].provider].name };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** 送出瀏覽器組好（使用者確認過）的提示詞給 AI；依序備援，回傳文字與用到的模型。 */
function handleCopyGenerate(body) {
  var prompt = String(body.prompt || '').trim();
  if (!prompt) return { success: false, message: '缺少提示詞' };
  if (prompt.length > COPY_MAX_PROMPT) return { success: false, message: '提示詞太長（上限 ' + COPY_MAX_PROMPT + ' 字）' };
  if (typeof botCallAi_ !== 'function') return { success: false, message: '需要同時貼上 Bot.gs（AI 呼叫在那裡）' };
  var list = copyAiList_();
  if (!list.length) return { success: false, message: '還沒有設定 AI 模型：請到「文案製作 → AI 模型」（或「BOT 設定 → AI 模型」）填入 API Key' };
  var system = '你是專業的文案寫手。嚴格依照使用者提示詞的格式與限制輸出，使用繁體中文。';
  var failures = [];
  for (var i = 0; i < list.length; i++) {
    try {
      var text = botCallAi_(list[i], system, [{ role: 'user', text: prompt }], { maxTokens: 8000 });
      return { success: true, text: text, model: BOT_AI_PROVIDERS[list[i].provider].name + '／' + list[i].model, failures: failures };
    } catch (e) {
      failures.push(e.message);
    }
  }
  return { success: false, message: 'AI 都失敗了：' + failures.join('；').slice(0, 500) };
}

// ============================================================
// 開發名單庫（Prospects）
// 從政府公開資料（經濟部生產中工廠名錄等）、展覽名錄、自己整理的 CSV 匯入大量「潛在客戶」，
// 依產業分類 / 來源 / 縣市 / 開發狀態篩選，標記誰在開發。
// 資料量很大（單一來源就超過 10 萬筆），所以放在獨立的試算表「AOI開發名單庫」（ID 存在指令碼屬性 PROSPECT_SSID，
// 第一次匯入時自動建立），不佔用主資料庫的 1,000 萬格上限。
// 匯入由網頁把 CSV 切成小批（每批約 2,000 筆）送來；篩選、分頁、統計都在這裡做。
// ============================================================
var PS_SHEET = 'Prospects';
// 前 7 欄是「篩選用」：Source〜Has 連續放在一起，一次讀就好；Search 只有關鍵字搜尋時才讀。
var PS_COLS = ['Key', 'Source', 'City', 'CatCodes', 'Stage', 'Has', 'Search', 'Name', 'TaxId', 'RegNo', 'Address', 'Owner', 'Category', 'Products', 'Status', 'Org', 'Website', 'Phone', 'Email', 'Contact', 'Notes', 'Optout', 'AssignedTo', 'ImportedAt', 'UpdatedAt', 'Enriched', 'EnrichedAt', 'EnrichNote', 'ExtraContacts'];
var PS_STAGES = ['未處理', '開發中', '已聯絡', '有興趣', '無意願', '已轉客戶', '無效'];
var PS_MERGE_FIELDS = ['Address', 'Owner', 'Category', 'Products', 'Status', 'Org', 'Website', 'Phone', 'Email', 'Contact'];
var PS_IMPORT_MAX = 3000;
var PS_EXPORT_MAX = 5000;
var PS_CITIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'];
// 行政院主計總處「行業統計分類」製造業中類（經濟部工廠登記的產業類別就是這個代碼）
var PS_INDUSTRY = {
  '08': '食品製造業', '09': '飲料製造業', '10': '菸草製造業', '11': '紡織業', '12': '成衣及服飾品製造業', '13': '皮革、毛皮及其製品製造業',
  '14': '木竹製品製造業', '15': '紙漿、紙及紙製品製造業', '16': '印刷及資料儲存媒體複製業', '17': '石油及煤製品製造業', '18': '化學材料及肥料製造業',
  '19': '其他化學製品製造業', '20': '藥品及醫用化學製品製造業', '21': '橡膠製品製造業', '22': '塑膠製品製造業', '23': '非金屬礦物製品製造業',
  '24': '基本金屬製造業', '25': '金屬製品製造業', '26': '電子零組件製造業', '27': '電腦、電子產品及光學製品製造業', '28': '電力設備及配備製造業',
  '29': '機械設備製造業', '30': '汽車及其零件製造業', '31': '其他運輸工具及其零件製造業', '32': '家具製造業', '33': '其他製造業', '34': '產業用機械設備維修及安裝業',
};

function prospectPerms_() {
  return {
    prospectStatus: ['customers', 'r'], prospectQuery: ['customers', 'r'], prospectExport: ['customers', 'r'],
    prospectUpdate: ['customers', 'w'], prospectBulk: ['customers', 'w'], prospectImport: ['customers', 'w'],
    prospectEnrichPlan: ['customers', 'w'], prospectEnrich: ['customers', 'w'],
    prospectClear: ['admin', 'd'],
  };
}

function prospectRoutes_() {
  return {
    prospectStatus: { auth: true, fn: handleProspectStatus },
    prospectQuery: { auth: true, fn: handleProspectQuery },
    prospectExport: { auth: true, fn: handleProspectExport },
    prospectUpdate: { auth: true, fn: handleProspectUpdate },
    prospectBulk: { auth: true, fn: handleProspectBulk },
    prospectImport: { auth: true, fn: handleProspectImport },
    prospectEnrichPlan: { auth: true, fn: handleProspectEnrichPlan },
    prospectEnrich: { auth: true, fn: handleProspectEnrich },
    prospectClear: { auth: true, fn: handleProspectClear },
  };
}

// ---------- 儲存 ----------
function psSs_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PROSPECT_SSID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      if (!create) throw new Error('開發名單庫試算表打不開（可能被刪除或沒有權限）');
    }
  }
  if (!create) return null;
  var ss = SpreadsheetApp.create('AOI開發名單庫');
  props.setProperty('PROSPECT_SSID', ss.getId());
  return ss;
}

/** 取得名單分頁；create = true 時沒有就建立（含標題列、全欄純文字）。沒建立過又 create = false → null。 */
function psSheet_(create) {
  var ss = psSs_(create);
  if (!ss) return null;
  var sh = ss.getSheetByName(PS_SHEET);
  if (sh) return psEnsureShape_(sh);
  if (!create) return null;
  ['工作表1', 'Sheet1'].forEach(function (n) {
    var d = ss.getSheetByName(n);
    if (!sh && d && d.getLastRow() === 0) {
      d.setName(PS_SHEET);
      sh = d;
    }
  });
  if (!sh) sh = ss.insertSheet(PS_SHEET);
  if (sh.getMaxColumns() < PS_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), PS_COLS.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, PS_COLS.length).setValues([PS_COLS]).setFontWeight('bold').setBackground('#eef2f7');
  sh.setFrozenRows(1);
  // 統編、電話、登記編號都要純文字，不然開頭的 0 會被吃掉
  sh.getRange(1, 1, sh.getMaxRows(), PS_COLS.length).setNumberFormat('@');
  return sh;
}

/** 舊版建立的名單分頁（欄位比現在少）：補上新欄位的標題、欄數、純文字格式，已經匯入的資料不動。 */
function psEnsureShape_(sh) {
  var have = sh.getLastColumn();
  if (have >= PS_COLS.length) return sh;
  if (sh.getMaxColumns() < PS_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), PS_COLS.length - sh.getMaxColumns());
  var missing = PS_COLS.slice(have);
  sh.getRange(1, have + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#eef2f7');
  sh.getRange(1, have + 1, sh.getMaxRows(), missing.length).setNumberFormat('@');
  return sh;
}

function psCol_(name) {
  return PS_COLS.indexOf(name) + 1;
}

function psObj_(arr) {
  var o = {};
  PS_COLS.forEach(function (c, i) {
    o[c] = arr[i] == null ? '' : arr[i];
  });
  return o;
}

function psArr_(o) {
  return PS_COLS.map(function (c) {
    return o[c] == null ? '' : o[c];
  });
}

function psColVals_(sh, col, n) {
  return n < 1 ? [] : sh.getRange(2, col, n, 1).getValues().map(function (r) {
    return String(r[0]);
  });
}

/** 讀指定的列（列號陣列）。相鄰的列合併成一次讀取；太分散就整段一次讀。回傳 { 列號: 值陣列 }。 */
function psReadRows_(sh, rows) {
  var sorted = rows.slice().sort(function (a, b) { return a - b; }).filter(function (r, i, a) { return i === 0 || r !== a[i - 1]; });
  var out = {};
  if (!sorted.length) return out;
  var runs = [];
  sorted.forEach(function (r) {
    var last = runs[runs.length - 1];
    if (last && r - last.end <= 30) last.end = r;
    else runs.push({ start: r, end: r });
  });
  if (runs.length > 200) runs = [{ start: sorted[0], end: sorted[sorted.length - 1] }];
  var want = {};
  sorted.forEach(function (r) { want[r] = true; });
  runs.forEach(function (run) {
    var vals = sh.getRange(run.start, 1, run.end - run.start + 1, PS_COLS.length).getValues();
    vals.forEach(function (v, i) {
      if (want[run.start + i]) out[run.start + i] = v;
    });
  });
  return out;
}

// ---------- 欄位清理 / 衍生欄位 ----------
function psClean_(v, max, keepNewline) {
  var s = v == null ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F​﻿]/g, '');
  s = keepNewline ? s.replace(/[ \t　]+/g, ' ').replace(/\r\n?/g, '\n').trim() : s.replace(/[\s　]+/g, ' ').trim();
  return s.slice(0, max || 200);
}

/** 統一編號：8 碼數字（Excel 吃掉開頭 0 變 7 碼會補回）；不是就當作沒有。 */
function psTaxId_(v) {
  var s = String(v == null ? '' : v).replace(/\D/g, '');
  if (s.length === 7) s = '0' + s;
  return s.length === 8 ? s : '';
}

function psWebsite_(v) {
  var s = psClean_(v, 200).replace(/\s/g, '');
  if (!s) return '';
  if (/^[a-z][a-z0-9+.\-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return ''; // javascript: 之類的不收
  return s;
}

function psEmail_(v) {
  var s = psClean_(v, 120).split(/[;,，；\s]+/)[0].toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

function psCityOf_(address) {
  var a = String(address || '').replace(/^\d{3,6}\s*/, '').replace(/台/g, '臺').replace(/^桃園縣/, '桃園市');
  for (var i = 0; i < PS_CITIES.length; i++) if (a.indexOf(PS_CITIES[i]) === 0) return PS_CITIES[i];
  return '';
}

/** 產業類別文字 → [{code, name}]。工廠登記的格式是「29機械設備製造業、25金屬製品製造業」（代碼 2 碼開頭，名稱裡也可能有頓號）；其他來源是自由文字，用符號切開。 */
function psCatParse_(s) {
  s = String(s || '').replace(/　/g, ' ').trim();
  var out = [];
  var add = function (code, name) {
    if (code && out.every(function (o) { return o.code !== code; })) out.push({ code: code, name: name });
  };
  if (/^\d{2}/.test(s)) {
    (s.match(/\d{2}[^\d]*/g) || []).forEach(function (t) {
      add(t.slice(0, 2), t.slice(2).replace(/[、,，;；\s]+$/, '').trim());
    });
  } else {
    s.split(/[、,，;；\/／|]/).forEach(function (t) {
      t = t.trim().slice(0, 30);
      add(t, t);
    });
  }
  return out;
}

function psKey_(r) {
  if (r.RegNo) return 'R:' + r.RegNo;
  if (r.TaxId) return 'T:' + r.TaxId;
  return 'N:' + String(r.Name || '').toLowerCase();
}

/** 補齊衍生欄位：縣市、產業代碼、有無聯絡方式、搜尋文字、Key。 */
function psDerive_(r) {
  r.City = psCityOf_(r.Address) || r.City || '';
  r.CatCodes = psCatParse_(r.Category).map(function (c) { return c.code; }).join('|');
  r.Has = (r.Phone ? 'P' : '') + (r.Email ? 'E' : '') + (r.Website ? 'W' : '') + (r.Enriched ? 'C' : ''); // C = 已經查過官網 / 聯絡方式
  r.Search = [r.Name, r.TaxId, r.Owner, r.Products, r.Address, r.Phone, r.Email, r.Website, r.Contact].join(' ').toLowerCase().replace(/台/g, '臺').replace(/\s+/g, ' ').slice(0, 400);
  r.Key = psKey_(r);
  return r;
}

/** 匯入的一筆（前端已經把欄位對好英文名稱）→ 清理後的名單物件。沒有名稱就丟掉（回 null）。 */
function psIncoming_(o, source) {
  var r = {
    Name: psClean_(o.Name, 120), TaxId: psTaxId_(o.TaxId), RegNo: psClean_(o.RegNo, 30).replace(/\s/g, ''), Address: psClean_(o.Address, 200),
    Owner: psClean_(o.Owner, 60), Category: psClean_(o.Category, 300), Products: psClean_(o.Products, 400), Status: psClean_(o.Status, 40), Org: psClean_(o.Org, 40),
    Website: psWebsite_(o.Website), Phone: psClean_(o.Phone, 60), Email: psEmail_(o.Email), Contact: psClean_(o.Contact, 80), Notes: psClean_(o.Notes, 500, true),
    Source: source, Stage: '', Optout: '', AssignedTo: '',
  };
  if (!r.Name) return null;
  return r;
}

/** 把新資料合併進既有的一筆：預設只補「原本是空的」欄位；update = true 時有差異的欄位也更新。開發狀態 / 備註 / 指派 / 拒絕聯絡一律不動。回傳有沒有改變。 */
function psMergeInto_(ex, inc, update) {
  var changed = false;
  PS_MERGE_FIELDS.forEach(function (f) {
    if (inc[f] && (!ex[f] || (update && ex[f] !== inc[f]))) {
      ex[f] = inc[f];
      changed = true;
    }
  });
  if (!ex.RegNo && inc.RegNo) {
    ex.RegNo = inc.RegNo;
    changed = true;
  }
  if (!ex.TaxId && inc.TaxId) {
    ex.TaxId = inc.TaxId;
    changed = true;
  }
  if (update && inc.Name && ex.Name !== inc.Name && (!ex.RegNo || ex.RegNo === inc.RegNo)) {
    ex.Name = inc.Name;
    changed = true;
  }
  if (!ex.Notes && inc.Notes) {
    ex.Notes = inc.Notes;
    changed = true;
  }
  var srcs = String(ex.Source || '').split('、').filter(Boolean);
  if (srcs.indexOf(inc.Source) < 0) {
    srcs.push(inc.Source);
    ex.Source = srcs.join('、');
    changed = true;
  }
  return changed;
}

// ---------- 匯入 ----------
function handleProspectImport(body) {
  var rows = body.rows;
  if (!Array.isArray(rows) || !rows.length) return { success: false, message: '沒有要匯入的資料' };
  if (rows.length > PS_IMPORT_MAX) return { success: false, message: '一次最多匯入 ' + PS_IMPORT_MAX + ' 筆，請分批送' };
  var source = psClean_(body.source, 60).replace(/[、|]/g, ',');
  if (!source) return { success: false, message: '請填「來源」（例如：經濟部生產中工廠名錄）' };
  var update = !!body.update;
  return withLock_(function () {
    var sh = psSheet_(true);
    var last = sh.getLastRow();
    var n = Math.max(0, last - 1);
    var keyCol = psColVals_(sh, 1, n);
    var taxCol = psColVals_(sh, psCol_('TaxId'), n);
    var regCol = psColVals_(sh, psCol_('RegNo'), n);
    var keyMap = {};
    var taxFirst = {};
    var taxNoReg = {};
    for (var i = 0; i < n; i++) {
      keyMap[keyCol[i]] = i + 2;
      var t = taxCol[i];
      if (t) {
        if (!taxFirst[t]) taxFirst[t] = i + 2;
        if (!regCol[i] && !taxNoReg[t]) taxNoReg[t] = i + 2;
      }
    }
    var now = nowStr();
    var nextRow = last + 1;
    var firstNew = nextRow;
    var steps = []; // { row, rec, isNew }
    var invalid = 0;
    rows.forEach(function (o) {
      var rec = psIncoming_(o || {}, source);
      if (!rec) {
        invalid++;
        return;
      }
      psDerive_(rec);
      var target = keyMap[rec.Key];
      if (!target && rec.TaxId) target = rec.RegNo ? taxNoReg[rec.TaxId] : taxFirst[rec.TaxId];
      if (target) {
        steps.push({ row: target, rec: rec, isNew: false });
        return;
      }
      var row = nextRow++;
      keyMap[rec.Key] = row;
      if (rec.TaxId) {
        if (!taxFirst[rec.TaxId]) taxFirst[rec.TaxId] = row;
        if (!rec.RegNo && !taxNoReg[rec.TaxId]) taxNoReg[rec.TaxId] = row;
      }
      rec.ImportedAt = now;
      rec.UpdatedAt = now;
      steps.push({ row: row, rec: rec, isNew: true });
    });

    // 需要合併的既有列：一次讀進來
    var existingRows = steps.filter(function (s) { return !s.isNew && s.row < firstNew; }).map(function (s) { return s.row; });
    var read = psReadRows_(sh, existingRows);
    var objs = {};
    var added = 0;
    var merged = 0;
    var same = 0;
    var dupInBatch = 0;
    var changedRows = {};
    steps.forEach(function (s) {
      if (s.isNew) {
        objs[s.row] = s.rec;
        added++;
        return;
      }
      if (!objs[s.row]) objs[s.row] = psObj_(read[s.row]);
      var ex = objs[s.row];
      var changed = psMergeInto_(ex, s.rec, update);
      if (changed) {
        ex.UpdatedAt = now;
        psDerive_(ex);
      }
      if (s.row >= firstNew) {
        dupInBatch++; // 同一批裡重複的列：合併進同批的新列，最後一起寫，不算新增也不算更新
      } else if (changed) {
        if (!changedRows[s.row]) merged++;
        changedRows[s.row] = true;
      } else if (!changedRows[s.row]) {
        same++;
      }
    });

    if (nextRow > firstNew) {
      var data = [];
      for (var r = firstNew; r < nextRow; r++) data.push(psArr_(objs[r]));
      ensureRows_(sh, nextRow - 1);
      var range = sh.getRange(firstNew, 1, data.length, PS_COLS.length);
      range.setNumberFormat('@');
      range.setValues(data);
    }
    // 改過的既有列：相鄰的合併成一次寫入
    var rowsChanged = Object.keys(changedRows).map(Number).sort(function (a, b) { return a - b; });
    var i2 = 0;
    while (i2 < rowsChanged.length) {
      var j = i2;
      while (j + 1 < rowsChanged.length && rowsChanged[j + 1] === rowsChanged[j] + 1) j++;
      var block = [];
      for (var k = i2; k <= j; k++) block.push(psArr_(objs[rowsChanged[k]]));
      sh.getRange(rowsChanged[i2], 1, block.length, PS_COLS.length).setValues(block);
      i2 = j + 1;
    }
    PropertiesService.getScriptProperties().setProperty('PS_LAST_IMPORT', JSON.stringify({ time: now, source: source, by: (body._user && body._user.username) || '' }));
    return { success: true, added: added, merged: merged, same: same, invalid: invalid, duplicateInBatch: dupInBatch, total: Math.max(0, sh.getLastRow() - 1) };
  });
}

// ---------- 篩選 ----------
function psList_(v, max) {
  return (Array.isArray(v) ? v : []).map(function (x) { return String(x); }).filter(Boolean).slice(0, max || 60);
}

function psFilter_(b) {
  b = b || {};
  var q = String(b.q || '').toLowerCase().replace(/台/g, '臺').split(/\s+/).filter(Boolean).slice(0, 6);
  var has = String(b.has || '').replace(/[^PEW]/g, '');
  var assigned = b.assigned === 'me' || b.assigned === 'none' ? b.assigned : '';
  var site = b.site === 'unchecked' || b.site === 'checked' ? b.site : '';
  return { q: q, sources: psList_(b.sources), cities: psList_(b.cities), cats: psList_(b.cats), stages: psList_(b.stages), has: has, assigned: assigned, site: site };
}

function psSet_(arr) {
  var o = {};
  arr.forEach(function (x) { o[x] = true; });
  return o;
}

/**
 * 篩選 + 統計。scan = Source〜Has 五欄的值；search = 搜尋欄（沒有關鍵字就不用讀）；asg = 指派欄（沒用到就不用讀）。
 * 每個分面（來源 / 縣市 / 產業 / 狀態 / 聯絡方式）的數字 = 「套用其他所有條件、不含自己」的筆數，
 * 所以選了某個產業後，來源與縣市的數字會跟著變，但產業清單仍看得到其他產業有幾筆可選。
 * 一個迴圈、每列算 6 個條件：全過 → 計入所有分面；只有 1 個沒過 → 只計入那個沒過的分面。
 */
function psRun_(scan, search, asg, f, me) {
  var sSet = psSet_(f.sources), cSet = psSet_(f.cities), kSet = psSet_(f.cats), tSet = psSet_(f.stages);
  var fac = { source: {}, city: {}, cat: {}, stage: {}, has: {} };
  var hits = [];
  var bump = function (m, k) { m[k] = (m[k] || 0) + 1; };
  for (var i = 0; i < scan.length; i++) {
    var r = scan[i];
    var srcs = String(r[0]).split('、');
    var city = String(r[1]) || '未知';
    var cats = String(r[2]).split('|');
    var stage = String(r[3]) || PS_STAGES[0];
    var has = String(r[4]);
    var fl = [true, true, true, true, true, true]; // source, city, cat, stage, has, other(q / assigned)
    if (f.sources.length) fl[0] = srcs.some(function (x) { return sSet[x]; });
    if (f.cities.length) fl[1] = !!cSet[city];
    if (f.cats.length) fl[2] = cats.some(function (x) { return kSet[x]; });
    if (f.stages.length) fl[3] = !!tSet[stage];
    if (f.has) for (var h = 0; h < f.has.length; h++) if (has.indexOf(f.has.charAt(h)) < 0) fl[4] = false;
    if (f.site === 'unchecked' && has.indexOf('C') > -1) fl[4] = false;
    if (f.site === 'checked' && has.indexOf('C') < 0) fl[4] = false;
    if (f.q.length) {
      var text = String(search[i]);
      for (var t = 0; t < f.q.length; t++) if (text.indexOf(f.q[t]) < 0) fl[5] = false;
    }
    if (f.assigned && fl[5]) {
      var who = String(asg[i]);
      fl[5] = f.assigned === 'me' ? who === me : !who;
    }
    var miss = 0, which = -1;
    for (var k = 0; k < 6; k++) if (!fl[k]) { miss++; which = k; }
    if (miss > 1 || (miss === 1 && which === 5)) continue;
    if (miss === 0) hits.push(i);
    if (miss === 0 || which === 0) srcs.forEach(function (x) { if (x) bump(fac.source, x); });
    if (miss === 0 || which === 1) bump(fac.city, city);
    if (miss === 0 || which === 2) cats.forEach(function (x) { if (x) bump(fac.cat, x); });
    if (miss === 0 || which === 3) bump(fac.stage, stage);
    if (miss === 0 || which === 4) for (var p = 0; p < has.length; p++) bump(fac.has, has.charAt(p));
  }
  return { hits: hits, facets: fac };
}

function psFacetList_(m, order) {
  var list = Object.keys(m).map(function (k) { return { v: k, n: m[k] }; });
  if (order) list.sort(function (a, b) { return order.indexOf(a.v) - order.indexOf(b.v); });
  else list.sort(function (a, b) { return b.n - a.n || (a.v < b.v ? -1 : 1); });
  return list;
}

/** 依篩選條件讀表、算出符合的列（陣列索引，0 = 第 2 列）與各分面統計。 */
function psMatch_(sh, body) {
  var f = psFilter_(body);
  var n = Math.max(0, sh.getLastRow() - 1);
  if (!n) return { f: f, n: 0, hits: [], facets: { source: {}, city: {}, cat: {}, stage: {}, has: {} } };
  var scan = sh.getRange(2, 2, n, 5).getValues();
  var search = f.q.length ? psColVals_(sh, psCol_('Search'), n) : null;
  var me = String((body._user && body._user.username) || '');
  var asg = f.assigned ? psColVals_(sh, psCol_('AssignedTo'), n) : null;
  var res = psRun_(scan, search, asg, f, me);
  res.f = f;
  res.n = n;
  return res;
}

function psOut_(arr, rowNum) {
  var o = psObj_(arr);
  delete o.Search;
  o.RowIndex = rowNum;
  o.Stage = o.Stage || PS_STAGES[0];
  return o;
}

// ---------- 查詢 / 狀態 ----------
function handleProspectStatus(body) {
  var sh = psSheet_(false);
  var last = {};
  try {
    last = JSON.parse(PropertiesService.getScriptProperties().getProperty('PS_LAST_IMPORT') || '{}');
  } catch (e) {
    last = {};
  }
  var eq = psEnrichQuota_();
  var out = { success: true, ready: !!sh, total: sh ? Math.max(0, sh.getLastRow() - 1) : 0, stages: PS_STAGES, industry: PS_INDUSTRY, last: last, enrich: { source: psEnrichSource_(), limit: eq.limit, used: eq.used } };
  try {
    var u = sh && body._user ? findUserRow_(body._user.username) : null;
    if (u && u['Role'] === 'admin' && sh.getParent) out.url = sh.getParent().getUrl(); // 只給系統管理員看試算表連結
  } catch (e) {
    // 取不到連結不影響狀態查詢
  }
  return out;
}

function handleProspectQuery(body) {
  var sh = psSheet_(false);
  var empty = { success: true, ready: !!sh, total: 0, all: 0, page: 1, pages: 1, rows: [], facets: { source: [], city: [], cat: [], stage: [], has: [] }, industry: PS_INDUSTRY, stages: PS_STAGES };
  if (!sh || sh.getLastRow() < 2) return empty;
  var res = psMatch_(sh, body);
  var size = Math.min(100, Math.max(10, Math.floor(Number(body.size)) || 30));
  var pages = Math.max(1, Math.ceil(res.hits.length / size));
  var page = Math.min(pages, Math.max(1, Math.floor(Number(body.page)) || 1));
  var rowNums = res.hits.slice((page - 1) * size, page * size).map(function (i) { return i + 2; });
  var read = psReadRows_(sh, rowNums);
  return {
    success: true, ready: true, all: res.n, total: res.hits.length, page: page, pages: pages, size: size,
    rows: rowNums.map(function (r) { return psOut_(read[r], r); }),
    facets: {
      source: psFacetList_(res.facets.source),
      city: psFacetList_(res.facets.city),
      cat: psFacetList_(res.facets.cat).sort(function (a, b) { return a.v < b.v ? -1 : a.v > b.v ? 1 : 0; }),
      stage: psFacetList_(res.facets.stage, PS_STAGES),
      has: psFacetList_(res.facets.has),
    },
    industry: PS_INDUSTRY, stages: PS_STAGES,
  };
}

function handleProspectExport(body) {
  var sh = psSheet_(false);
  if (!sh || sh.getLastRow() < 2) return { success: false, message: '名單庫還是空的' };
  var res = psMatch_(sh, body);
  var take = res.hits.slice(0, PS_EXPORT_MAX).map(function (i) { return i + 2; });
  var read = psReadRows_(sh, take);
  return { success: true, total: res.hits.length, exported: take.length, truncated: res.hits.length > take.length, rows: take.map(function (r) { return psOut_(read[r], r); }) };
}

// ---------- 修改 ----------
/** 負責業務：前端送 '@me' 代表「我」，由伺服器換成登入帳號（畫面上的顯示名稱不一定等於帳號）。 */
function psAssignee_(v, body) {
  var s = psClean_(v, 40);
  return s === '@me' ? String((body._user && body._user.username) || '') : s;
}

var PS_EDITABLE = { Stage: 1, Notes: 1, Website: 1, Phone: 1, Email: 1, Contact: 1, Optout: 1, AssignedTo: 1 };

function psCheckStage_(v) {
  var s = psClean_(v, 20);
  if (s && PS_STAGES.indexOf(s) < 0) throw new Error('開發狀態只能是：' + PS_STAGES.join('、'));
  return s === PS_STAGES[0] ? '' : s;
}

function handleProspectUpdate(body) {
  var f = body.fields || {};
  return withLock_(function () {
    var sh = psSheet_(false);
    if (!sh) return { success: false, message: '名單庫還是空的' };
    var key = String(body.key || '');
    if (!key) return { success: false, message: '缺少名單編號' };
    var row = Math.floor(Number(body.row)) || 0;
    var arr = row >= 2 ? psReadRows_(sh, [row])[row] : null;
    if (!arr || String(arr[0]) !== key) {
      // 列號可能因為別人刪除 / 排序而變了：用 Key 重新找
      var n = Math.max(0, sh.getLastRow() - 1);
      var idx = psColVals_(sh, 1, n).indexOf(key);
      if (idx < 0) return { success: false, message: '找不到這筆名單（可能已被刪除），請重新整理' };
      row = idx + 2;
      arr = psReadRows_(sh, [row])[row];
    }
    var o = psObj_(arr);
    try {
      Object.keys(f).forEach(function (k) {
        if (!PS_EDITABLE[k]) return;
        var v = f[k];
        if (k === 'Stage') o.Stage = psCheckStage_(v);
        else if (k === 'Notes') o.Notes = psClean_(v, 500, true);
        else if (k === 'Website') o.Website = psWebsite_(v);
        else if (k === 'Email') {
          var em = String(v || '').trim();
          o.Email = psEmail_(em);
          if (em && !o.Email) throw new Error('Email 格式不正確');
        } else if (k === 'Optout') o.Optout = v ? 'Y' : '';
        else if (k === 'AssignedTo') o.AssignedTo = psAssignee_(v, body);
        else o[k] = psClean_(v, k === 'Phone' ? 60 : 80);
      });
    } catch (e) {
      return { success: false, message: e.message };
    }
    o.UpdatedAt = nowStr();
    psDerive_(o);
    sh.getRange(row, 1, 1, PS_COLS.length).setValues([psArr_(o)]);
    return { success: true, row: psOut_(psArr_(o), row) };
  });
}

/** 一次改很多筆（勾選的，或是「符合目前篩選的全部」）的開發狀態 / 指派 / 拒絕聯絡。用整欄讀寫，十萬筆也只要幾秒。 */
function handleProspectBulk(body) {
  var set = body.set || {};
  var upd = {};
  try {
    if (set.Stage !== undefined) upd.Stage = psCheckStage_(set.Stage);
    if (set.AssignedTo !== undefined) upd.AssignedTo = psAssignee_(set.AssignedTo, body);
    if (set.Optout !== undefined) upd.Optout = set.Optout ? 'Y' : '';
  } catch (e) {
    return { success: false, message: e.message };
  }
  if (!Object.keys(upd).length) return { success: false, message: '沒有要修改的欄位' };
  return withLock_(function () {
    var sh = psSheet_(false);
    if (!sh || sh.getLastRow() < 2) return { success: false, message: '名單庫還是空的' };
    var n = sh.getLastRow() - 1;
    var hits;
    if (Array.isArray(body.keys)) {
      var keys = psSet_(psList_(body.keys, 3000));
      hits = [];
      psColVals_(sh, 1, n).forEach(function (k, i) {
        if (keys[k]) hits.push(i);
      });
    } else {
      var fb = Object.assign({}, body.filter || {}, { _user: body._user });
      hits = psMatch_(sh, fb).hits;
    }
    if (!hits.length) return { success: true, count: 0 };
    var stamp = nowStr();
    Object.keys(upd).concat(['UpdatedAt']).forEach(function (c) {
      var range = sh.getRange(2, psCol_(c), n, 1);
      var vals = range.getValues();
      hits.forEach(function (i) {
        vals[i][0] = c === 'UpdatedAt' ? stamp : upd[c];
      });
      range.setValues(vals);
    });
    return { success: true, count: hits.length };
  });
}

function handleProspectClear(body) {
  if (String(body.confirm || '') !== 'CLEAR') return { success: false, message: '請輸入確認文字 CLEAR' };
  return withLock_(function () {
    var sh = psSheet_(false);
    if (!sh || sh.getLastRow() < 2) return { success: true, removed: 0 };
    var removed = sh.getLastRow() - 1;
    sh.getRange(2, 1, removed, PS_COLS.length).clearContent();
    var keep = 21;
    if (sh.getMaxRows() > keep) sh.deleteRows(keep + 1, sh.getMaxRows() - keep);
    PropertiesService.getScriptProperties().deleteProperty('PS_LAST_IMPORT');
    return { success: true, removed: removed };
  });
}

// ------------------------------------------------------------
// 找官網 + 抓聯絡方式
// 流程（每家公司）：沒有官網 → 用 Google Places（有設金鑰）或 Gemini 搜尋找 → 打開首頁確認真的是這家公司 →
// 看 robots.txt 允許才爬 → 首頁 + 最多 3 個「聯絡我們 / 關於我們」頁面 → 抓公開的 Email 與電話 → 寫回名單。
// 只讀公開頁面，不登入、不填表單、不繞過任何限制；人工填過的 Email / 電話 / 官網不會被覆蓋。
// 設定（指令碼屬性，可在 Apps Script「專案設定」修改）：
//   GOOGLE_PLACES_API_KEY  有的話優先用 Google Places 找官網（比較準，同時給電話）；沒有就用 Gemini 搜尋
//   PS_ENRICH_DAILY        每天最多查幾家（預設 1500，0 = 不限）
// ------------------------------------------------------------
var PS_ENRICH_DAILY_DEFAULT = 1500;
var PS_ENRICH_BATCH_MS = 22000; // 一次請求最多處理這麼久，剩下的交給前端下一次
var PS_FETCH_UA = 'Mozilla/5.0 (compatible; AOI-Sales-Research/1.0; public-contact-lookup)';
var PS_SITE_BLOCKLIST = ['facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'twitter.com', 'x.com', 'line.me', '104.com.tw', '1111.com.tw', 'yes123.com.tw', '518.com.tw', 'pcsc.com.tw', 'twincn.com', 'findcompany.com.tw', 'opencorporates.com', 'biznet.com.tw', 'taiwanyellowpages.com', 'yellowpages.com.tw', 'google.com', 'goo.gl', 'wikipedia.org', 'twse.com.tw', 'gcis.nat.gov.tw', 'moea.gov.tw', 'taiwantrade.com', 'alibaba.com', 'made-in-china.com', 'globalsources.com', 'ec21.com', 'kompass.com', 'mobile01.com', 'ptt.cc', 'pixnet.net', 'blogspot.com', 'wordpress.com', 'shopee.tw', 'ruten.com.tw', 'momoshop.com.tw'];
var PS_EMAIL_JUNK_DOMAINS = ['example.com', 'example.org', 'domain.com', 'email.com', 'yourdomain.com', 'yoursite.com', 'sentry.io', 'wixpress.com', 'schema.org', 'w3.org', 'googleusercontent.com', 'gstatic.com'];
var PS_EMAIL_ROLE_RE = /^(sales|info|service|contact|support|marketing|business|order|cs|inquiry|enquiry|hello|office|rfq|quote)/i;
// 不適合寄業務開發信的信箱：人資、福委會、投資人關係、個資、系統信 → 排到最後
var PS_EMAIL_AVOID_RE = /(^|[._\-])(hr|job|jobs|recruit|career|careers|welfare|ir|investor|stock|privacy|dpo|abuse|noreply|no-reply|donotreply|webmaster|postmaster)([._\-]|@|$)/i;

/** 公司名稱去掉「股份有限公司、工廠、一廠」之類，剩下用來比對網頁內容的核心字。太短就用原名。 */
function psCoreName_(name) {
  var s = String(name || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[一二三四五六七八九十\d]+廠$/, '');
  s = s.replace(/股份有限公司|有限責任|有限公司|無限公司|股份|企業社|工業社|實業社|商行|工廠|公司/g, '').replace(/[廠行社]$/, '').trim();
  return s.length >= 2 ? s : String(name || '').trim();
}

function psHost_(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** 搜尋結果的網址 → 官網首頁（只留 http(s) 與網域）；是目錄 / 社群 / 電商 / 政府網站就回空字串。 */
function psNormalizeSite_(url) {
  var s = String(url || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return '';
    s = 'http://' + s;
  }
  var m = s.match(/^(https?:\/\/[^\/?#]+)/i);
  if (!m) return '';
  var host = psHost_(m[1]);
  if (!host || host.indexOf('.') < 0) return '';
  if (PS_SITE_BLOCKLIST.some(function (b) { return host === b || host.slice(-b.length - 1) === '.' + b; })) return '';
  return m[1].toLowerCase();
}

function psDecodeEntities_(t) {
  return String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&amp;/gi, '&');
}

function psHtmlText_(html) {
  return psDecodeEntities_(String(html || '').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\n ]+/g, ' ');
}

/** Cloudflare 的「電子郵件保護」：data-cfemail="十六進位" 用第一個位元組當金鑰 XOR。 */
function psCfDecode_(hex) {
  var key = parseInt(hex.substr(0, 2), 16);
  var out = '';
  for (var i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
  return out;
}

function psEmailOk_(e) {
  if (e.length > 80 || e.length < 6) return false;
  var at = e.lastIndexOf('@');
  var local = e.slice(0, at);
  var domain = e.slice(at + 1);
  if (/\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf)$/i.test(domain)) return false;
  if (PS_EMAIL_JUNK_DOMAINS.some(function (d) { return domain === d || domain.slice(-d.length - 1) === '.' + d; })) return false;
  if (/^(your|name|user|email|username|example|test|xxx+|abc)$/i.test(local)) return false;
  return /^[a-z0-9._%+\-]+$/.test(local) && /^[a-z0-9.\-]+\.[a-z]{2,}$/.test(domain);
}

/** 從網頁抓公開的 Email：mailto 連結、一般文字、[at] 寫法、Cloudflare 保護。回傳小寫、去重的陣列。 */
function psExtractEmails_(html) {
  var h = String(html || '').slice(0, 400000);
  var found = [];
  var add = function (e) {
    e = String(e || '').toLowerCase().replace(/^mailto:/, '').replace(/[.,;:)>\]]+$/, '');
    if (psEmailOk_(e) && found.indexOf(e) < 0) found.push(e);
  };
  (h.match(/data-cfemail="([0-9a-f]+)"/gi) || []).forEach(function (m) {
    add(psCfDecode_(m.replace(/.*"([0-9a-f]+)"/i, '$1')));
  });
  var text = psDecodeEntities_(h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' '));
  text = text.replace(/[＠]/g, '@').replace(/\s*[\[\(（]\s*(?:at|AT|@)\s*[\]\)）]\s*/g, '@').replace(/\s*[\[\(（]\s*(?:dot|DOT)\s*[\]\)）]\s*/g, '.');
  (text.match(/mailto:\s*([^"'?\s<>]+)/gi) || []).forEach(function (m) { add(decodeURIComponent(m.replace(/^mailto:\s*/i, '')).split(',')[0]); });
  (text.match(/[a-z0-9._%+\-]+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}/gi) || []).forEach(add);
  return found;
}

/** 台灣電話格式化：手機 09xx-xxx-xxx；市話 02 / 03 / 04… 區碼 + 號碼；0800 免付費。不合規格回空字串。 */
function psPhoneFormat_(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (/^886/.test(d)) d = '0' + d.slice(3).replace(/^0/, '');
  if (/^09\d{8}$/.test(d)) return d.slice(0, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7);
  if (/^0800\d{6}$/.test(d)) return d.slice(0, 4) + '-' + d.slice(4, 7) + '-' + d.slice(7);
  // 市話：02、04 可以是 8 碼號碼（共 10 碼），其他區碼（03、05、06、07、08、037、049…）共 9 碼
  if (/^0[2-8]\d{7}$/.test(d) || /^0[24]\d{8}$/.test(d)) return d.slice(0, 2) + '-' + d.slice(2);
  return '';
}

/** 從網頁文字抓台灣電話（略過傳真）。tel: 連結優先。回傳格式化、去重的陣列。 */
function psExtractPhones_(html) {
  var h = String(html || '').slice(0, 400000);
  var out = [];
  var add = function (raw) {
    var f = psPhoneFormat_(raw);
    if (f && out.indexOf(f) < 0) out.push(f);
  };
  (h.match(/href=["']tel:([^"']+)["']/gi) || []).forEach(function (m) {
    add(decodeURIComponent(m.replace(/^href=["']tel:/i, '').replace(/["']$/, '')));
  });
  var text = psHtmlText_(h);
  var re = /(?<![\d])(?:\+886[-\s]?\(?0?\)?|\(?0)\d[\d\-\s()]{6,14}\d(?![\d])/g;
  var m;
  while ((m = re.exec(text))) {
    var before = text.slice(Math.max(0, m.index - 8), m.index);
    if (/傳真|傳 真|fax|FAX|Fax|F\s*[:：]/.test(before)) continue; // 傳真不是電話
    add(m[0]);
  }
  return out;
}

/** 頁面裡的連結 → [{url, score}]：同網域、看起來是「聯絡我們 / 關於我們」的才留下，分數高的優先。 */
function psContactLinks_(html, origin) {
  var host = psHost_(origin);
  var seen = {};
  var out = [];
  var re = /<a\s[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  var h = String(html || '').slice(0, 400000);
  while ((m = re.exec(h))) {
    var href = psDecodeEntities_(m[1]).trim();
    var label = psHtmlText_(m[2]).trim().slice(0, 40);
    if (/^(mailto|tel|javascript):/i.test(href) || /\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|pptx?)(\?|$)/i.test(href)) continue;
    var url;
    if (/^https?:\/\//i.test(href)) url = href;
    else if (href.indexOf('//') === 0) url = 'http:' + href;
    else if (href.charAt(0) === '/') url = origin + href;
    else url = origin + '/' + href.replace(/^\.\//, '');
    if (psHost_(url) !== host) continue;
    var score = 0;
    if (/contact|聯絡|聯繫|聯係|連絡/i.test(href + ' ' + label)) score += 3;
    if (/about|關於|公司簡介|company|inquiry|詢價|詢問|客服|support|據點|location/i.test(href + ' ' + label)) score += 1;
    if (!score) continue;
    var key = url.replace(/\/+$/, '').toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ url: url, score: score });
  }
  return out.sort(function (a, b) { return b.score - a.score; });
}

/** robots.txt：這個站允不允許爬這些路徑。解析 User-agent: * 的 Disallow / Allow（最長比對優先）。 */
function psRobotsAllows_(robotsTxt, path) {
  var lines = String(robotsTxt || '').split(/\r?\n/);
  var applies = false;
  var rules = [];
  var inGroup = false;
  lines.forEach(function (ln) {
    ln = ln.replace(/#.*/, '').trim();
    var m = ln.match(/^([A-Za-z\-]+)\s*:\s*(.*)$/);
    if (!m) return;
    var k = m[1].toLowerCase();
    var v = m[2].trim();
    if (k === 'user-agent') {
      if (!inGroup) applies = false;
      if (v === '*') applies = true;
      inGroup = true;
    } else {
      inGroup = false;
      if (applies && (k === 'disallow' || k === 'allow')) rules.push({ allow: k === 'allow', path: v });
    }
  });
  var best = null;
  rules.forEach(function (r) {
    if (!r.path) return;
    if (path.indexOf(r.path) === 0 && (!best || r.path.length >= best.path.length)) best = r;
  });
  return best ? best.allow : true;
}

/** 讀網頁文字：優先 UTF-8；老網站常見 Big5（標頭或 meta 有寫）就用 Big5 解。失敗回 null。 */
function psFetchPage_(url) {
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': PS_FETCH_UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.5' } });
    return psPageFromResponse_(res);
  } catch (e) {
    return null;
  }
}

function psPageFromResponse_(res) {
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) return null;
  var text = res.getContentText();
  var head = String(text || '').slice(0, 3000);
  var ct = '';
  try {
    ct = String((res.getHeaders() || {})['Content-Type'] || '');
  } catch (e) {
    ct = '';
  }
  if ((/big5/i.test(ct) || /<meta[^>]+charset=["']?big5/i.test(head)) && typeof res.getContent === 'function') {
    try {
      return Utilities.newBlob(res.getContent()).getDataAsString('Big5');
    } catch (e) {
      // 解不開就用原本的文字
    }
  }
  return text;
}

/** 用 Google Places（Text Search）找官網與電話。回傳 { url, phone, name } 或 null；API 錯誤丟出。 */
function psPlacesFind_(rec, key) {
  var q = String(rec.Name) + ' ' + String(rec.Address || rec.City || '');
  var res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber' },
    payload: JSON.stringify({ textQuery: q.slice(0, 200), languageCode: 'zh-TW', regionCode: 'TW', maxResultCount: 3 }),
  });
  var code = res.getResponseCode();
  var body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (code < 200 || code >= 300) throw new Error('Google Places 錯誤：' + String((body.error && body.error.message) || 'HTTP ' + code).split(key).join('••••').slice(0, 200));
  var core = psCoreName_(rec.Name);
  var places = body.places || [];
  for (var i = 0; i < places.length; i++) {
    var p = places[i];
    var title = String((p.displayName && p.displayName.text) || '');
    if (title && (title.indexOf(core) > -1 || core.indexOf(psCoreName_(title)) > -1) && p.websiteUri) {
      return { url: p.websiteUri, phone: p.nationalPhoneNumber || '', name: title };
    }
  }
  return null;
}

/** 用 Gemini + Google 搜尋找官網。回傳網址字串（可能是空字串）；沒有可用的 Gemini 設定或 API 錯誤丟出。 */
function psGeminiFind_(rec) {
  var cfg = botAiList_().filter(function (m) { return m.provider === 'gemini'; })[0];
  if (!cfg) throw new Error('找官網需要 Google Places 金鑰（指令碼屬性 GOOGLE_PLACES_API_KEY），或在「BOT 設定 → AI 模型」設定 Gemini');
  var prompt = '請用 Google 搜尋，找出台灣這家公司的「官方網站」：\n公司名稱：' + rec.Name + (rec.TaxId ? '\n統一編號：' + rec.TaxId : '') + (rec.Address ? '\n地址：' + rec.Address : '') + (rec.Products ? '\n主要產品：' + String(rec.Products).slice(0, 80) : '') +
    '\n\n只能回答公司自己的網站首頁（不要人力銀行、黃頁、公司資料庫、社群網站、電商平台）。找不到或不確定就回空字串，不要猜。\n只輸出一行 JSON：{"website":"https://...","reason":"一句話"}';
  var url = String(cfg.endpoint).replace(/\/+$/, '') + '/models/' + encodeURIComponent(cfg.model) + ':generateContent';
  var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': cfg.apiKey }, payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }) });
  var code = res.getResponseCode();
  var body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (code < 200 || code >= 300) throw new Error('Gemini 搜尋錯誤：' + String((body.error && body.error.message) || 'HTTP ' + code).split(cfg.apiKey).join('••••').slice(0, 200));
  var text = ((((body.candidates || [])[0] || {}).content || {}).parts || []).map(function (p) { return p.text || ''; }).join('');
  var m = text.match(/\{[\s\S]*?\}/);
  if (!m) return '';
  try {
    return String(JSON.parse(m[0]).website || '');
  } catch (e) {
    return '';
  }
}

/** 今天（台灣時間）已查幾家 / 上限。每天自動歸零。 */
function psEnrichQuota_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('PS_ENRICH_DAILY');
  var limit = raw === null || raw === '' ? PS_ENRICH_DAILY_DEFAULT : Math.max(0, Math.floor(Number(raw)) || 0);
  var day = todayStr();
  var used = 0;
  try {
    var o = JSON.parse(props.getProperty('PS_ENRICH_USED') || '{}');
    if (o.day === day) used = Number(o.n) || 0;
  } catch (e) {
    used = 0;
  }
  return { limit: limit, used: used, day: day, left: limit === 0 ? Infinity : Math.max(0, limit - used) };
}

function psEnrichCount_(n) {
  var q = psEnrichQuota_();
  PropertiesService.getScriptProperties().setProperty('PS_ENRICH_USED', JSON.stringify({ day: q.day, n: q.used + n }));
}

/**
 * 查一家公司，回傳要寫回的欄位與結果摘要（不碰試算表）。
 * rec = 目前這一列的物件。結果 status：ok（有官網且抓到聯絡方式）/ nocontact（有官網但沒抓到）/ nosite（找不到或不確定是官網）/ blocked（網站不讓爬）/ error（網路或 API 錯誤）。
 */
function psEnrichCompany_(rec) {
  var out = { status: 'nosite', note: '', website: '', emails: [], phones: [], fill: {} };
  var key = PropertiesService.getScriptProperties().getProperty('GOOGLE_PLACES_API_KEY');
  var site = psNormalizeSite_(rec.Website);
  var trustedByPlaces = false;
  var placesPhone = '';
  var hadSite = !!site;
  try {
    if (!site && !key && psEnrichSource_() === 'none') {
      out.note = '還沒有設定搜尋方式（BOT 設定裡的 Gemini，或指令碼屬性 GOOGLE_PLACES_API_KEY），沒有官網的公司無法自動找';
      return out;
    }
    if (!site) {
      if (key) {
        var p = psPlacesFind_(rec, key);
        if (p) {
          site = psNormalizeSite_(p.url);
          trustedByPlaces = !!site;
          placesPhone = p.phone;
        }
      } else {
        site = psNormalizeSite_(psGeminiFind_(rec));
      }
      if (!site) {
        out.note = '搜尋沒有找到可信的官網';
        return out;
      }
    }
    var host = psHost_(site);
    // robots.txt：不允許就不爬
    var robots = psFetchPage_(site + '/robots.txt');
    if (robots !== null && !psRobotsAllows_(robots, '/')) {
      out.status = 'blocked';
      out.note = '網站 robots.txt 不允許自動讀取：' + host;
      if (!hadSite && trustedByPlaces) out.fill.Website = site;
      return out;
    }
    var home = psFetchPage_(site + '/');
    if (home === null) home = psFetchPage_(site);
    if (home === null) {
      out.status = 'error';
      out.note = '打不開網站：' + host;
      return out;
    }
    // 確認是這家公司（找官網的來源是搜尋時才需要；原本就有的官網是人填的，直接信任）
    var homeText = psHtmlText_(home).toLowerCase();
    var core = psCoreName_(rec.Name).toLowerCase();
    var verified = hadSite || trustedByPlaces || homeText.indexOf(core) > -1 || (rec.TaxId && homeText.indexOf(String(rec.TaxId)) > -1);
    if (!verified) {
      out.note = '疑似官網但頁面沒有出現公司名稱，未採用：' + site;
      return out;
    }
    if (!hadSite) out.fill.Website = site;
    out.website = site;
    // 聯絡頁（最多 3 個），平行讀取
    var pages = [home];
    var links = psContactLinks_(home, site).filter(function (l) { return psRobotsAllows_(robots || '', l.url.replace(/^https?:\/\/[^\/]+/i, '') || '/'); }).slice(0, 3);
    if (links.length) {
      try {
        UrlFetchApp.fetchAll(links.map(function (l) { return { url: l.url, muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': PS_FETCH_UA } }; })).forEach(function (r) {
          var t = psPageFromResponse_(r);
          if (t) pages.push(t);
        });
      } catch (e) {
        // 聯絡頁讀不到就只用首頁
      }
    }
    var emails = [];
    var phones = placesPhone ? [psPhoneFormat_(placesPhone) || placesPhone] : [];
    pages.forEach(function (pg) {
      psExtractEmails_(pg).forEach(function (e) { if (emails.indexOf(e) < 0) emails.push(e); });
      psExtractPhones_(pg).forEach(function (t) { if (phones.indexOf(t) < 0) phones.push(t); });
    });
    // 排序：同網域的信箱優先，其次是 sales / info 這類業務窗口
    emails.sort(function (a, b) {
      var sa = (psHost_('http://' + a.split('@')[1]) === host ? 2 : 0) + (PS_EMAIL_ROLE_RE.test(a) ? 1 : 0) - (PS_EMAIL_AVOID_RE.test(a) ? 5 : 0);
      var sb = (psHost_('http://' + b.split('@')[1]) === host ? 2 : 0) + (PS_EMAIL_ROLE_RE.test(b) ? 1 : 0) - (PS_EMAIL_AVOID_RE.test(b) ? 5 : 0);
      return sb - sa;
    });
    // 電話：公司總機（市話）優先，其次免付費，手機最後（手機常是個人的）
    var phoneRank = function (t) { return /^09/.test(t) ? 2 : /^0800/.test(t) ? 1 : 0; };
    phones = phones.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) { return phoneRank(a.t) - phoneRank(b.t) || a.i - b.i; }).map(function (x) { return x.t; });
    out.emails = emails.slice(0, 5);
    out.phones = phones.slice(0, 3);
    out.status = out.emails.length || out.phones.length ? 'ok' : 'nocontact';
    out.note = (hadSite ? '' : (trustedByPlaces ? 'Google Places 找到：' : '搜尋找到：')) + host + '（讀了 ' + pages.length + ' 頁）' + (out.status === 'nocontact' ? '，沒有找到公開的 Email 或電話' : '');
    return out;
  } catch (e) {
    out.status = 'error';
    out.note = String(e.message || e).slice(0, 160);
    return out;
  }
}

/** 把查詢結果套到名單物件：只補空白欄位（人工填過的 Email / 電話 / 官網不動），其餘信箱電話放「其他聯絡方式」。 */
function psApplyEnrich_(o, res) {
  if (res.fill.Website && !o.Website) o.Website = res.fill.Website;
  var extraE = res.emails.slice();
  var extraP = res.phones.slice();
  if (!o.Email && extraE.length) o.Email = extraE.shift();
  else extraE = extraE.filter(function (e) { return e !== o.Email; });
  if (!o.Phone && extraP.length) o.Phone = extraP.shift();
  else extraP = extraP.filter(function (p) { return p !== o.Phone; });
  var parts = [];
  if (extraE.length) parts.push('信箱：' + extraE.join('、'));
  if (extraP.length) parts.push('電話：' + extraP.join('、'));
  if (parts.length) o.ExtraContacts = parts.join('｜').slice(0, 300);
  o.Enriched = res.status;
  o.EnrichedAt = nowStr();
  o.EnrichNote = res.note.slice(0, 200);
  o.UpdatedAt = o.EnrichedAt;
  psDerive_(o);
  return o;
}

function psEnrichSource_() {
  if (PropertiesService.getScriptProperties().getProperty('GOOGLE_PLACES_API_KEY')) return 'places';
  return botAiList_().some(function (m) { return m.provider === 'gemini'; }) ? 'gemini' : 'none';
}

/** 規劃要查哪些：勾選的（keys）或符合篩選的全部（filter），預設只查「還沒查過」的、排除拒絕聯絡的。回傳 [{key,row,name}]。 */
function handleProspectEnrichPlan(body) {
  var sh = psSheet_(false);
  if (!sh || sh.getLastRow() < 2) return { success: false, message: '名單庫還是空的' };
  var n = sh.getLastRow() - 1;
  var onlyNew = body.onlyNew !== false;
  var limit = Math.min(500, Math.max(1, Math.floor(Number(body.limit)) || 100));
  var hits;
  if (Array.isArray(body.keys)) {
    var want = psSet_(psList_(body.keys, 3000));
    var keysCol = psColVals_(sh, 1, n);
    var hasCol = sh.getRange(2, psCol_('Has'), n, 1).getValues();
    hits = [];
    keysCol.forEach(function (k, i) {
      if (want[k] && !(onlyNew && String(hasCol[i][0]).indexOf('C') > -1)) hits.push(i);
    });
  } else {
    var f = Object.assign({}, body.filter || {}, { _user: body._user });
    if (onlyNew) f.site = 'unchecked';
    hits = psMatch_(sh, f).hits;
  }
  var total = hits.length;
  var rowNums = hits.slice(0, limit * 2).map(function (i) { return i + 2; });
  var read = psReadRows_(sh, rowNums);
  var items = [];
  rowNums.forEach(function (r) {
    var o = psObj_(read[r]);
    if (o.Optout || items.length >= limit) return;
    items.push({ key: o.Key, row: r, name: o.Name });
  });
  var q = psEnrichQuota_();
  return { success: true, items: items, matched: total, source: psEnrichSource_(), quota: { limit: q.limit, used: q.used, left: q.left === Infinity ? -1 : q.left } };
}

/** 實際查一小批（前端每次送 3 家左右）；單次請求有時間上限，沒處理完的回 remaining 讓前端再送。 */
function handleProspectEnrich(body) {
  var items = (Array.isArray(body.items) ? body.items : []).slice(0, 10);
  if (!items.length) return { success: false, message: '沒有要查的公司' };
  var src = psEnrichSource_();
  var t0 = Date.now();
  var results = [];
  var i = 0;
  for (; i < items.length; i++) {
    if (i > 0 && Date.now() - t0 > PS_ENRICH_BATCH_MS) break;
    var q = psEnrichQuota_();
    if (q.left <= 0) return { success: true, results: results, remaining: items.slice(i), quotaReached: true, quota: { limit: q.limit, used: q.used } };
    var it = items[i];
    var row = Math.floor(Number(it.row)) || 0;
    var arr = row >= 2 ? psReadRows_(psSheet_(false), [row])[row] : null;
    if (!arr || String(arr[0]) !== String(it.key)) {
      results.push({ key: it.key, name: it.name, status: 'error', note: '找不到這筆名單（可能已被刪除或列號變了），請重新整理' });
      continue;
    }
    var rec = psObj_(arr);
    var res = psEnrichCompany_(rec); // 網路請求在鎖外面做，不卡住其他人
    psEnrichCount_(1);
    // 寫回時重新讀一次（這段時間別人可能改過），只補空白欄位
    withLock_(function () {
      var sh = psSheet_(false);
      var cur = psReadRows_(sh, [row])[row];
      if (!cur || String(cur[0]) !== String(it.key)) return;
      var o = psApplyEnrich_(psObj_(cur), res);
      sh.getRange(row, 1, 1, PS_COLS.length).setValues([psArr_(o)]);
      results.push({ key: o.Key, name: o.Name, status: res.status, note: res.note, website: o.Website, email: o.Email, phone: o.Phone, extra: o.ExtraContacts });
    });
  }
  var q2 = psEnrichQuota_();
  return { success: true, results: results, remaining: items.slice(i), source: src, quota: { limit: q2.limit, used: q2.used } };
}
