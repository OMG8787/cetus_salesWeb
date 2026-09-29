# AOI 業務/評估/詢價系統

免費架構：**Google 試算表(資料庫) + Google Apps Script(後端 API) + GitHub Pages(前端網頁)**

不需要租主機、不需要付費資料庫，只需要一個 Google 帳號。

---

## 整體架構

```
使用者瀏覽器
    │  打開 GitHub Pages 網址 (前端網頁)
    ▼
GitHub Pages（frontend 資料夾）
    │  網頁上的按鈕，透過 fetch() 呼叫下面的網址
    ▼
Google Apps Script Web App（apps-script 資料夾，部署後得到一組 exec 網址）
    │  在這裡讀寫資料、產生 PDF/WORD、寄信
    ▼
Google 試算表（你自己建立，當作資料庫）
```

前端（GitHub Pages 上的網頁）**完全不會拿到、也不需要知道任何密碼**，
所有帳號密碼比對、Google 試算表存取，都是在 Apps Script（後端）裡執行，外部看不到。

### 前端檔案結構（每個分頁都是獨立檔案，方便之後維護/除錯）

```
frontend/
├── index.html        登入頁
├── products.html      產品搜尋/詢價頁
├── calc.html          選型計算頁（相機/鏡頭/飛拍，邊談邊算、即時檢查）
├── evalreport.html    評估報告編輯器（從案件管理開啟，輸出專業電子報告）
├── img/logo.png       公司 Logo（評估報告預設使用）
├── cases.html          案件管理頁
├── quote.html           報價系統頁
├── customers.html        客戶管理頁
├── report.html             日報頁
├── style.css                共用樣式
├── config.js                 共用設定(API_URL / DEMO_MODE)
├── common.js                  共用邏輯(callApi、載入遮罩、登入檢查、文件預覽彈窗)
├── demo.js                     示範模式的假後端(每頁都會載入，正式模式下完全不會被用到)
├── login.js                     只有 index.html 用，登入邏輯
├── products.js                   只有 products.html 用
├── calc.js                       只有 calc.html 用
├── evalreport.js                 只有 evalreport.html 用（編輯畫面）
├── evalreport-render.js          評估報告的版面與輸出 HTML（evalreport.html 用）
├── cases.js                       只有 cases.html 用
├── quote.js                        只有 quote.html 用
├── customers.js                     只有 customers.html 用
└── report.js                         只有 report.html 用
```

每個分頁都是**真的獨立的網頁**（點分頁按鈕會整頁跳轉，不是單頁應用程式），登入狀態存在瀏覽器的 sessionStorage，所以切換分頁不用重新登入。以後要改某個分頁的功能，只需要看那個分頁對應的 `.html` + `.js` 兩個檔案，不用打開整個系統的程式碼。

---

## 第一步：建立 Google 試算表

1. 到 Google Drive 新增一個 Google 試算表，命名例如「AOI系統資料庫」
2. 建立以下 6 個分頁（分頁名稱要完全一樣），第一列填入欄位名稱：

### Products（產品主檔）
| InternalModel | SupplierModel | Supplier | SupplierContact | SupplierContactEmail | Origin | Category | CompatibleGroup | RefPrice | Notes |
|---|---|---|---|---|---|---|---|---|---|

> `RefPrice` 當「底價」用，牌價/報價都是即時計算，不用另外存。`Origin`(產地)是新加的欄位，如果你先前已經建好 Products 分頁，記得在 `SupplierContactEmail` 跟 `Category` 中間手動插入這一欄。`Category` 前端現在是下拉選單，固定選項：相機/調光器/光源/線材/工業主機/軟體包/其他，但存到試算表就是純文字，你也可以直接在試算表手動打其他值。

### PriceHistory（價格紀錄）
| Date | ProductInternalModel | Supplier | Price | Currency | CaseID | Notes |
|---|---|---|---|---|---|---|

