/**
 * copy-prompts.js - 文案製作的平台、行銷目標與提示詞組裝（純函式，瀏覽器與測試共用）
 * 移植自 CetusSalesAgent 的發文助手：平台字數與格式、行銷目標、人設／風格／結尾素材庫、改寫與 AI 學習風格。
 * 提示詞裡不放任何商品規格或數據：內容只能用使用者填的主題、活動資訊與素材，AI 不得捏造。
 */
(function (root) {
  const PLATFORMS = {
    Threads: { limit: 500, url: 'https://www.threads.net/' },
    Instagram: { limit: 2200, url: 'https://www.instagram.com/' },
    Facebook: { limit: 63206, url: 'https://www.facebook.com/' },
    X: { limit: 280, url: 'https://x.com/compose/post' },
    LINE: { limit: 5000, url: 'https://manager.line.biz/' },
    YouTube: {
      limit: 5000,
      url: 'https://studio.youtube.com/',
      long: true,
      n: 1,
      fmt: `【輸出格式】依序輸出以下區塊，區塊標題需完全一致：
【標題】影片標題，60 字內，主關鍵字置前，吸引點擊但不誇大
【副標題】一句話補充影片價值或適用對象
【SEO 說明】前 150 字為摘要，首句含主關鍵字並直接回答影片核心問題（AEO），後續自然帶入相關關鍵字
【內文】完整影片簡介：影片重點條列、適用情境、延伸資訊；章節時間軸以 00:00 格式列出占位，由小編自行填入時間
【常見問答】3 組「Q：…／A：…」，問題貼近搜尋者真實提問，答案簡短直接（AEO）
【標籤】8~12 個 YouTube 標籤，以逗號分隔，不加 #
【Hashtag】3 個 hashtag（#開頭，空白分隔）`,
    },
    方格子: {
      limit: 30000,
      url: 'https://vocus.cc/',
      long: true,
      n: 1,
      fmt: `【輸出格式】依序輸出以下區塊，區塊標題需完全一致：
【標題】文章標題，主關鍵字置前，28 字內
【副標題】一句話點出文章價值
【SEO 說明】80~120 字 Meta 描述，含主關鍵字，並直接回答文章核心問題（AEO）
【內文】Markdown 格式，開頭先用 2~3 句直接給出答案，之後以 ## 、### 分段（每段小標含相關關鍵字），適度使用條列、表格與實例，約 1500~2500 字
【常見問答】3 組「Q：…／A：…」（AEO／GEO）
【SEO 標籤】5~8 個方格子文章標籤，以逗號分隔，不加 #`,
    },
  };
  const PLATFORM_NAMES = Object.keys(PLATFORMS);

  const TONES = ['親切自然', '專業可信', '活潑有趣', '溫暖感性', '簡潔俐落', '幽默風趣', '權威專家'];
  const STATUS_LABEL = { draft: '草稿', scheduled: '已排程', posted: '已發佈' };

  const EVENT_FIELDS = [
    { key: 'theme', label: '活動主題', placeholder: '例：2026 台北國際自動化工業大展' },
    { key: 'host', label: '主辦單位', placeholder: '例：台灣區電機電子工業同業公會' },
    { key: 'cohost', label: '協辦單位', placeholder: '例：合作夥伴名稱' },
    { key: 'address', label: '活動地址', placeholder: '例：台北南港展覽館 1 館' },
    { key: 'landmark', label: '活動地標', placeholder: '例：鑫堡攤位 K1234' },
    { key: 'promo', label: '優惠活動', placeholder: '例：現場預約 Demo 送技術白皮書' },
  ];

  const blankEvent = () => ({ schedule: [{ date: '', time: '' }] });

  const QUICK = [
    { label: '縮短', instruction: '在保留所有關鍵資訊（日期、地點、優惠）的前提下大幅精簡，約縮減三分之一' },
    { label: '加長', instruction: '補充更多細節與畫面感，篇幅增加約一半，但不得捏造資訊' },
    { label: '更口語', instruction: '改成更口語、像朋友聊天的語氣' },
    { label: '更專業', instruction: '改成更專業可信的語氣' },
    { label: '加 emoji', instruction: '在適當位置加入貼切的 emoji，不要過量' },
    { label: '補 hashtag', instruction: '在結尾補上 3~5 個合適的 hashtag（含大流量詞與精準長尾詞），內文其餘部分不變' },
  ];

  const MARKETING = [
    ['搜尋優化', [
      ['seo', 'SEO', '自然融入目標關鍵字（標題、開頭、內文各出現），語意通順不堆砌，內容具體有資訊量'],
      ['aeo', 'AEO', '答案引擎優化：開頭先用 1~2 句直接回答核心問題，並以「問題→簡短答案」的結構呈現，利於被精選摘要與語音助理擷取'],
      ['geo', 'GEO', '生成式引擎優化：提供清楚、可被引用的事實、數據與定義，用條列或明確結構，讓 AI 搜尋容易引用'],
      ['local', '在地 SEO', '加入地區、地標或「附近」類在地關鍵字，強調在地服務與到店資訊'],
    ]],
    ['轉換導向', [
      ['cta', '明確 CTA', '結尾加入單一明確的行動呼籲（留言、私訊、點連結、預約等）'],
      ['urgency', '限時／稀缺', '營造限時、限量的急迫感，但不得誇大不實'],
      ['proof', '社會認證', '引用客戶評價、使用人數、獲獎或實績等佐證'],
      ['pain', '痛點切入', '開頭先點出目標受眾的痛點，再帶出解決方案'],
    ]],
    ['互動與內容', [
      ['engage', '互動提問', '結尾拋出一個容易回答的問題，引導留言互動'],
      ['story', '故事行銷', '用簡短的故事或情境帶入，增加共鳴與記憶點'],
      ['edu', '知識教育', '提供實用小知識或步驟，讓讀者覺得有收穫、願意收藏分享'],
      ['emotion', '情感共鳴', '以情感或價值觀切入，建立品牌認同'],
    ]],
    ['品牌與擴散', [
      ['brand', '品牌一致性', '維持品牌口吻與用語一致，不使用過度誇張的措辭'],
      ['hashtag', 'Hashtag 策略', '結尾附 3~5 個 hashtag，混合大流量詞與精準長尾詞'],
      ['ugc', '鼓勵 UGC', '邀請讀者分享自己的使用經驗並標註品牌'],
    ]],
  ];
  const MARKETING_BY_KEY = {};
  MARKETING.forEach(([, xs]) => xs.forEach((x) => (MARKETING_BY_KEY[x[0]] = { label: x[1], desc: x[2] })));

  const KIND_LABEL = { prompt: '人設／提示詞', style: '發文風格', ending: '固定結尾' };
  const SCOPE_SOCIAL = '@social';
  const scopeLabel = (scope) => (!scope ? '全部平台' : scope === SCOPE_SOCIAL ? '一般社群貼文' : scope);
  const itemApplies = (item, platform) => !item.platform || item.platform === platform || (item.platform === SCOPE_SOCIAL && !(PLATFORMS[platform] || {}).long);

  const DEFAULT_PERSONA = '你是擁有多年經驗的社群小編，擅長用精準的文字抓住讀者注意力。內容必須真實、不浮誇，不得捏造數據或功效。';

  function eventLines(event) {
    const schedule = (event && event.schedule) || [];
    const when = schedule
      .filter((r) => String(r.date || '').trim() || String(r.time || '').trim())
      .map((r) => [String(r.date || '').trim(), String(r.time || '').trim()].filter(Boolean).join(' '))
      .join('；');
    return [['活動日期與時間', when]].concat(EVENT_FIELDS.map((f) => [f.label, String((event || {})[f.key] || '').trim()])).filter((x) => x[1]);
  }
  const eventSummary = (event) => eventLines(event).map(([l, v]) => `${l}：${v}`);

  const styleBlock = (styles) => (styles.length ? '【發文風格】請對照以下風格與範例撰寫：\n' + styles.map((s) => `- ${s.name}：${s.text}`).join('\n') : '');
  const endingBlock = (endings) =>
    endings.length ? '【固定結尾】請將以下結尾原樣（不得改寫；若已存在則不重複）放在正文最後一段，hashtag／標籤區塊之前：\n' + endings.map((e) => e.text).join('\n') : '';
  const personaBlock = (prompts) => (prompts.length ? prompts.map((p) => p.text).join('\n\n') : DEFAULT_PERSONA);

  /** 要幾個版本：長文平台 1 版，其餘 3 個不同切入角度 */
  const variantCount = (platform) => (PLATFORMS[platform] || {}).n || 3;

  function buildGeneratePrompt(draft, picked) {
    const platform = PLATFORMS[draft.platform];
    const n = (platform && platform.n) || 3;
    const parts = [personaBlock(picked.prompts)];
    parts.push(`請為「${draft.platform}」撰寫 ${n === 1 ? '1 個完整' : '3 個不同切入角度的'}版本。
主題：${draft.topic}
語氣：${draft.tone}
字數上限：${platform ? platform.limit : 500} 字（Threads/X 請精簡）。
使用繁體中文。
所有資訊只能來自上面的主題、下面的活動資訊與素材；沒有提供的規格、數據、價格、日期，不得自行捏造。`);
    if (platform && platform.fmt) parts.push(platform.fmt);
    const ev = eventLines(draft.event);
    if (ev.length) parts.push('【活動資訊】以下資訊請完整、正確地寫入貼文，不得更改或自行捏造：\n' + ev.map(([l, v]) => `- ${l}：${v}`).join('\n'));
    if (String(draft.keywords || '').trim()) parts.push(`目標關鍵字：${String(draft.keywords).trim()}`);
    parts.push(styleBlock(picked.styles));
    const goals = (draft.marketing || []).filter((k) => MARKETING_BY_KEY[k]);
    if (goals.length) parts.push('【行銷目標】內容需同時達成：\n' + goals.map((k) => `- ${MARKETING_BY_KEY[k].label}：${MARKETING_BY_KEY[k].desc}`).join('\n'));
    parts.push(endingBlock(picked.endings));
    parts.push(n === 1 ? '只輸出完整內容本身，不要任何說明或前言。' : '只輸出 3 個版本的內文，版本之間用單獨一行的 ===== 分隔，不要任何說明、標題或編號。');
    return parts.filter(Boolean).join('\n\n');
  }

  /** 快速改寫，或改寫成別的平台版本（target 與原平台不同） */
  function buildRewritePrompt(content, instruction, target, picked) {
    const platform = PLATFORMS[target];
    return [
      personaBlock(picked.prompts),
      styleBlock(picked.styles),
      (platform && platform.fmt) || '',
      endingBlock(picked.endings),
      `請依指示改寫下方貼文，使用繁體中文，日期、時間、地址、優惠等關鍵資訊必須保持正確、不得更動，也不得新增原文沒有的規格或數據。
指示：${instruction}
目標平台：${target}（字數上限 ${platform ? platform.limit : 500} 字）
只輸出改寫後的內文，不要任何說明。

【原文】
${content}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  const convertInstruction = (toPlatform) => `改寫成適合「${toPlatform}」平台的版本（該平台語氣、格式與慣例）`;

  /** AI 學習風格：用最近喜愛的幾篇＋上一版指南，整理新版風格指南 */
  function buildLearnPrompt(posts, old) {
    return `你是資深的社群文案風格分析師。以下是使用者最近標記為「喜歡」的 ${posts.length} 篇貼文。這是「滾動式整理」：${old ? '下方的現有風格指南已吸收了更早的貼文，請以它為基底，依這幾篇最新的喜好修正、補充，產出新版風格指南。' : '請歸納使用者偏好的寫作風格，產出第一版風格指南。'}

指南需可直接交給小編照做，涵蓋面向：語氣與人設、句型與長度、開頭手法、結尾與 CTA 手法、段落結構與排版、emoji 與標點習慣、常用詞彙或口頭禪、應避免的寫法。
要求：繁體中文，條列式，300 字以內，只描述風格規律，不要複製貼文中的活動資訊或事實。只輸出風格指南本文。
${old ? `\n【現有風格指南（保留仍適用的規律）】\n${old}\n` : ''}
【最近喜愛的貼文】
${posts.map((x, i) => `--- 貼文${i + 1}（${x.platform}）---\n${x.content}`).join('\n')}`;
  }

  /** 「AI 學習風格」要帶進文案提示詞的內容：風格指南＋最近喜愛的範例 */
  function aiStyleText(profile, examples) {
    if (!profile && !examples.length) return '';
    return (profile ? `${profile}\n` : '') + (examples.length ? '使用者最近喜愛的範例貼文（請模仿其語感與結構，不要照抄內容）：\n' + examples.map((x, i) => `範例${i + 1}：${String(x.content).slice(0, 600)}`).join('\n') : '');
  }

  /** 把 AI 一次輸出的多個版本拆開 */
  const splitVariants = (text) => String(text).split(/^\s*={3,}\s*$/m).map((s) => s.trim()).filter(Boolean);

  /** 長文平台輸出的 【標題】 等區塊（取到下一個【為止的第一行） */
  function pickBlock(text, heading) {
    const m = String(text).match(new RegExp(`【${heading}】\\s*([^\\n【]+)`));
    return ((m && m[1]) || '').trim();
  }

  const api = {
    PLATFORMS, PLATFORM_NAMES, TONES, STATUS_LABEL, EVENT_FIELDS, blankEvent, QUICK, MARKETING, MARKETING_BY_KEY, KIND_LABEL, SCOPE_SOCIAL,
    scopeLabel, itemApplies, DEFAULT_PERSONA, eventSummary, variantCount, buildGeneratePrompt, buildRewritePrompt, convertInstruction,
    buildLearnPrompt, aiStyleText, splitVariants, pickBlock,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CopyPrompts = api;
})(typeof window !== 'undefined' ? window : globalThis);
