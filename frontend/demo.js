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
        return { success: true, token: 'demo-token', username: '0000（示範帳號）', role: 'admin' };
      }
      return { success: false, message: '示範模式僅接受帳密 0000 / 0000' };
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
      return { success: true, cases };
    }

    case 'getCasesPageData': {
      const casesResult = handleDemoApi('getCases', {});
      const customersResult = handleDemoApi('getCustomers', {});
      const staffResult = handleDemoApi('getStaff', {});
      return { success: true, cases: casesResult.cases, customers: customersResult.customers, staff: staffResult.staff };
    }

    case 'getCase': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      return { success: true, caseData: c };
    }

    case 'updateCase': {
      const c = db.cases.find((c) => c.CaseID === params.caseId);
      if (!c) return { success: false, message: '查無此案件' };
      Object.assign(c, params.fields || {});
      if (params.ccdRequirements) c.CcdRequirements = params.ccdRequirements;
      c.LastUpdated = new Date().toISOString().slice(0, 10);
      saveDemoDB(db);
      return { success: true };
    }

    case 'deleteCase': {
      db.cases = db.cases.filter((c) => c.CaseID !== params.caseId);
      saveDemoDB(db);
      return { success: true };
    }

    // ---------------- 人員 (業務/FAE 自動完成) ----------------
    case 'getStaff': {
      let staff = db.staff || [];
      if (params.role) staff = staff.filter((s) => s.Role === params.role);
      return { success: true, staff };
    }

    case 'addStaff': {
      if (!params.name) return { success: false, message: '姓名為必填' };
      db.staff.push({ Name: params.name, Role: params.role || '' });
      saveDemoDB(db);
      return { success: true };
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

    // ---------------- 客戶聯繫紀錄 ----------------
    case 'addContactLog': {
      db.contactLogs.push({
        Date: new Date().toISOString().slice(0, 10),
        CompanyName: params.companyName || '',
        Contact: params.contact || '',
        Method: params.method || '',
        Summary: params.summary || '',
        Salesperson: params.salesperson || '',
      });
      saveDemoDB(db);
      return { success: true };
    }

    case 'getContactLogs': {
      let logs = db.contactLogs.slice();
      if (params.date) logs = logs.filter((l) => l.Date === params.date);
      return { success: true, logs };
    }

    // ---------------- 日報 ----------------
    case 'getDailyReportData':
    case 'sendDailyReportNow': {
      const today = new Date().toISOString().slice(0, 10);
      const contactLogs = db.contactLogs.filter((l) => l.Date === today);
      const cases = db.cases.filter((c) => c.LastUpdated === today || c.CreatedDate === today);
      const followUps = db.customers.filter((c) => c.NextFollowUpDate === today);
      const lines = [`AOI 業務日報 - ${today}`, '', `【今日客戶聯繫紀錄】(${contactLogs.length} 筆)`];
      contactLogs.forEach((c) => lines.push(`- ${c.CompanyName}（${c.Contact}）｜方式:${c.Method}｜${c.Summary}`));
      lines.push('', `【今日更新/新增案件】(${cases.length} 筆)`);
      cases.forEach((c) => lines.push(`- ${c.CaseID} | ${c.CustomerName} | 狀態: ${c.Status}`));
      lines.push('', `【今日應追蹤客戶】(${followUps.length} 筆)`);
      followUps.forEach((c) => lines.push(`- ${c.CompanyName}（${c.Contact}）`));
      if (params.manualNotes) lines.push('', '【手動補充說明】', params.manualNotes);

      if (action === 'getDailyReportData') {
        return { success: true, text: lines.join('\n'), contactLogs, cases, followUps };
      }
      return { success: true, message: '示範模式：這個功能只有接上真正的後端才會真的寄信。以下是產生的內容：\n\n' + lines.join('\n') };
    }

    default:
      return { success: false, message: '示範模式尚未支援此操作: ' + action };
  }
}