### Cases（案件）
```
CaseID	CustomerName	EndCustomerName	ProjectContact	ContactPhone	Salesperson	FAE	ProductApplication	TestObject	SoftwareName	SoftwareCustomization	SoftwareCustomizationNote	Status	CreatedDate	RequirementDetails	AttachmentLinksJson	EvaluationResult	EvaluationReportHtml	LastUpdated
```

> 直接把上面整段複製貼到 Cases 分頁 A1（會覆蓋掉原本的標題列，貼之前先把你已經有的資料存個備份比較保險）。
> `AttachmentLinksJson` 存的是上傳附件的清單（檔名+雲端硬碟連結），這欄是程式自動讀寫，你不用手動編輯。
> 如果你先前的版本 Cases 分頁裡有 `CCDRequirementsJson` 這一欄，這次改成 CCD 資料存到獨立的 `CCDRequirements` 分頁（見下面），這一欄可以直接刪掉。
> 欄位在試算表裡的先後順序其實不影響程式運作（程式是照「欄位名稱文字」對應，不是照位置），但建議照上面順序排比較好閱讀。

### CCDRequirements（CCD 檢測需求，新分頁，一個案件可以對應多列）
```
CaseID	CcdIndex	Description	FovLengthMm	FovWidthMm	WdMm	AccuracyUm	FlyingSpeedMmS	InspectionSpeedPs	LightingNote
```
新建一個分頁，欄名跟上面完全一樣。每一列代表「某案件的第幾組 CCD」，`CcdIndex` 是 1、2、3... 這樣編號。這張表**你可以直接打開來看**——想知道某個案件單號總共有幾組 CCD、各自的檢測需求是什麼，直接篩選 `CaseID` 那一欄就看得到，不用打開系統。

### Staff（業務/FAE 名單，新分頁，自動完成建議用）
```
Name	Role
```
新建一個分頁，欄名跟上面完全一樣。`Role` 欄位程式會存 `業務` 或 `FAE`。這張表不用先手動填資料，之後在案件管理輸入業務/FAE姓名，如果不在清單裡，畫面會自動跳出小視窗讓你補建，建立後會自動存進這張表。

### Customers（客戶）
| CompanyName | Contact | Phone | Email | NextFollowUpDate | Category | Urgency | Notes | CalendarEventId |
|---|---|---|---|---|---|---|---|---|

> 這次多加了 `Category`（客戶分類，例如：設備商/代理商/終端客戶/其他）跟 `Urgency`（急迫性：高/中/低），如果你先前已經建好 Customers 分頁，記得在 `NextFollowUpDate` 跟 `Notes` 中間手動插入這兩欄（順序要跟上面一樣）。`CalendarEventId` 則是用來記錄「下次追蹤日」同步到 Google 日曆後對應的事件 ID，同一客戶編輯追蹤日時才會更新同一筆事件，不會重複建立。

### ContactLogs（客戶聯繫紀錄，新增的分頁，日報的資料來源）
```
Date	CompanyName	Contact	Method	Summary	Salesperson
```
這是一張全新的分頁，記得手動新增，欄名跟上面完全一樣。

### Users（登入帳號）
| Username | PasswordHash | Role |
|---|---|---|

### Config（系統設定）
| Key | Value |
|---|---|

在 Config 分頁填入這幾筆：
- `TemplateDocId_Requirement` → 需求單範本的 Google 文件 ID（見第二步）
- `TemplateDocId_Evaluation` → 評估單範本的 Google 文件 ID（見第二步）
- `TemplateDocId_Quote` → 報價單範本的 Google 文件 ID（見第二步）
- `ReportEmail` → 你要收日報的信箱（選填）

> `AttachmentsFolderId`（案件附件存放的雲端硬碟資料夾ID）不用手動填，第一次有人上傳附件時程式會自動建立一個叫「AOI系統附件」的資料夾，並自動把 ID 寫回這裡。

---

## 第二步：建立需求單 / 評估單的 Google 文件範本

分別建立兩份 **Google 文件**（不是上傳 Word 檔，是直接在 Google Docs 建立），
在文件內容裡打上「佔位符」，程式會自動把它們換成真正的資料。

