/**
 * ============================================================
 * demo.js - 示範模式(DEMO_MODE = true)用的假後端
 * ------------------------------------------------------------
 * 所有資料都存在瀏覽器的 localStorage，不會真的連 Google 試算表。
 * 每一頁都會載入這支檔案，因為每一頁的 callApi() 都可能在示範模式下
 * 呼叫到這裡。正式串接後端後(DEMO_MODE = false)，這支檔案完全不會被用到。
 * ============================================================
 */

const DEMO_DB_KEY = 'aoi_demo_db';

function loadDemoDB() {
  const saved = localStorage.getItem(DEMO_DB_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (!parsed.staff) parsed.staff = []; // 相容舊版本存的示範資料庫
    if (!parsed.devices) parsed.devices = [];
    if (!parsed.customerContacts) parsed.customerContacts = [];
    if (!parsed.users) parsed.users = [];
    return parsed;
  }

  const initial = {
    products: [
      { InternalModel: 'AOI-CAM-001', SupplierModel: 'SUP-XA100', Supplier: '供應商A', SupplierContact: '王小姐', SupplierContactEmail: 'demo@example.com', Origin: '台灣', Category: '相機', CompatibleGroup: 'G1', RefPrice: 15000, Notes: '' },
      { InternalModel: 'AOI-LENS-001', SupplierModel: 'SUP-XA100-LENS', Supplier: '供應商A', SupplierContact: '王小姐', SupplierContactEmail: 'demo@example.com', Origin: '日本', Category: '光源', CompatibleGroup: 'G1', RefPrice: 5000, Notes: '需搭配 AOI-CAM-001' },
      { InternalModel: 'AOI-LIGHT-010', SupplierModel: 'SUP-LB50', Supplier: '供應商B', SupplierContact: '陳先生', SupplierContactEmail: 'demo2@example.com', Origin: '台灣', Category: '調光器', CompatibleGroup: 'G2', RefPrice: 8000, Notes: '' },
    ],
    priceHistory: [
      { Date: '2026-08-20', ProductInternalModel: 'AOI-CAM-001', Supplier: '供應商A', Price: 14500, Currency: 'TWD', CaseID: '', Notes: '上次詢價' },
    ],
    cases: [],
    customers: [],
    contactLogs: [],
    staff: [],
    devices: [],
    customerContacts: [],
    users: [],
  };
  localStorage.setItem(DEMO_DB_KEY, JSON.stringify(initial));
  return initial;
}

function saveDemoDB(db) {
  localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
}

function demoCaseId() {
  return 'C' + Date.now();
}