**需求單範本可用的佔位符：**
`{{CaseID}}` `{{CustomerName}}` `{{Salesperson}}` `{{FAE}}` `{{RequirementDetails}}` `{{Date}}`

**評估單範本可用的佔位符：**
`{{CaseID}}` `{{CustomerName}}` `{{FAE}}` `{{TestResult}}` `{{RecommendedProduct}}` `{{Tester}}` `{{TestDate}}` `{{Notes}}`

**報價單範本比較特別，除了文字佔位符，還需要放一個「表格」：**

抬頭文字用佔位符：`{{CustomerName}}` `{{QuoteDate}}` `{{QuoteType}}` `{{Total}}`

接著在文件裡插入一個表格，結構如下（用 Google 文件選單「插入 > 表格」）：

| 品名 | 數量 | 單價(報價) | 小計 |
|---|---|---|---|
| (範例列，內容隨便打，例如「範例品項」「1」「0」「0」) | | | |

程式會把「表格最後一列」當作範本，依你加入的品項數量自動往下增加列數並填入資料，
原本那個範例列最後會被程式自動移除，所以範例列內容打什麼都沒關係，但**欄位順序一定要是：品名、數量、單價、小計**，且只能有這一個表格。

範本文件排版（字型、Logo、表格、抬頭）你可以自己排，程式只負責換文字，格式會照範本呈現。

建立好後，從網址列複製文件 ID：
```
https://docs.google.com/document/d/【這一段就是文件ID】/edit
```
把兩個 ID 分別貼到試算表 Config 分頁對應的 Value 欄位。

---

## 第三步：把後端程式碼貼進 Apps Script

1. 打開你的 Google 試算表 → 選單「擴充功能」→「Apps Script」
2. 把本專案 `apps-script/Code.gs` 的內容整個貼進去（覆蓋預設的 Code.gs）
3. 左側選單有個「專案設定」齒輪圖示，勾選「在編輯器中顯示 appsscript.json」，
   打開後把本專案 `apps-script/appsscript.json` 的內容整個貼進去覆蓋

## 第四步：建立第一個登入帳號

1. 在 Apps Script 編輯器裡，找到 `generatePasswordHash` 這個函式，
   把裡面的 `'changeme'` 換成你要設定的密碼
2. 上方工具列選這個函式後按「執行」（第一次執行會要求授權，全部同意即可）
3. 左側「執行紀錄」會顯示一長串英數字，那就是密碼雜湊值，複製起來
4. 回到試算表 Users 分頁，新增一列：Username 填帳號、PasswordHash 貼上剛剛那串、Role 填 `admin`

---

## 第五步：部署成 Web App

1. Apps Script 編輯器右上角「部署」→「新增部署作業」
2. 類型選「網頁應用程式」
3. 「具有存取權的使用者」選「所有人」
4. 按「部署」，會出現一組網址，長得像：
   `https://script.google.com/macros/s/xxxxxxxxxxxx/exec`
5. 複製這個網址

> 之後如果你有修改 Code.gs，要用「管理部署作業」→ 編輯 → 選新版本，重新部署，網址才會套用新程式碼。

---

## 第六步：設定前端並上傳到 GitHub Pages

1. 打開本專案 `frontend/config.js`，把 `API_URL` 換成第五步複製的網址
2. 到 GitHub 新增一個 repository（可以是 public，前端本來就是公開網頁）
3. 把 `frontend` 資料夾**裡面所有檔案**（`index.html` `products.html` `cases.html` `quote.html` `customers.html` `report.html` `style.css` `config.js` `common.js` `demo.js` `login.js` `products.js` `cases.js` `quote.js` `customers.js` `report.js` `calc.html` `calc.js` `evalreport.html` `evalreport.js` `evalreport-render.js`，以及 `img` 資料夾（裡面是 `logo.png`））整個上傳到 repo 根目錄，注意是「資料夾裡面的每一個檔案」都要上傳，不是只傳一個 index.html
4. 進入 repo 的 Settings → Pages → Source 選擇你的分支（例如 `main`）與資料夾（`/root`）
5. 存檔後 GitHub 會給你一個網址，例如：`https://你的帳號.github.io/repo名稱/`
6. 打開這個網址（會先看到登入頁），用第四步設定的帳密登入，登入成功會自動跳到「產品搜尋」頁，之後點上方分頁按鈕切換