/** 示範模式的「產生文件」：html 格式回傳真的 HTML；pdf/docx 格式回傳純文字說明取代。 */
function demoDocResult(filenamePrefix, format, textSummary) {
  if (format === 'html') {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filenamePrefix}</title></head><body><pre>${textSummary}</pre></body></html>`;
    return { success: true, filename: filenamePrefix + '.html', mimeType: 'text/html', base64: btoa(unescape(encodeURIComponent(html))) };
  }
  const ext = format === 'docx' ? '_demo.txt（示範模式不產生真的docx）' : '_demo.txt（示範模式不產生真的pdf）';
  return { success: true, filename: filenamePrefix + ext, mimeType: 'text/plain', base64: btoa(unescape(encodeURIComponent(textSummary))) };
}

function handleDemoApi(action, params) {
  const db = loadDemoDB();

  switch (action) {
    case 'login': {
      if (params.username === '0000' && params.password === '0000') {
        // 示範模式也模擬「記住這台裝置」，方便測試免密碼自動登入的畫面效果（裝置清單存在本機瀏覽器）
        if (params.deviceId) {
          db.devices = db.devices || [];
          const exist = db.devices.find((d) => d.DeviceId === params.deviceId);
          if (exist) exist.DeviceLabel = params.deviceLabel || exist.DeviceLabel;
          else db.devices.push({ DeviceId: params.deviceId, Username: '0000', DeviceLabel: params.deviceLabel || '', TokenHash: 'demo-device-token', CreatedDate: new Date().toISOString().slice(0, 10), LastSeenDate: new Date().toISOString().slice(0, 10) });
          saveDemoDB(db);
        }
        return { success: true, token: 'demo-token', username: '0000', displayName: '0000（示範帳號）', role: 'admin', deviceToken: params.deviceId ? 'demo-device-token' : undefined };
      }
      return { success: false, message: '示範模式僅接受帳密 0000 / 0000' };
    }

    case 'resumeSession': {
      const device = (db.devices || []).find((d) => d.DeviceId === params.deviceId && d.TokenHash === params.deviceToken);
      if (!device) return { success: false, message: '這台裝置的登入紀錄已被移除，請重新輸入帳密登入' };
      return { success: true, token: 'demo-token', username: '0000', displayName: '0000（示範帳號）', role: 'admin' };
    }

    case 'logoutDevice': {
      db.devices = (db.devices || []).filter((d) => d.DeviceId !== params.deviceId);
      saveDemoDB(db);
      return { success: true };
    }

    case 'getDevices':
      return { success: true, devices: (db.devices || []).map((d, i) => Object.assign({ RowIndex: i }, d)) };

    case 'removeDevice': {
      db.devices = (db.devices || []).filter((_, i) => i !== params.rowIndex);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 產品 CRUD ----------------
    case 'searchProducts': {
      const keyword = (params.keyword || '').toLowerCase();
      const products = db.products
        .filter((p) => !keyword || Object.values(p).join(' ').toLowerCase().includes(keyword))
        .map((p) => Object.assign({}, p, { InquiryCount: db.priceHistory.filter((h) => h.ProductInternalModel === p.InternalModel).length }));
      return { success: true, products };
    }

    case 'getProduct': {
      const product = db.products.find((p) => p.InternalModel === params.internalModel);
      if (!product) return { success: false, message: '查無此產品' };
      const compatibleProducts = db.products.filter((p) => p.CompatibleGroup === product.CompatibleGroup && p.InternalModel !== product.InternalModel);
      const history = db.priceHistory
        .map((h, i) => Object.assign({ RowIndex: i }, h))
        .filter((h) => h.ProductInternalModel === params.internalModel)
        .sort((a, b) => new Date(b.Date) - new Date(a.Date));
      return { success: true, product, compatibleProducts, priceHistory: history, lastPrice: history[0] || null };
    }

    case 'addProduct': {
      if (db.products.some((p) => p.InternalModel === params.internalModel)) {
        return { success: false, message: '此內部型號已存在，如要修改請用「修改」功能' };
      }
      db.products.push({
        InternalModel: params.internalModel,
        SupplierModel: params.supplierModel || '',
        Supplier: params.supplier || '',
        SupplierContact: params.supplierContact || '',
        SupplierContactEmail: params.supplierContactEmail || '',
        Origin: params.origin || '',
        Category: params.category || '',
        CompatibleGroup: params.compatibleGroup || '',
        RefPrice: params.refPrice || '',
        Notes: params.notes || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateProduct': {
      const p = db.products.find((p) => p.InternalModel === params.internalModel);
      if (!p) return { success: false, message: '查無此產品' };
      Object.assign(p, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'getSoftware':
      return { success: true, software: (db.software || []).map((x, i) => ({ RowIndex: i, Name: x.Name })) };

    case 'addSoftware': {
      db.software = db.software || [];
      const n = String(params.name || '').trim();
      if (!n) return { success: false, message: '軟體名稱不能空白' };
      const exists = db.software.some((x) => x.Name.toLowerCase() === n.toLowerCase());
      if (!exists) db.software.push({ Name: n });
      saveDemoDB(db);
      return { success: true, added: !exists };
    }

    case 'deleteSoftware':
      (db.software || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };

    // ---------------- 個人化：常用型號 / 常用網站 / 備忘錄 / 行事曆 ----------------
    case 'getFavorites':
      return { success: true, favorites: db.favorites || [] };

    case 'toggleFavorite': {
      db.favorites = db.favorites || [];
      const i = db.favorites.indexOf(params.internalModel);
      if (i > -1) db.favorites.splice(i, 1);
      else db.favorites.push(params.internalModel);
      saveDemoDB(db);
      return { success: true, favorite: i === -1 };
    }

    case 'getShortcuts':
      return { success: true, shortcuts: db.shortcuts || [] };

    case 'saveShortcuts': {
      db.shortcuts = (params.shortcuts || [])
        .filter((s) => s.Url)
        .map((s) => ({ Title: s.Title || s.Url, Url: /^https?:\/\//i.test(s.Url) ? s.Url : 'https://' + s.Url, OpenOnStart: !!s.OpenOnStart }));
      saveDemoDB(db);
      return { success: true, count: db.shortcuts.length };
    }

    case 'getMemos':
      return { success: true, memos: (db.memos || []).map((m, i) => Object.assign({ RowIndex: i, IsMine: true, OwnerName: '我' }, m)) };

    case 'addMemo': {
      db.memos = db.memos || [];
      const t = new Date().toISOString().slice(0, 10);
      db.memos.push({ Title: params.title || '', Content: params.content || '', Shared: !!params.shared, CreatedDate: t, LastUpdated: t });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateMemo': {
      const m = (db.memos || [])[params.rowIndex];
      if (!m) return { success: false, message: '查無此備忘錄' };
      Object.assign(m, params.fields || {}, { LastUpdated: new Date().toISOString().slice(0, 10) });
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteMemo':
      (db.memos || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };

    case 'getCalendarEvents':
      return { success: true, events: [{ Id: 'demo1', Title: '（示範）拜訪客戶', Start: new Date().toISOString().slice(0, 10) + 'T14:00', End: '', AllDay: false, Location: '' }] };

    case 'importCatalogProducts':
      return { success: true, added: 0, missingInternal: 0, message: '示範模式不會真的讀取型錄，正式模式才會匯入。' };

    case 'deleteProduct': {
      db.products = db.products.filter((p) => p.InternalModel !== params.internalModel);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 價格紀錄 CRUD ----------------
    case 'getPriceHistory': {
      const history = db.priceHistory
        .map((h, i) => Object.assign({ RowIndex: i }, h))
        .filter((h) => h.ProductInternalModel === params.internalModel);
      return { success: true, history };
    }

    case 'addPriceRecord': {
      db.priceHistory.push({
        Date: new Date().toISOString().slice(0, 10),
        ProductInternalModel: params.internalModel,
        Supplier: params.supplier || '',
        Price: params.price || '',
        Currency: 'TWD',
        CaseID: params.caseId || '',
        Notes: params.notes || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updatePriceRecord': {
      const rec = db.priceHistory[params.rowIndex];
      if (!rec) return { success: false, message: '查無此紀錄' };
      Object.assign(rec, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deletePriceRecord': {
      db.priceHistory.splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 詢價信 ----------------
    case 'generateInquiryDraft': {
      const productResult = handleDemoApi('getProduct', { internalModel: params.internalModel });
      if (!productResult.success) return productResult;
      const p = productResult.product;
      const lastPrice = productResult.lastPrice;
      const subject = `詢價 - ${p.InternalModel} / ${p.SupplierModel}`;
      const body =
        (p.SupplierContact ? p.SupplierContact + ' 您好，\n\n' : '您好，\n\n') +
        `想請教以下產品報價：\n供應商型號: ${p.SupplierModel}\n對應內部型號: ${p.InternalModel}\n` +
        (lastPrice ? `上次報價紀錄: ${lastPrice.Price} ${lastPrice.Currency}（${lastPrice.Date}）\n` : '') +
        `需求數量: ${params.quantity || '請提供'}\n\n麻煩協助報價，謝謝！`;
      return { success: true, subject, body, draftUrl: null };
    }

    case 'createGmailDraft':
      return { success: true, message: '示範模式不會真的建立 Gmail 草稿', draftUrl: null };

    // ---------------- 案件 CRUD ----------------
    case 'createCase': {
      if (!params.customerName) return { success: false, message: '請先選擇客戶（客戶名稱為必填）' };
      if (!db.customers.some((c) => c.CompanyName === params.customerName)) {
        return { success: false, message: `「${params.customerName}」不在客戶資料表中，請先在「客戶管理」建立這間客戶，或用畫面上的建議清單挑選` };
      }
      const caseId = demoCaseId();
      db.cases.push({
        CaseID: caseId,
        CustomerName: params.customerName || '',
        EndCustomerName: params.endCustomerName || '',
        ProjectContact: params.projectContact || '',
        ContactPhone: params.contactPhone || '',
        Salesperson: params.salesperson || '',
        FAE: params.fae || '',
        ProductApplication: params.productApplication || '',
        TestObject: params.testObject || '',
        SoftwareName: params.softwareName || '',
        SoftwareCustomization: params.softwareCustomization || '',
        SoftwareCustomizationNote: params.softwareCustomizationNote || '',
        Status: '需求單已發出',
        CreatedDate: new Date().toISOString().slice(0, 10),
        RequirementDetails: params.requirementDetails || '',
        CcdRequirements: params.ccdRequirements || [],
        RelatedCompanies: params.relatedCompanies || [],
        AttachmentLinksJson: '[]',
        EvaluationResult: '',
        EvaluationReportHtml: '',
        LastUpdated: new Date().toISOString().slice(0, 10),
      });
      saveDemoDB(db);
      return { success: true, caseId };
    }

    case 'getCases': {
      let cases = db.cases.slice().sort((a, b) => new Date(b.CreatedDate) - new Date(a.CreatedDate));
      if (params.status) cases = cases.filter((c) => c.Status === params.status);
      if (params.keyword) {
        const kw = params.keyword.toLowerCase();
        cases = cases.filter((c) => ['CaseID', 'CustomerName', 'Salesperson', 'FAE'].some((f) => String(c[f] || '').toLowerCase().includes(kw)));
      }
      if (params.companyName) {
        cases = cases.filter((c) => c.CustomerName === params.companyName || (c.RelatedCompanies || []).some((rc) => rc.CompanyName === params.companyName));
      }
      return { success: true, cases };
    }

    case 'getCasesPageData': {
      const casesResult = handleDemoApi('getCases', {});
      const customersResult = handleDemoApi('getCustomers', {});
      const staffResult = handleDemoApi('getStaff', {});
      return { success: true, cases: casesResult.cases, customers: customersResult.customers, staff: staffResult.staff, software: (db.software || []).map((x) => x.Name) };
    }

    case 'getCase': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      return { success: true, caseData: c };
    }

    case 'updateCase': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      if (params.fields && params.fields.CustomerName && !db.customers.some((cust) => cust.CompanyName === params.fields.CustomerName)) {
        return { success: false, message: `「${params.fields.CustomerName}」不在客戶資料表中，請先在「客戶管理」建立這間客戶，或用畫面上的建議清單挑選` };
      }
      Object.assign(c, params.fields || {});
      if (params.ccdRequirements) c.CcdRequirements = params.ccdRequirements;
      if (params.relatedCompanies) c.RelatedCompanies = params.relatedCompanies;
      c.LastUpdated = new Date().toISOString().slice(0, 10);
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteCase': {
      db.cases = db.cases.filter((c) => c.CaseID !== params.caseId);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 人員 (業務/FAE 自動完成，含 CRUD) ----------------
    case 'getStaff': {
      let staff = (db.staff || []).map((s, i) => Object.assign({ RowIndex: i }, s));
      if (params.role) staff = staff.filter((s) => s.Role === params.role);
      return { success: true, staff };
    }

    case 'addStaff': {
      if (!params.name) return { success: false, message: '姓名為必填' };
      db.staff.push({ Name: params.name, Role: params.role || '' });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateStaff': {
      const s = (db.staff || [])[params.rowIndex];
      if (!s) return { success: false, message: '查無此人員' };
      Object.assign(s, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteStaff': {
      (db.staff || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 帳號管理（示範模式：0000 帳號視同 admin，其他帳號存在本機） ----------------
    case 'getUsers': {
      db.users = db.users || [];
      return { success: true, users: db.users.map((u, i) => Object.assign({ RowIndex: i }, u)), roles: ['admin', 'sales', 'fae'] };
    }

    case 'addUser': {
      db.users = db.users || [];
      if (!params.username) return { success: false, message: '帳號為必填' };
      if (db.users.some((u) => u.Username === params.username)) return { success: false, message: '此帳號已存在' };
      const password = params.password || Math.random().toString(36).slice(2, 10);
      db.users.push({ Username: params.username, Role: params.role || 'sales', DisplayName: params.displayName || params.username });
      saveDemoDB(db);
      return { success: true, password: params.password ? undefined : password };
    }

    case 'updateUser': {
      const u = (db.users || [])[params.rowIndex];
      if (!u) return { success: false, message: '查無此帳號' };
      Object.assign(u, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteUser': {
      (db.users || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    case 'resetUserPassword': {
      const password = params.password || Math.random().toString(36).slice(2, 10);
      return { success: true, password };
    }

    // ---------------- 案件附件 ----------------
    case 'uploadCaseAttachment': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      let attachments = [];
      try {
        attachments = JSON.parse(c.AttachmentLinksJson || '[]');
      } catch (e) {}
      attachments.push({ name: params.filename, url: `data:${params.mimeType};base64,${params.base64}`, fileId: 'demo-' + Date.now() });
      c.AttachmentLinksJson = JSON.stringify(attachments);
      saveDemoDB(db);
      return { success: true, attachments };
    }

    case 'deleteCaseAttachment': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      let attachments = [];
      try {
        attachments = JSON.parse(c.AttachmentLinksJson || '[]');
      } catch (e) {}
      attachments = attachments.filter((a) => a.fileId !== params.fileId);
      c.AttachmentLinksJson = JSON.stringify(attachments);
      saveDemoDB(db);
      return { success: true, attachments };
    }

    case 'getCaseImages': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      let attachments = [];
      try {
        attachments = JSON.parse(c.AttachmentLinksJson || '[]');
      } catch (e) {}
      const images = attachments
        .map((a) => ({ a, m: /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(a.url || '') }))
        .filter((x) => x.m)
        .map((x) => ({ name: x.a.name, fileId: x.a.fileId, mimeType: x.m[1], base64: x.m[2] }));
      return { success: true, images, skipped: [] };
    }

    // ---------------- 文件產生（示範模式：html格式給真的html，pdf/docx用文字說明取代） ----------------
    case 'generateRequirementDoc': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      const text = `需求單\n案件編號: ${c.CaseID}\n客戶: ${c.CustomerName}\n業務: ${c.Salesperson}\nFAE: ${c.FAE}\n需求細節:\n${c.RequirementDetails}`;
      return demoDocResult(`需求單_${c.CaseID}`, params.format || 'pdf', text);
    }

    case 'generateEvaluationDoc': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      const ev = params.evaluationData || {};
      Object.assign(c, { EvaluationResult: ev.TestResult || '', Status: '評估單已發出' });
      saveDemoDB(db);
      const text = `評估單\n案件編號: ${c.CaseID}\n客戶: ${c.CustomerName}\nFAE: ${c.FAE}\n測試人員: ${ev.Tester || ''}\n建議搭配產品: ${ev.RecommendedProduct || ''}\n測試結果: ${ev.TestResult || ''}\n備註: ${ev.Notes || ''}`;
      return demoDocResult(`評估單_${c.CaseID}`, params.format || 'docx', text);
    }

    case 'generateQuoteDoc': {
      const lines = [`報價單`, `客戶: ${params.customerName || ''}`, `客戶類型: ${params.quoteType || ''}`, '', '品名 / 底價 / 牌價 / 報價 / 數量 / 小計'];
      (params.items || []).forEach((it) => lines.push(`${it.name} / ${it.basePrice} / ${it.listPrice} / ${it.unitPrice} / ${it.quantity} / ${it.subtotal}`));
      lines.push('', `總計: ${params.total}`);
      return demoDocResult(`報價單_${params.customerName || 'demo'}`, params.format || 'pdf', lines.join('\n'));
    }

    // ---------------- 客戶 CRUD ----------------
    case 'getCustomers':
      return { success: true, customers: db.customers.map((c, i) => Object.assign({ RowIndex: i }, c)) };

    case 'addCustomer': {
      db.customers.push({
        CompanyName: params.companyName || '',
        Contact: params.contact || '',
        Phone: params.phone || '',
        Email: params.email || '',
        NextFollowUpDate: params.nextFollowUpDate || '',
        Category: params.category || '',
        Urgency: params.urgency || '',
        Notes: params.notes || '',
        HasTransacted: params.hasTransacted ? '是' : '',
        LastTransactionDate: params.lastTransactionDate || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateCustomer': {
      const c = db.customers[params.rowIndex];
      if (!c) return { success: false, message: '查無此客戶' };
      Object.assign(c, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteCustomer': {
      db.customers.splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 客戶聯絡人（一間公司可以有多個聯絡窗口）----------------
    case 'getCustomerContacts': {
      db.customerContacts = db.customerContacts || [];
      let contacts = db.customerContacts.map((c, i) => Object.assign({ RowIndex: i }, c));
      if (params.companyName) contacts = contacts.filter((c) => c.CompanyName === params.companyName);
      return { success: true, contacts };
    }

    case 'addCustomerContact': {
      if (!params.companyName || !params.contactName) return { success: false, message: '公司名稱與聯絡人姓名為必填' };
      db.customerContacts = db.customerContacts || [];
      db.customerContacts.push({
        CompanyName: params.companyName,
        ContactName: params.contactName,
        Phone: params.phone || '',
        Email: params.email || '',
        Title: params.title || '',
        Notes: params.notes || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'updateCustomerContact': {
      const c = (db.customerContacts || [])[params.rowIndex];
      if (!c) return { success: false, message: '查無此聯絡人' };
      Object.assign(c, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteCustomerContact': {
      (db.customerContacts || []).splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 客戶聯繫紀錄 ----------------
    case 'addContactLog': {
      db.contactLogs.push({
        Date: new Date().toISOString().slice(0, 10),
        CompanyName: params.companyName || '',
        Contact: params.contact || '',
        Method: params.method || '',
        Summary: params.summary || '',
        Salesperson: params.salesperson || '',
        CaseID: params.caseId || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'getContactLogs': {
      let logs = db.contactLogs.map((l, i) => Object.assign({ RowIndex: i }, l));
      if (params.date) logs = logs.filter((l) => l.Date === params.date);
      if (params.companyName) logs = logs.filter((l) => l.CompanyName === params.companyName);
      logs.sort((a, b) => new Date(b.Date) - new Date(a.Date));
      return { success: true, logs };
    }

    case 'updateContactLog': {
      const l = db.contactLogs[params.rowIndex];
      if (!l) return { success: false, message: '查無此紀錄' };
      Object.assign(l, params.fields || {});
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteContactLog': {
      db.contactLogs.splice(params.rowIndex, 1);
      saveDemoDB(db);
      return { success: true };
    }

    default:
      return { success: false, message: '示範模式尚未支援此操作: ' + action };
  }
}