---

## 日常使用方式

- **業務**：在「產品搜尋/詢價」分頁查型號、看上次報價、產生詢價信文字（有設定 Gmail 會自動建草稿）；一進分頁就會列出全部產品，打字會即時篩選（0.3秒後自動查，不用按搜尋按鈕，按 Enter 也可以）；產品可以直接新增/修改/刪除，多了「產地」欄位跟「類別」下拉選單（相機/調光器/光源/線材/工業主機/軟體包/其他），底價/牌價互相輸入自動換算，備註也會直接顯示在搜尋結果跟詳情裡；價格歷史紀錄也能個別編輯或刪除
- **選型計算（跟客戶洽談時用）**：「選型計算」分頁把相機解析度、鏡頭焦距/WD/視野、飛拍拖影三種計算整合在同一頁，客戶講一個數字就填一個，每個欄位一改就即時重算。計算是一條鏈：需求 → 相機（所需像素 = 檢測範圍 ÷ (精度 ÷ 單個特徵像素)，規則同 CCD_camera：長邊 ≥ 所需長邊、短邊 ≥ 所需短邊，依畫素取最接近需求的 3 款建議，同畫素 GigE 優先，點卡片即可選用）→ 鏡頭（可切換 **FA 鏡頭 / 遠心鏡頭**：FA 自動算出焦距 F = 感測器 × WD ÷ 視野、遠心自動算出倍率 = 感測器 ÷ 視野，並直接寫進「焦距 / 倍率」欄位，可手動改（標示「手動」，按 ↺ 回到自動）；型錄建議就用這個欄位的值搜尋，列出前 3 名，點卡片即可選用）→ 實際視野 ÷ 相機像素 = 空間解析度（可選短邊或長邊為基準，預設短邊；焦距/倍率也以同一邊計算）→ 飛拍。最小檢測精度可選公差方向：**± 正負**（以輸入值計算）、**+ 只能多**、**− 只能少**（單邊公差帶只有一側，量測誤差要落在帶寬中間，以輸入值 ÷ 2 計算）；存回案件時精度會帶正負號（例如 `+2`），案件管理手動輸入也可以這樣寫。每個結果底下都用小字列出代入數字的算式，「複製計算摘要」也會附上完整計算過程，方便自己檢查跟客戶對接。右側「檢查結果」會馬上列出算不過或前後矛盾的地方（例如相機解析度不足、客戶指定的焦距拍不滿視野、飛拍拖影超標、相機影格率跟不上產能、精度單位疑似選錯），相關欄位會標紅/標黃，並直接告訴你要改成多少才行。可以從案件帶入某組 CCD 需求，算完按「把計算結果存回此 CCD」，會更新 FOV/WD/精度/速度，並把計算摘要寫進該 CCD 的檢測需求說明（重複存只會更新同一段，不會越疊越多）；「複製計算摘要」可以直接貼給客戶或同事。相機/鏡頭型錄讀取 `config.js` 的 `CAMERA_CATALOG_SHEET_ID`（公開 Google 試算表，分頁 GigE / USB3 / FA鏡頭 / 遠心鏡頭），留空就改用手動輸入相機規格、FA 鏡頭以標準焦距推算。輸入值會記在瀏覽器，切到別頁再回來還在
- **詢價暫存清單**：查看產品時按「加入詢價暫存清單」可以一次累積多個要詢價的產品，清單最多保留 48 小時（過期自動清空），可以手動延長或清空；按「產生合併詢價信文字」會把所有品項合併成一份格式化的詢價信文字，如果全部品項是同一個供應商信箱，還會自動建立 Gmail 草稿
- 在「案件管理」建立新案件，等於發需求單資訊給 FAE。客戶名稱、業務、FAE 都是邊打字邊有下拉建議，如果打的名字不在清單裡，欄位失去焦點時會自動跳出小視窗讓你順便建立客戶/人員資料，不用切分頁去客戶管理重打一次；案件編號會自動照「軟體名稱-待測物件-產品應用-客戶名稱」組成，重複的話自動加流水號；「檢測需求」可以按「+ 新增CCD」加開多組相機的規格，各自獨立填寫也能個別刪除，存檔後可以直接在試算表的 `CCDRequirements` 分頁用案件編號查到每一組的詳細內容；案件詳情頁可以上傳檢測規章等附件，會存到你的 Google 雲端硬碟並列出連結，也能個別刪除。案件列表可以關鍵字+狀態搜尋，案件資料本身也能修改或刪除
- **操作等待提示**：任何跟後端溝通的動作（搜尋、儲存、產生文件...）畫面都會先蓋一層「處理中」遮罩，避免等待期間重複點擊按鈕造成重複送出
- **輸出格式可選**：需求單、評估單(自動生成)、報價單都可以在畫面上選輸出格式——**PDF/Word** 是用 Google 文件範本轉出（免費，只是需要先照第二步建好範本），**HTML** 是程式直接組資料產生的純網頁檔案，不需要範本，你可以自己另外轉檔（例如瀏覽器打開後用「列印」→「另存為PDF」）
- **專業評估報告（推薦）**：案件詳情裡按「開啟評估報告編輯器」。會自動帶入封面、基本資訊、各 CCD 原始需求與 FAE 評估方案（選型計算頁存回 CCD 的結果會自動填入相機、鏡頭、延伸環、視野、空間解析度），按「帶入案件圖片」可把案件附件裡的圖片放進「測試影像」。之後可自由新增 / 排序區塊：章節標題、文字（可調粗體、字級、顏色、螢光筆、對齊、清單）、圖片（1～3 張並排、寬度、對齊、圖說，支援上傳 / 拖曳 / 截圖後 Ctrl+V 貼上）、圖文並排、表格、重點框（結論 / 建議 / 注意 / 風險）、簽核欄、分頁、封面。「版面與品牌」可改配色主題、字型、字級、Logo、公司名稱、浮水印、頁尾聲明，並存成個人預設。右邊是即時 A4 預覽（點預覽內容會跳到對應區塊）。草稿自動存在這台電腦的瀏覽器；完成後可「列印 / 另存 PDF」、「下載 HTML」（單一檔案、圖片內嵌），或「存到案件附件」（存進 Google 雲端硬碟，並可順便把案件狀態改成「評估單已發出」）。「重新帶入案件資料」只會更新自動產生的欄位，自己填的光源、測試結論和自己加的區塊都會保留
- **FAE**：登入後在「案件管理」找到對應案件，評估報告有兩種做法：方式一是填寫測試結果、建議搭配產品，選好格式後按「自動產生評估單」（會一併自動產生搭配報價單，報價單的客戶類型跟格式也可以在旁邊選）；方式二是直接在「手動撰寫評估報告」欄位打字排版、調顏色字級，存草稿或選格式（PDF/HTML）後「預覽/下載」。所有產生的文件都會先進預覽視窗，確認沒問題再下載
- **業務**：案件建立後可以選格式產生需求單，一樣會先進預覽視窗，確認內容沒問題再下載，傳給 FAE 或行政窗口
- **行政窗口**：查詢產品時會自動看到「上次詢過的供應商與價格」，確認是否要重新詢價，詢價後記得按「存入價格紀錄」，下次才會自動帶出
- **業務（報價系統）**：新增品項時直接在型號欄位打字，會自動跳出符合的產品清單可以直接點選（不用背完整型號、也不怕打錯），輸入底價或牌價會自動互相換算，選客戶類型（設備商×1.3 / 一般用戶×1.5 / 自訂義自行輸入倍數）自動算出報價；加入多個品項後選好格式按「產生報價單」一樣會先進預覽視窗，確認沒問題再下載，或勾選「客戶現場展示模式」把底價/牌價隱藏起來，只顯示報價給客戶看
- **客戶追蹤/行事曆**：新增客戶時可以設定客戶分類（設備商/代理商/終端客戶/其他）跟急迫性（高/中/低），列表上方可以用這兩個條件篩選；有填「下次追蹤日」會自動在你的 Google 日曆建立一筆全天事件，之後按「編輯追蹤日」修改會同步更新同一筆事件；客戶也可以直接刪除
- **客戶聯繫紀錄**：每次跟客戶聯繫完（電話/Email/拜訪），在客戶管理分頁下方「新增客戶聯繫紀錄」填一筆，公司名稱有自動帶出清單可以選，這是日報的主要資料來源
- **日報**：獨立的「日報」分頁，按「重新整理今日資料」會抓當天的客戶聯繫紀錄、案件動態、應追蹤客戶組成預覽；下面「手動補充說明」欄位可以自己額外打字，按「確認寄送日報」會把預覽內容+手動補充一起寄到 Config 的 `ReportEmail`。排程自動日報(見下方 Apps Script 觸發條件)不含手動補充，因為排程沒有人手動輸入

## 之後可以擴充

程式碼已經整理成「加新功能不用大改架構」的樣子：

- **後端(Code.gs)**：所有 API 動作都註冊在檔案最上面的 `ROUTES` 物件裡。新增功能只要 1) 寫一個 `handleXxx(body)` 函式 2) 在 `ROUTES` 加一行 `xxx: { auth: true, fn: handleXxx }`，`doPost` 完全不用改
- **前端**：每個分頁是獨立的 `.html` + `.js`，呼叫 `callApi('你的action', {參數})` 就會自動打到後端對應的 handler；如果想要示範模式也測得到，在 `demo.js` 的 `handleDemoApi` switch 裡加一個對應的 case 就好；`common.js` 放的是所有分頁共用的東西（登入檢查、載入遮罩、文件預覽彈窗），只有真的每一頁都要用到的邏輯才放進去，其他都留在各分頁自己的 `.js`

延伸功能舉例：
- 報價歷史紀錄：加一張 `Quotes` 分頁，`handleGenerateQuoteDoc` 產生文件前先 `appendObjectRow` 存一筆
- 日報：已經做好了，只差在 Apps Script 左側「觸發條件」設定 `sendDailyReport` 每天固定時間執行，就會自動寄日報信（日報分頁的「確認寄送日報」可以先手動測）
- 若要多人不同權限（例如行政窗口看不到評估單），可以在 Users 分頁的 Role 欄位擴充，並在對應的 `handleXxx` 函式裡加角色檢查
- 若想要更漂亮的介面，可以之後把某個分頁的 `.html`/`.js` 換成 Vue/React 等框架寫，只要 `callApi()` 的呼叫方式不變，其他分頁跟後端完全不用改

## 疑難排解

- **前端顯示「連線失敗」**：檢查 `config.js` 的 `API_URL` 是否貼對，以及 Apps Script 是否已部署為「所有人」可存取
- **登入一直失敗**：確認 Users 分頁的密碼雜湊值是用 `generatePasswordHash` 產生、且帳號欄位沒有多餘空格
- **選 PDF/Word 格式產生失敗，訊息是找不到範本**：檢查 Config 分頁的 `TemplateDocId_Requirement` / `TemplateDocId_Evaluation` / `TemplateDocId_Quote` 是否為正確的 Google 文件 ID；如果不想處理範本，選 **HTML** 格式即可，不需要範本
- **登入後跳轉某一頁變成空白/功能不動**：確認 GitHub repo 裡 `frontend` 資料夾**所有檔案**都有上傳，尤其 `common.js`、`demo.js`、`config.js` 這三個是每一頁都要用到的共用檔案，漏傳的話該頁會整個失效
- **切換分頁後要重新登入**：登入狀態存在瀏覽器的 sessionStorage，正常情況下同一個瀏覽器分頁切換不會登出；如果每次都要重登，檢查是不是用無痕視窗或瀏覽器設定封鎖了網站資料儲存
