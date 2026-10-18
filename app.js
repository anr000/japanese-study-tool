(() => {
  "use strict";

  const STORAGE_KEY = "kotobacho-v1";
  const CONFIG_KEY = "kotobacho-ai-config-v1";
  const DICTIONARY_DB = "kotobacho-dictionary-v1";
  const DICTIONARY_STORE = "entries";
  const fileAiConfig = window.KOTOBA_AI_CONFIG || {};
  const hasFileAiConfig = Boolean(fileAiConfig.baseUrl && fileAiConfig.model);
  const sourceTypes = ["教材例句", "词典例句", "真实语料", "用户真实语料", "自己造句", "AI生成例句", "教材", "动漫", "游戏", "小说", "新闻", "网页", "YouTube", "其他"];
  const jlptLevels = ["N5", "N4", "N3", "N2", "N1", "未分类"];
  const externalResources = [
    { name: "Tatoeba API", category: "开放日语例句语料 · 可检索", url: "https://api.tatoeba.org/openapi", status: "开放只读 API；逐条显示作者与句子许可" },
    { name: "Japanese Language Data", category: "开放 JLPT 语法数据 · 可导入", url: "https://github.com/jkindrix/japanese-language-data" },
    { name: "OpenJLPT", category: "JLPT 学习资源", url: "https://openjlpt.com/" },
    { name: "BCCWJ", category: "现代书面语语料", url: "https://clrd.ninjal.ac.jp/bccwj/" },
    { name: "少納言", category: "日语书面语检索", url: "https://www.kotonoha.gr.jp/shonagon/" },
    { name: "中納言", category: "在线语料检索", url: "https://chunagon.ninjal.ac.jp/" },
    { name: "I-JAS", category: "日语学习者语料", url: "https://chunagon.ninjal.ac.jp/ijas/" },
    { name: "みんなの教材サイト", category: "国际交流基金教学资源", url: "https://www.kyozai.jpf.go.jp/kyozai/top/ja/render.do" },
    { name: "文法を楽しく", category: "日语教育语法参考", url: "https://www.tomojuku.com/blog/" }
  ];
  let state = loadState();
  let dictionaryEntries = [];
  let dictionaryReady = false;
  let dictionarySearch = "";
  let dictionaryFavoritesOnly = false;
  let selectedDictionaryEntryId = "";
  let pendingWordContext = null;
  let dictionaryDbPromise = null;
  let dictionaryLoadPromise = null;
  let mdictSources = [];
  let mdictSourcesLoaded = false;
  let mdictSelectedSourceId = "";
  let mdictQuery = "";
  let mdictResults = [];
  let mdictSearchAll = false;
  let mdictError = "";
  let mdictRequestVersion = 0;
  let corpusQuery = "";
  let corpusResults = [];
  let corpusPaging = null;
  let corpusError = "";
  let corpusRequestVersion = 0;
  let corpusTranslationLanguage = "cmn";
  let grammarSourcePreview = [];
  let grammarSourceMetadata = {};
  let grammarSourceLoading = false;
  let grammarSourceRequestVersion = 0;
  let aiConfig = { ...loadConfig(), ...Object.fromEntries(
    ["baseUrl", "model"].filter(key => typeof fileAiConfig[key] === "string" && fileAiConfig[key].trim())
      .map(key => [key, fileAiConfig[key].trim()])
  ) };
  let sessionApiKey = typeof fileAiConfig.apiKey === "string" ? fileAiConfig.apiKey.trim() : "";
  let page = "dashboard";
  let reviewFilter = "due";
  let selectedExerciseId = "";
  let revealedExerciseId = "";
  let pendingPracticeEvaluation = null;
  let grammarSearch = "";
  let grammarLevelFilter = "";
  let sentenceSearch = "";
  let sentenceGrammarFilter = "";
  let sentenceUsageFilter = "";
  let selectedGrammarId = state.grammars[0]?.id || "";
  let selectedSentenceId = state.sentences[0]?.id || "";

  const root = document.getElementById("page-root");
  const modalRoot = document.getElementById("modal-root");
  const pageNames = { dashboard: "总览", sentences: "句子语料", grammars: "语法知识库", dictionary: "词典与词库", sources: "外部资料", review: "练习与复习", settings: "设置与备份" };

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function starterState() {
    const grammarId = "grammar-youninaru";
    const usageId = "usage-ability-change";
    const now = new Date().toISOString();
    return {
      grammars: [{
        id: grammarId, name: "～ようになる", variants: "ようになった、ようになっている",
        connection: "V辞書形 / Vない形 + ようになる", type: "变化表达", jlpt: "N3",
        educationCategory: "变化", schoolCategory: "助動詞・形式名詞", related: "～ようにする、～ことになる",
        confusable: "～ようにする", source: "初始示例", myExplanation: "", myNotes: "",
        createdAt: now, updatedAt: now,
        usages: [{
          id: usageId, name: "能力变化", meaning: "表示某种能力变得能够做到。",
          explanation: "常与可能形搭配，表示经过变化后获得或失去某种能力。",
          connection: "可能形 + ようになる", conditions: "", cautions: "",
          confusable: "～ようにする（主动努力做到）", reference: "", myExplanation: "", myNotes: "",
          officialExamples: [], userExamples: []
        }]
      }],
      words: [],
      exercises: [],
      reviewAttempts: [],
      mistakes: [],
      sentences: [{
        id: "sentence-sample", japanese: "最近、日本語が少し話せるようになった。",
        chinese: "最近，稍微能说日语了。", source: "初始示例", sourceType: "其他",
        addedAt: now, notes: "", favorite: false, reviewed: false, analysisStatus: "已分析",
        instances: [{
          id: "instance-sample", grammarId, usageId, start: 9, end: 18,
          text: "話せるようになった", aiJudgment: "能力发生变化", confidence: 0.96,
          userConfirmed: true, userModified: false, origin: "示例"
        }], wordInstances: []
      }],
      dictionarySources: [{
        id: "source-user", name: "我的词库", type: "user", version: "", license: "用户自行编写",
        originalId: "", importedAt: now
      }]
    };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return starterState();
      const parsed = JSON.parse(saved);
      if (!parsed || !Array.isArray(parsed.grammars) || !Array.isArray(parsed.sentences)) {
        throw new Error("本地数据结构无效");
      }
      parsed.grammars.forEach(g => { if (!Array.isArray(g.usages)) g.usages = []; });
      parsed.sentences.forEach(s => {
        if (!Array.isArray(s.instances)) s.instances = [];
        if (!Array.isArray(s.wordInstances)) s.wordInstances = [];
      });
      if (!Array.isArray(parsed.words)) parsed.words = [];
      if (!Array.isArray(parsed.exercises)) parsed.exercises = [];
      if (!Array.isArray(parsed.reviewAttempts)) parsed.reviewAttempts = [];
      if (!Array.isArray(parsed.mistakes)) parsed.mistakes = [];
      if (!Array.isArray(parsed.dictionarySources)) parsed.dictionarySources = [];
      if (!parsed.dictionarySources.some(source => source.id === "source-user")) {
        parsed.dictionarySources.unshift({ id: "source-user", name: "我的词库", type: "user", version: "", license: "用户自行编写", originalId: "", importedAt: new Date().toISOString() });
      }
      return parsed;
    } catch (error) {
      console.error("读取本地数据失败", error);
      return starterState();
    }
  }

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("保存数据失败", error);
      toast("保存失败：浏览器存储空间可能已满，请先导出备份。", true);
    }
  }

  function openDictionaryDb() {
      if (!window.indexedDB) return Promise.reject(new Error("当前浏览器不支持 IndexedDB，无法安全保存词典数据。"));
      if (!dictionaryDbPromise) {
        dictionaryDbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(DICTIONARY_DB, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DICTIONARY_STORE)) db.createObjectStore(DICTIONARY_STORE, { keyPath: "id" });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("打开本地词典数据库失败。"));
        });
      }
      return dictionaryDbPromise;
    }

  function loadDictionaryEntries() {
    if (!dictionaryLoadPromise) {
      dictionaryLoadPromise = (async () => {
        const db = await openDictionaryDb();
        const entries = await new Promise((resolve, reject) => {
          const request = db.transaction(DICTIONARY_STORE, "readonly").objectStore(DICTIONARY_STORE).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("读取词典数据失败。"));
        });
        dictionaryEntries = entries;
        dictionaryReady = true;
        let migrated = false;
        state.sentences.forEach(sentence => {
          sentence.wordInstances ||= [];
          sentence.wordInstances.forEach(instance => {
            if (!instance.dictionaryEntryId && instance.wordId) {
              const previousEntry = entries.find(entry => entry.id === instance.wordId);
              if (previousEntry) {
                instance.dictionaryEntryId = previousEntry.id;
                instance.wordId = ensureWordEntity(previousEntry).id;
                migrated = true;
              }
            }
          });
        });
        if (migrated) persist();
        if (page === "dictionary") renderDictionary();
        if (page === "sources") renderSources();
      })().catch(error => {
        dictionaryLoadPromise = null;
        throw error;
      });
    }
    return dictionaryLoadPromise;
  }

  async function saveDictionaryEntries(entries) {
      const db = await openDictionaryDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DICTIONARY_STORE, "readwrite");
        const store = transaction.objectStore(DICTIONARY_STORE);
        const next = new Map(entries.map(entry => [entry.id, entry]));
        const previous = new Map(dictionaryEntries.map(entry => [entry.id, entry]));
        dictionaryEntries.forEach(entry => {
          if (!next.has(entry.id)) store.delete(entry.id);
        });
        entries.forEach(entry => {
          const old = previous.get(entry.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(entry)) store.put(entry);
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("保存词典数据失败。"));
        transaction.onabort = () => reject(transaction.error || new Error("保存词典数据的事务已取消。"));
      });
      dictionaryEntries = entries;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatDate(value) {
    if (!value) return "日期未知";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "日期未知" : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
  }

  function grammarById(id) {
    return state.grammars.find(item => item.id === id);
  }

  function usageById(grammar, usageId) {
    return grammar?.usages.find(item => item.id === usageId);
  }

  function ensureWordEntity(entry, details = {}) {
    state.words ||= [];
    let word = state.words.find(item => item.dictionaryEntryIds?.includes(entry.id))
      || state.words.find(item => item.headword === entry.headword);
    if (!word) {
      word = {
        id: uid("word"), headword: entry.headword, readings: [...(entry.readings || [])],
        partOfSpeech: [...(entry.partOfSpeech || [])], conjugationType: details.conjugationType || "",
        dictionaryEntryIds: [], relatedWordIds: [], myNotes: "", createdAt: new Date().toISOString()
      };
      state.words.push(word);
    }
    word.dictionaryEntryIds ||= [];
    if (!word.dictionaryEntryIds.includes(entry.id)) word.dictionaryEntryIds.push(entry.id);
    if (details.conjugationType && !word.conjugationType) word.conjugationType = details.conjugationType;
    if (!word.readings?.length && entry.readings?.length) word.readings = [...entry.readings];
    if (!word.partOfSpeech?.length && entry.partOfSpeech?.length) word.partOfSpeech = [...entry.partOfSpeech];
    return word;
  }

  function instanceLabel(instance) {
    const grammar = grammarById(instance.grammarId);
    const usage = usageById(grammar, instance.usageId);
    return `${grammar?.name || instance.pendingGrammarName || "待确认语法"}${usage ? ` · ${usage.name}` : instance.pendingUsageName ? ` · ${instance.pendingUsageName}` : ""}`;
  }

  function sentencesForUsage(grammarId, usageId) {
    return state.sentences.flatMap(sentence => sentence.instances
      .filter(instance => instance.grammarId === grammarId && (!usageId || instance.usageId === usageId))
      .map(instance => ({ sentence, instance })));
  }

  function toast(message, error = false) {
    const node = document.createElement("div");
    node.className = `toast${error ? " error" : ""}`;
    node.textContent = message;
    document.getElementById("toast-root").append(node);
    window.setTimeout(() => node.remove(), 3500);
  }

  function setPage(next) {
    page = next;
    document.querySelectorAll(".nav-item[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === next));
    document.getElementById("page-name").textContent = pageNames[next];
    render();
  }

  function render() {
    if (page === "dashboard") renderDashboard();
    if (page === "grammars") renderGrammars();
    if (page === "sentences") renderSentences();
    if (page === "dictionary") renderDictionary();
    if (page === "sources") renderSources();
    if (page === "review") renderReview();
    if (page === "settings") renderSettings();
  }

  function header(eyebrow, title, subtitle, actions = "") {
    return `<div class="hero"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div>${actions ? `<div class="hero-actions">${actions}</div>` : ""}</div>`;
  }

  function renderDashboard() {
    const recent = [...state.sentences].sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || "")).slice(0, 4);
    const mostUsed = state.grammars.map(grammar => ({
      grammar, count: state.sentences.reduce((sum, sentence) => sum + sentence.instances.filter(i => i.grammarId === grammar.id).length, 0)
    })).sort((a, b) => b.count - a.count).slice(0, 5);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentSentences = state.sentences.filter(item => new Date(item.addedAt).getTime() >= weekAgo).length;
    const usageCount = state.grammars.reduce((sum, item) => sum + item.usages.length, 0);
    const levelCounts = jlptLevels.slice(0, 5).map(level => `${level} ${state.grammars.filter(g => g.jlpt === level).length}`).join("　·　");
    root.innerHTML = `
      ${header("PERSONAL LANGUAGE NOTEBOOK", "把日语，学成自己的。", "从遇见一句话开始，慢慢建立属于你的语法与语料网络。",
        `<button class="button button-secondary" data-action="new-grammar">＋ 添加语法</button><button class="button button-primary" data-action="new-sentence">＋ 收集句子</button>`)}
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">我的句子</div><div class="stat-value">${state.sentences.length.toLocaleString()}</div><div class="stat-foot">最近 7 天新增 ${recentSentences} 句</div></div>
        <div class="stat-card"><div class="stat-label">语法条目</div><div class="stat-value">${state.grammars.length.toLocaleString()}</div><div class="stat-foot">多一个角度，多一层理解</div></div>
        <div class="stat-card"><div class="stat-label">具体用法</div><div class="stat-value">${usageCount.toLocaleString()}</div><div class="stat-foot">Grammar 与 Usage 独立关联</div></div>
        <div class="stat-card"><div class="stat-label">已建立语法关联</div><div class="stat-value">${state.sentences.reduce((sum, s) => sum + s.instances.length, 0).toLocaleString()}</div><div class="stat-foot">${esc(levelCounts || "从第一句开始积累")}</div></div>
      </div>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-heading"><div><h2>最近收集</h2><p>每个句子，都是一次真实的相遇。</p></div><button class="text-button" data-action="go-sentences">查看全部 →</button></div>
          <div class="sentence-list">${recent.length ? recent.map(sentence => `<div class="sentence-row" data-action="open-sentence" data-id="${esc(sentence.id)}"><div><div class="japanese">${esc(sentence.japanese)}</div><div class="sentence-meta">${esc(sentence.source || sentence.sourceType || "未注明来源")} · ${formatDate(sentence.addedAt)}</div></div><div class="sentence-row-right">${sentence.instances.length ? `<span class="pill">${sentence.instances.length} 个语法</span>` : `<span class="pill gray">待分析</span>`}</div></div>`).join("") : emptyMarkup("还没有收集的句子", "添加一句真实日语，开始你的语料库。")}</div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>常用语法</h2><p>从自己的例句中，发现熟悉的表达。</p></div><button class="text-button" data-action="go-grammars">语法库 →</button></div>
          <div class="grammar-mini-list">${mostUsed.length ? mostUsed.map(({ grammar, count }) => `<div class="grammar-mini" data-action="open-grammar" data-id="${esc(grammar.id)}"><div><div class="mini-name">${esc(grammar.name)}</div><div class="mini-sub">${esc(grammar.jlpt || "未分类")} · ${grammar.usages.length} 个用法</div></div><span class="mini-count">${count} 句 →</span></div>`).join("") : emptyMarkup("语法库还是空的", "添加语法后，把例句关联到具体用法。")}</div>
        </section>
      </div>`;
  }

  function targetLabel(exercise) {
    const grammar = grammarById(exercise.grammarId);
    const usage = usageById(grammar, exercise.usageId);
    return [grammar?.name, usage?.name].filter(Boolean).join(" → ") || "未关联语法";
  }

  function renderReview() {
    const now = Date.now();
    const dueCount = (state.exercises || []).filter(item => !item.suspended && new Date(item.dueAt || 0).getTime() <= now).length;
    const activeMistakes = (state.mistakes || []).filter(item => !item.resolvedAt);
    let items = [...(state.exercises || [])].filter(item => !item.suspended);
    if (reviewFilter === "due") items = items.filter(item => new Date(item.dueAt || 0).getTime() <= now);
    if (reviewFilter === "mistakes") {
      const mistakeIds = new Set(activeMistakes.map(item => item.exerciseId));
      items = items.filter(item => mistakeIds.has(item.id));
    }
    items.sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
    if (!items.some(item => item.id === selectedExerciseId)) selectedExerciseId = items[0]?.id || "";
    const selected = items.find(item => item.id === selectedExerciseId);
    const exerciseAttempts = (state.reviewAttempts || []).filter(item => item.exerciseId === selectedExerciseId);
    const lastAttempt = exerciseAttempts.at(-1);
    const isRevealed = revealedExerciseId === selectedExerciseId && Boolean(lastAttempt);
    const answerForm = selected && !isRevealed
      ? `<form id="review-answer-form" class="review-answer-form">${selected.type === "choice"
        ? `<div class="review-options">${selected.options.map((option, index) => `<label class="review-option"><input type="radio" name="answer" value="${esc(option)}" required><span>${String.fromCharCode(65 + index)}. ${esc(option)}</span></label>`).join("")}</div>`
        : `<label class="form-field"><span>你的答案</span><textarea name="answer" rows="3" required></textarea></label>`}<button class="button button-primary" type="submit">提交答案</button></form>`
      : "";
    const selectedMistake = activeMistakes.find(item => item.exerciseId === selectedExerciseId);
    const questionDetail = selected ? `<section class="panel review-question"><div class="tag-row"><span class="pill">${esc(selected.type === "choice" ? "选择题" : selected.type === "fill" ? "填空题" : "问答题")}</span><span class="pill gray">${esc(selected.difficulty || "未分级")}</span><span class="pill gray">${esc(selected.origin || "用户")}</span></div><h2>${esc(selected.prompt)}</h2>${selected.sourceSentenceId ? (() => { const sourceSentence = state.sentences.find(item => item.id === selected.sourceSentenceId); return sourceSentence ? `<p class="japanese">${esc(sourceSentence.japanese)}</p>` : ""; })() : ""}<p class="review-target">${esc(targetLabel(selected))}</p>${answerForm}${isRevealed ? `<div class="review-result ${lastAttempt.isCorrect ? "correct" : "incorrect"}"><strong>${lastAttempt.isCorrect ? "回答正确" : "回答错误"}</strong><p>你的答案：${esc(lastAttempt.answer || "（空）")}</p><p>参考答案：${esc(selected.correctAnswer)}</p><p>${esc(selected.explanation || "暂无解释，可手动补充题目说明。")}</p>${selectedMistake ? `<small>错题已记录 · 累计答错 ${selectedMistake.wrongCount} 次；重复错误会累加尝试，不会重复创建错题。</small>` : ""}<div class="review-ratings"><span>调整复习间隔：</span>${[["again","重来"],["hard","较难"],["good","记住了"],["easy","简单"]].map(([rating,label]) => `<button class="button button-secondary button-small" data-action="rate-exercise" data-id="${esc(selected.id)}" data-rating="${rating}">${label}</button>`).join("")}</div></div>` : ""}<div class="review-question-actions">${isRevealed ? `<button class="button button-secondary button-small" data-action="retry-exercise" data-id="${esc(selected.id)}">再答一次</button>` : ""}<button class="text-button button-small" data-action="edit-exercise" data-id="${esc(selected.id)}">编辑题目</button><button class="text-button button-small" data-action="delete-exercise" data-id="${esc(selected.id)}">删除题目</button></div></section>`
      : `<section class="panel review-question">${emptyMarkup(reviewFilter === "mistakes" ? "错题队列是空的" : "当前没有待复习题目", "可以手动创建练习，或为已有语法生成一道练习题。")}</section>`;
    const mistakeRows = activeMistakes.length ? activeMistakes.map(item => {
      const exercise = state.exercises.find(question => question.id === item.exerciseId);
      if (!exercise) return "";
      return `<button class="mistake-row" data-action="open-mistake" data-id="${esc(exercise.id)}"><span><strong>${esc(exercise.prompt)}</strong><small>${esc(targetLabel(exercise))} · 答错 ${item.wrongCount} 次 · 最近 ${formatDate(item.lastWrongAt)}</small></span><span class="pill orange">未掌握</span></button>`;
    }).join("") : `<p class="muted tiny">暂无未解决错题。答错的练习会自动记录，并按题目与知识点去重。</p>`;
    const attemptHistoryMarkup = selected && exerciseAttempts.length ? `<details class="panel review-history"><summary>本题作答历史（${exerciseAttempts.length} 次，显示最近 20 次）</summary><div class="mistake-list">${exerciseAttempts.slice(-20).reverse().map(attempt => {
      const answeredAt = new Date(attempt.answeredAt);
      const timeLabel = Number.isNaN(answeredAt.getTime()) ? formatDate(attempt.answeredAt) : `${formatDate(attempt.answeredAt)} ${answeredAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
      return `<div class="mistake-row"><span><strong>${attempt.isCorrect ? "回答正确" : "回答错误"} · ${esc(attempt.answer || "（空）")}</strong><small>${esc(timeLabel)}${attempt.rating ? ` · 复习评价：${esc(attempt.rating)}` : ""}</small></span><span class="pill ${attempt.isCorrect ? "" : "orange"}">${attempt.isCorrect ? "正确" : "错误"}</span></div>`;
    }).join("")}</div></details>` : "";
    const weakPoints = new Map();
    activeMistakes.forEach(mistake => {
      const key = `${mistake.grammarId || ""}::${mistake.usageId || ""}`;
      const current = weakPoints.get(key) || { grammarId: mistake.grammarId, usageId: mistake.usageId, wrongCount: 0, items: 0 };
      current.wrongCount += Number(mistake.wrongCount) || 0;
      current.items++;
      weakPoints.set(key, current);
    });
    const weakPointMarkup = weakPoints.size ? `<section class="panel weak-point-panel"><div class="panel-heading"><div><h2>重复错题较多的用法</h2><p>按未解决错题的累计答错次数排序；这是简单统计，不是 AI 错因诊断。</p></div></div><div class="mistake-list">${[...weakPoints.values()].sort((a, b) => b.wrongCount - a.wrongCount).slice(0, 5).map(point => `<div class="mistake-row"><span><strong>${esc(targetLabel(point))}</strong><small>${point.items} 道未解决题目</small></span><span class="pill orange">答错 ${point.wrongCount} 次</span></div>`).join("")}</div></section>` : "";
    root.innerHTML = `${header("PRACTICE & REVIEW", "练习与复习", "本地保存题目、作答历史与错题；无网络时也可以手动练习。", `<button class="button button-secondary" data-action="new-exercise">＋ 手动建题</button><button class="button button-primary" data-action="generate-exercise">✦ AI 生成题目</button>`)}
      <div class="stats-grid review-stats"><div class="stat-card"><div class="stat-label">待复习</div><div class="stat-value">${dueCount}</div><div class="stat-foot">到期题目</div></div><div class="stat-card"><div class="stat-label">未解决错题</div><div class="stat-value">${activeMistakes.length}</div><div class="stat-foot">按题目和知识点去重</div></div><div class="stat-card"><div class="stat-label">练习次数</div><div class="stat-value">${(state.reviewAttempts || []).length}</div><div class="stat-foot">保留每一次作答</div></div><div class="stat-card"><div class="stat-label">已保存题目</div><div class="stat-value">${(state.exercises || []).length}</div><div class="stat-foot">AI 与手动题目分开标记</div></div></div>
      <div class="search-toolbar review-filters"><button class="button ${reviewFilter === "due" ? "button-primary" : "button-quiet"} button-small" data-action="review-filter" data-filter="due">待复习 (${dueCount})</button><button class="button ${reviewFilter === "mistakes" ? "button-primary" : "button-quiet"} button-small" data-action="review-filter" data-filter="mistakes">错题 (${activeMistakes.length})</button><button class="button ${reviewFilter === "all" ? "button-primary" : "button-quiet"} button-small" data-action="review-filter" data-filter="all">全部题目</button></div>
      <div class="review-layout"><div class="review-queue">${items.length ? items.map(item => `<button class="review-queue-item${item.id === selectedExerciseId ? " selected" : ""}" data-action="select-exercise" data-id="${esc(item.id)}"><strong>${esc(item.prompt)}</strong><small>${esc(targetLabel(item))}</small><span class="pill gray">${new Date(item.dueAt || 0).getTime() <= now ? "待复习" : `到期 ${formatDate(item.dueAt)}`}</span></button>`).join("") : emptyMarkup("没有待复习题目", "切换到全部题目，或添加新的练习。")}</div>${questionDetail}</div>${attemptHistoryMarkup}${weakPointMarkup}
      <section class="panel mistake-panel"><div class="panel-heading"><div><h2>错题库</h2><p>同一题的重复错误会更新尝试次数，不会重复添加。</p></div></div><div class="mistake-list">${mistakeRows}</div></section>
      <section class="panel manual-fallback"><div class="panel-heading"><div><h2>离线人工造句练习</h2><p>可以不调用 AI，自己写句子并关联到一个语法用法。</p></div></div><button class="button button-secondary button-small" data-action="new-practice-sentence">＋ 添加自己的造句</button></section>`;
    const answerFormElement = document.getElementById("review-answer-form");
    answerFormElement?.addEventListener("submit", event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const answer = String(data.get("answer") || "").trim();
      if (!answer) { toast("请先填写或选择答案。", true); return; }
      submitExerciseAnswer(selectedExerciseId, answer);
    });
  }

  function emptyMarkup(title, description) {
    return `<div class="empty-state"><div class="empty-icon">◇</div><strong>${esc(title)}</strong>${esc(description)}</div>`;
  }

  function renderGrammars() {
    const query = grammarSearch.trim().toLocaleLowerCase();
    const matching = state.grammars.filter(grammar => !query || [
      grammar.name, grammar.variants, grammar.connection, grammar.type, grammar.jlpt,
      grammar.educationCategory, grammar.schoolCategory, grammar.related, grammar.confusable,
      grammar.myExplanation, grammar.myNotes, grammar.externalSource?.sourceName, grammar.externalSource?.license,
      grammar.externalSource?.sourceUrl,
      ...grammar.usages.flatMap(u => [u.name, u.meaning, u.explanation, u.connection, u.conditions, u.cautions, u.reference,
        u.myExplanation, u.myNotes, ...(u.officialExamples || [])])
    ].some(value => String(value || "").toLocaleLowerCase().includes(query)))
      .filter(grammar => !grammarLevelFilter || grammar.jlpt === grammarLevelFilter);
    if (!matching.some(item => item.id === selectedGrammarId)) selectedGrammarId = matching[0]?.id || "";
    const selected = grammarById(selectedGrammarId);
    root.innerHTML = `${header("GRAMMAR LIBRARY", "语法知识库", "从形式到意义，再到句子里的真实用法。",
      `<button class="button button-primary" data-action="new-grammar">＋ 添加语法</button>`)}
      <div class="search-toolbar"><div class="search-box"><input id="grammar-search" type="search" placeholder="搜索语法、意义、接续或自己的笔记…" value="${esc(grammarSearch)}"></div><select id="grammar-level-filter"><option value="">全部 JLPT</option>${jlptLevels.map(level => `<option value="${level}"${level === grammarLevelFilter ? " selected" : ""}>${level}</option>`).join("")}</select><span class="pill gray">${matching.length} 条语法</span></div>
      <div class="content-split"><div class="list-column">${matching.length ? matching.map(grammar => `<article class="grammar-card${grammar.id === selectedGrammarId ? " selected" : ""}" data-action="select-grammar" data-id="${esc(grammar.id)}"><div class="grammar-card-title">${esc(grammar.name)}</div><div class="grammar-card-meta"><span class="pill">${esc(grammar.jlpt || "未分类")}</span><span class="pill gray">${grammar.usages.length} 个用法</span><span class="pill gray">${sentencesForUsage(grammar.id).length} 个例句</span></div></article>`).join("") : emptyMarkup("没有找到语法", "试试其他关键词，或添加一条语法。")}</div>
      <div id="grammar-detail">${selected ? grammarDetailMarkup(selected) : `<section class="panel detail-panel">${emptyMarkup("选择一条语法", "或添加一条语法，开始建立自己的知识索引。")}</section>`}</div></div>`;
    const search = document.getElementById("grammar-search");
    search.addEventListener("input", event => { grammarSearch = event.target.value; const pos = event.target.selectionStart; renderGrammars(); const next = document.getElementById("grammar-search"); next.focus(); next.setSelectionRange(pos, pos); });
    document.getElementById("grammar-level-filter").addEventListener("change", event => { grammarLevelFilter = event.target.value; renderGrammars(); });
  }

  function grammarDetailMarkup(grammar) {
    const relatedSentences = sentencesForUsage(grammar.id);
    const usageBlocks = grammar.usages.map(usage => {
      const examples = sentencesForUsage(grammar.id, usage.id).slice(0, 3);
      const suppliedExamples = [...(usage.officialExamples || []).map(text => ({ text, label: "资料例句" })),
        ...(usage.userExamples || []).map(text => ({ text, label: "我的例句" }))];
      return `<section class="usage-card"><div class="usage-head"><div><div class="usage-name">${esc(usage.name)}</div><div class="usage-meaning">${esc(usage.meaning || usage.explanation || "尚未填写用法说明")}</div></div><button class="text-button button-small" data-action="edit-usage" data-grammar-id="${esc(grammar.id)}" data-usage-id="${esc(usage.id)}">编辑</button></div>
        ${usage.explanation ? `<div class="usage-note">${esc(usage.explanation)}</div>` : ""}
        ${usage.connection || usage.conditions || usage.cautions || usage.reference ? `<div class="detail-fields">${usage.connection ? detailField("用法接续", usage.connection) : ""}${usage.conditions ? detailField("使用条件", usage.conditions) : ""}${usage.cautions ? detailField("注意事项", usage.cautions) : ""}${usage.reference ? detailField("参考来源", usage.reference) : ""}</div>` : ""}
        ${usage.myExplanation ? `<div class="usage-note"><strong>我的理解：</strong>${esc(usage.myExplanation)}</div>` : ""}
        ${usage.myNotes ? `<div class="usage-note"><strong>我的备注：</strong>${esc(usage.myNotes)}</div>` : ""}
        <div class="usage-sentences">${examples.map(({ sentence, instance }) => `<div class="usage-example" data-action="open-sentence" data-id="${esc(sentence.id)}"><div class="japanese">${highlightInstance(sentence.japanese, instance)}</div><small>${esc(instance.text || "")} · ${esc(sentence.source || "未注明来源")}</small></div>`).join("")}${suppliedExamples.slice(0, 2).map(example => `<div class="usage-example"><div class="japanese">${esc(example.text)}</div><small>${esc(example.label)}</small></div>`).join("")}${!examples.length && !suppliedExamples.length ? `<small class="muted tiny">还没有关联例句</small>` : ""}</div>
        <div class="tag-row" style="margin-top:9px"><span class="pill gray">${relatedSentences.length} 条语料</span><button class="text-button button-small" data-action="add-usage-example" data-grammar-id="${esc(grammar.id)}" data-usage-id="${esc(usage.id)}">＋ 添加例句</button><button class="text-button button-small" data-action="filter-usage-sentences" data-grammar-id="${esc(grammar.id)}" data-usage-id="${esc(usage.id)}">查看全部 →</button></div></section>`;
    }).join("");
    return `<section class="panel detail-panel"><div class="detail-top"><div><div class="tag-row"><span class="pill">${esc(grammar.jlpt || "未分类")}</span>${grammar.type ? `<span class="pill gray">${esc(grammar.type)}</span>` : ""}${grammar.reviewStatus === "draft" ? `<span class="pill orange">来源资料未审校</span>` : ""}</div><h2 style="font-family:'Noto Sans JP',sans-serif;font-size:23px;margin:12px 0 0">${esc(grammar.name)}</h2></div><div class="tag-row"><button class="button button-secondary button-small" data-action="edit-grammar" data-id="${esc(grammar.id)}">编辑</button><button class="button button-danger button-small" data-action="delete-grammar" data-id="${esc(grammar.id)}">删除</button></div></div>
      ${grammar.myExplanation ? `<p class="detail-description"><strong>我的理解：</strong>${esc(grammar.myExplanation)}</p>` : ""}
      <div class="detail-fields">${detailField("常见变体", grammar.variants)}${detailField("接续", grammar.connection)}${detailField("日本語教育分类", grammar.educationCategory)}${detailField("学校文法分类", grammar.schoolCategory)}${detailField("相关语法", grammar.related)}${detailField("易混淆语法", grammar.confusable)}${detailField("数据来源", grammar.source)}${grammar.externalSource ? detailField("外部来源与许可证", `${grammar.externalSource.sourceName} · ${grammar.externalSource.license} · ${grammar.externalSource.sourceUrl} · 原始 ID ${grammar.externalSource.originalId}`) : ""}${grammar.myNotes ? detailField("我的备注", grammar.myNotes) : ""}</div>
      <div class="section-divider">具体用法 <span class="pill gray">${grammar.usages.length}</span></div>
      ${usageBlocks || emptyMarkup("还没有具体用法", "同一个语法形式可以有多个用法。")}
      <button class="button button-secondary button-small" style="margin-top:10px" data-action="new-usage" data-grammar-id="${esc(grammar.id)}">＋ 添加具体用法</button>
      <div class="section-divider">全部关联语料 <span class="pill gray">${relatedSentences.length}</span></div>
      ${relatedSentences.length ? `<div class="instance-list">${relatedSentences.slice(0, 5).map(({ sentence, instance }) => `<div class="instance-row" data-action="open-sentence" data-id="${esc(sentence.id)}"><div class="japanese">${highlightInstance(sentence.japanese, instance)}</div><div class="instance-tags"><span class="pill">${esc(usageById(grammar, instance.usageId)?.name || "待确认用法")}</span><span class="pill gray">${formatDate(sentence.addedAt)}</span></div></div>`).join("")}</div>` : `<p class="muted tiny">添加或分析句子后，关联语料会显示在这里。</p>`}
      </section>`;
  }

  function detailField(label, value) {
    return value ? `<div class="detail-field"><label>${esc(label)}</label><div>${esc(value)}</div></div>` : "";
  }

  function highlightInstance(sentence, instance) {
    const start = Number(instance.start);
    const end = Number(instance.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sentence.length) return esc(sentence);
    return `${esc(sentence.slice(0, start))}<span class="highlighted-text">${esc(sentence.slice(start, end))}</span>${esc(sentence.slice(end))}`;
  }

  function renderSentences() {
    const query = sentenceSearch.trim().toLocaleLowerCase();
    const matches = state.sentences.filter(sentence => {
      const grammarText = sentence.instances.map(instance => `${instanceLabel(instance)} ${instance.text}`).join(" ");
      const wordText = (sentence.wordInstances || []).map(instance => {
        const entry = dictionaryEntries.find(item => item.id === instance.dictionaryEntryId || (!instance.dictionaryEntryId && item.id === instance.wordId));
        const word = state.words.find(item => item.id === instance.wordId);
        return `${instance.surface} ${instance.pendingHeadword || ""} ${word?.headword || ""} ${entry?.headword || ""} ${(entry?.readings || []).join(" ")}`;
      }).join(" ");
      return (!query || [sentence.japanese, sentence.chinese, sentence.english, sentence.aiTranslation?.translation,
        sentence.aiTranslation?.explanation, sentence.source, sentence.sourceType, sentence.notes,
        sentence.corpusSource?.sourceName, sentence.corpusSource?.author, sentence.corpusSource?.license, grammarText, wordText]
        .some(value => String(value || "").toLocaleLowerCase().includes(query)))
        && (!sentenceGrammarFilter || sentence.instances.some(instance => instance.grammarId === sentenceGrammarFilter))
        && (!sentenceUsageFilter || sentence.instances.some(instance => instance.grammarId === sentenceGrammarFilter && instance.usageId === sentenceUsageFilter));
    }).sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""));
    if (!matches.some(item => item.id === selectedSentenceId)) selectedSentenceId = matches[0]?.id || "";
    const selected = state.sentences.find(item => item.id === selectedSentenceId);
    root.innerHTML = `${header("SENTENCE CORPUS", "句子语料", "从句子反向找到语法，也从语法找回遇见过的句子。",
      `<button class="button button-secondary" data-action="new-grammar">＋ 添加语法</button><button class="button button-primary" data-action="new-sentence">＋ 添加句子</button>`)}
      <div class="search-toolbar"><div class="search-box"><input id="sentence-search" type="search" placeholder="搜索日文、翻译、语法、用法或来源…" value="${esc(sentenceSearch)}"></div><select id="sentence-grammar-filter"><option value="">全部语法</option>${state.grammars.map(g => `<option value="${esc(g.id)}"${g.id === sentenceGrammarFilter ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select>${sentenceUsageFilter ? `<button class="button button-quiet button-small" data-action="clear-usage-filter">筛选：${esc(usageById(grammarById(sentenceGrammarFilter), sentenceUsageFilter)?.name || "具体用法")} ×</button>` : ""}<span class="pill gray">${matches.length} 条句子</span></div>
      <div class="sentence-view"><div class="list-column">${matches.length ? matches.map(sentence => `<article class="sentence-card${sentence.id === selectedSentenceId ? " selected" : ""}" data-action="select-sentence" data-id="${esc(sentence.id)}"><div class="tag-row"><span class="pill gray">${esc(sentence.sourceType || "其他")}</span><span class="sentence-meta">${formatDate(sentence.addedAt)}</span>${sentence.favorite ? `<span class="pill orange">收藏</span>` : ""}</div><div class="japanese">${esc(sentence.japanese)}</div>${sentence.chinese ? `<div class="sentence-meta">${esc(sentence.chinese)}</div>` : ""}${sentence.english ? `<div class="sentence-meta">${esc(sentence.english)}</div>` : ""}<div class="instance-tags">${sentence.instances.length ? sentence.instances.slice(0, 3).map(instance => `<span class="pill">${esc(instanceLabel(instance))}</span>`).join("") : `<span class="pill gray">尚未关联语法</span>`}</div></article>`).join("") : emptyMarkup("没有找到句子", "添加句子，或调整搜索条件。")}</div>
      <div id="sentence-detail">${selected ? sentenceDetailMarkup(selected) : `<section class="panel sentence-detail">${emptyMarkup("选择一条句子", "句子中的语法实例会显示在这里。")}</section>`}</div></div>`;
    document.getElementById("sentence-search").addEventListener("input", event => { sentenceSearch = event.target.value; const pos = event.target.selectionStart; renderSentences(); const next = document.getElementById("sentence-search"); next.focus(); next.setSelectionRange(pos, pos); });
    document.getElementById("sentence-grammar-filter").addEventListener("change", event => { sentenceGrammarFilter = event.target.value; sentenceUsageFilter = ""; renderSentences(); });
  }

  function renderDictionary() {
    const query = dictionarySearch.trim().toLocaleLowerCase();
    const lookupTerms = pendingWordContext && dictionarySearch === pendingWordContext.surface
      ? possibleDictionaryForms(pendingWordContext.surface)
      : [dictionarySearch];
    const results = dictionaryEntries.filter(entry => (!dictionaryFavoritesOnly || entry.isFavorite)
      && (!query || (pendingWordContext && dictionarySearch === pendingWordContext.surface
        ? entryMatchesTerms(entry, lookupTerms)
        : [
          entry.headword, ...(entry.spellings || []), ...(entry.readings || []), ...(entry.partOfSpeech || []),
          ...(entry.meanings || []), ...(entry.synonyms || []), entry.myNotes, entry.sourceName
        ].some(value => String(value || "").toLocaleLowerCase().includes(query)))))
      .sort((a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite))
        || String(a.headword).localeCompare(String(b.headword), "ja"));
    if (!results.some(entry => entry.id === selectedDictionaryEntryId)) {
      selectedDictionaryEntryId = results[0]?.id || "";
    }
    const selected = dictionaryEntries.find(entry => entry.id === selectedDictionaryEntryId);
    const sourceList = state.dictionarySources.filter(source => source.type !== "user");
    const mdictOptions = mdictSources.map(source => `<option value="${esc(source.id)}"${source.id === mdictSelectedSourceId ? " selected" : ""}>${esc(source.name)}${source.hasMdd ? " · 含配套 MDD" : ""}${esc(mdictSourceStatus(source))}</option>`).join("");
    const mdictStatus = !mdictSourcesLoaded ? "正在扫描词典文件夹…"
      : mdictSources.length ? `在项目「词典」目录发现 ${mdictSources.length} 个 MDict 词典。EUDIC 格式不支持。`
        : "未发现 .mdx 文件。把支持的 MDX 文件放入项目「词典」目录后重新扫描。";
    const groupedMdictResults = [...new Set(mdictResults.map(result => result.sourceId))]
      .map(sourceId => ({
        sourceId,
        sourceName: mdictResults.find(result => result.sourceId === sourceId)?.sourceName || "本地 MDict",
        entries: mdictResults.map((result, index) => ({ ...result, index })).filter(result => result.sourceId === sourceId)
      }));
    const renderMdictResult = ({ keyText, lookupTerm, sourceId }, index) => {
      const existing = dictionaryEntries.find(entry => entry.mdictDictionaryId === sourceId && entry.originalId === keyText);
      return `<article class="mdict-result"><strong>${esc(keyText)}</strong>${lookupTerm && lookupTerm !== keyText ? `<small class="muted tiny">匹配形式：${esc(lookupTerm)}</small>` : ""}<iframe class="mdict-preview" data-preview-index="${index}" sandbox="allow-scripts" referrerpolicy="no-referrer" title="隔离的词典条目预览"></iframe><div class="tag-row"><button class="button button-primary button-small" data-action="save-mdict-entry" data-result-index="${index}">${existing ? "↻ 更新本地词条" : "＋ 保存词条到我的词库"}</button><button class="button button-secondary button-small" data-action="collect-mdict-sentence" data-result-index="${index}">＋ 收集例句 / 句子</button>${pendingWordContext ? `<button class="button button-secondary button-small" data-action="link-mdict-word" data-headword="${esc(lookupTerm || keyText)}" data-source-id="${esc(sourceId)}">确认「${esc(lookupTerm || keyText)}」并关联到句中词语</button>` : ""}</div>${pendingWordContext ? `<small class="muted tiny">只保存句中词头和来源，不复制词典释义。</small>` : ""}</article>`;
    };
    const mdictResultMarkup = mdictResults.length
      ? `${mdictError ? `<p class="notice">${esc(mdictError)}</p>` : ""}${groupedMdictResults.map(group => {
        const content = group.entries.map(result => renderMdictResult(result, result.index)).join("");
        return mdictSearchAll
          ? `<details class="mdict-source-results" open><summary>${esc(group.sourceName)} · ${group.entries.length} 条</summary>${content}</details>`
          : content;
      }).join("")}`
      : mdictError ? `<p class="notice">${esc(mdictError)}</p>` : `<p class="muted tiny">${esc(mdictStatus)}</p>`;
    const changedDictionarySources = mdictSourcesLoaded ? state.dictionarySources.filter(source => source.type === "mdict")
      .map(source => ({ source, current: mdictSources.find(item => item.id === source.mdictDictionaryId) }))
      .filter(({ source, current }) => !current || source.sourceFingerprint !== current.sourceFingerprint) : [];
    root.innerHTML = `${header("LOCAL DICTIONARY", "词典与我的词库", "查词、收藏，并把句子里的词语连接到自己的语料。", `<button class="button button-secondary" data-action="add-word">＋ 手动添加词条</button><button class="button button-primary" data-action="import-dictionary">↓ 导入词典</button>`)}
      <section class="setting-card mdict-panel"><div class="panel-heading"><div><h2>本地 MDict 词典</h2><p>直接检索项目「词典」目录中的个人词典文件；不会上传或导入整本词典。</p></div></div>
        <div class="search-toolbar"><select id="mdict-source" aria-label="选择 MDict 词典"${mdictSearchAll ? " disabled" : ""}><option value="">选择词典</option>${mdictOptions}</select><input id="mdict-query" type="search" placeholder="输入词头精确查找…" value="${esc(mdictQuery)}"><button class="button button-primary button-small" data-action="search-mdict"${mdictSources.length ? "" : " disabled"}>查找</button><button class="button ${mdictSearchAll ? "button-primary" : "button-secondary"} button-small" data-action="toggle-mdict-search-all">${mdictSearchAll ? "✓ 搜索全部词典" : "搜索全部词典"}</button><button class="button button-secondary button-small" data-action="reload-mdict-sources">重新连接 / 扫描</button></div>
        <div id="mdict-results" aria-live="polite">${mdictResultMarkup}</div>
        ${changedDictionarySources.length ? `<p class="notice">${changedDictionarySources.map(({ source, current }) => current ? `词典「${esc(source.name)}」文件已变化；本地已保存的词条不会被覆盖，请重新查词并手动更新。` : `词典「${esc(source.name)}」文件目前未找到；已保存的本地词条与笔记仍保留。`).join("<br>")}</p>` : ""}
        <p class="notice">支持 MDict .mdx 和配套 .mdd 中的图片、音频、CSS、JS 及字体资源；不设词典文件或单个媒体资源大小上限。MDD 是 MDX 的媒体资源包，不是可单独检索的词典；放在同目录且同名时会自动连接，不需单独导入。词典按需读取词块，避免启动时把整本词头索引载入内存。词典 HTML/CSS/脚本在无同源权限的隔离沙箱中呈现；沙箱不能访问应用数据或 API 配置，CSP 禁止网络 API 请求和外部资源，只允许从本地白名单资源地址加载。保存到个人词库只复制你明确选择的单条词目与来源信息；不要批量再分发受版权保护的内容。欧陆 EUDIC 专有格式不支持。</p>
        <p class="muted tiny">JMdict XML/JSON/CSV/TSV 可通过右上方「导入词典」建立本地 IndexedDB 词条索引。官方数据：<a href="https://www.edrdg.org/jmdict/j_jmdict.html" target="_blank" rel="noopener noreferrer">JMdict 项目 ↗</a> · <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener noreferrer">EDRDG 许可 ↗</a> · <a href="https://www.edrdg.org/pub/Nihongo/JMdict_e.gz" target="_blank" rel="noopener noreferrer">官方 JMdict 英文数据下载（GZip） ↗</a>。官方下载的 .gz 需先解压成 XML 再导入；按 CC BY-SA 4.0 保留署名并遵守相同方式共享。</p>
      </section>
      <div class="search-toolbar"><div class="search-box"><input id="dictionary-search" type="search" placeholder="搜索词条、读音、释义或词性…" value="${esc(dictionarySearch)}"></div><button class="button ${dictionaryFavoritesOnly ? "button-primary" : "button-quiet"} button-small" data-action="toggle-wordbook-filter">☆ 我的词库 ${dictionaryEntries.filter(entry => entry.isFavorite).length}</button><span class="pill gray">${dictionaryReady ? `${results.length} 条结果 · ${dictionaryEntries.length} 条本地词条` : "正在读取本地词典…"}</span></div>
      <div class="content-split dictionary-layout"><div class="list-column">${results.length ? results.slice(0, 250).map(entry => `<article class="grammar-card${entry.id === selectedDictionaryEntryId ? " selected" : ""}" data-action="select-dictionary-entry" data-id="${esc(entry.id)}"><div class="grammar-card-title">${esc(entry.headword)}${entry.isFavorite ? "　☆" : ""}</div><div class="mini-sub">${esc((entry.readings || []).join("、") || "暂无读音")}</div><div class="grammar-card-meta"><span class="pill gray">${esc((entry.partOfSpeech || []).slice(0, 2).join(" · ") || "未标注词性")}</span><span class="mini-count">${dictionaryEntryOccurrenceCount(entry.id)} 次语料出现</span></div></article>`).join("") : emptyMarkup(dictionaryReady ? "没有找到词条" : "正在读取词典", dictionaryReady ? "调整搜索条件，或导入自己的词典。" : "大词典保存在本地 IndexedDB 中。")}</div>
      <div id="dictionary-detail">${selected ? dictionaryDetailMarkup(selected) : `<section class="panel detail-panel">${emptyMarkup("选择或搜索一个词条", "支持 JMdict XML、CSV、TSV、JSON 与自定义字段映射。")}</section>`}</div></div>
      <section class="setting-card source-panel"><div class="panel-heading"><div><h2>数据来源与许可</h2><p>外部词条保留来源、版本、原始 ID 和导入时间。</p></div></div><div class="source-list">${sourceList.length ? sourceList.map(source => `<div class="source-row"><div><strong>${esc(source.name)}</strong><small>${esc(source.type)}${source.version ? ` · ${esc(source.version)}` : ""} · ${esc(source.license || "许可未注明")} · 导入于 ${formatDate(source.importedAt)}${source.url ? ` · ${esc(source.url)}` : ""}</small></div><button class="button button-danger button-small" data-action="remove-dictionary-source" data-id="${esc(source.id)}">移除来源</button></div>`).join("") : `<p class="muted tiny">尚未导入外部词典。</p>`}</div><p class="notice">JMdict 许可：CC BY-SA 4.0。使用或再分发 JMdict 数据时，请保留署名并遵循相同方式共享要求。软件不会内置或抓取商业词典；EPWING 暂未实现解析。</p></section>`;
    mdictResults.forEach((result, index) => {
      const frame = root.querySelector(`.mdict-preview[data-preview-index="${index}"]`);
      if (frame) frame.srcdoc = mdictDefinitionDocument(result.definition, result.sourceId);
    });
    const importedFrame = root.querySelector(".mdict-imported-definition[data-entry-id]");
    if (importedFrame) {
      const entry = dictionaryEntries.find(item => item.id === importedFrame.dataset.entryId);
      if (entry?.mdictDefinition) importedFrame.srcdoc = mdictDefinitionDocument(entry.mdictDefinition, entry.mdictDictionaryId);
    }
    const searchInput = document.getElementById("dictionary-search");
    searchInput.addEventListener("input", event => {
      dictionarySearch = event.target.value;
      const position = event.target.selectionStart;
      renderDictionary();
      const next = document.getElementById("dictionary-search");
      next.focus();
      next.setSelectionRange(position, position);
    });
    document.getElementById("mdict-source")?.addEventListener("change", event => {
      mdictSelectedSourceId = event.target.value;
      mdictResults = [];
      mdictError = "";
      renderDictionary();
    });
    document.getElementById("mdict-query")?.addEventListener("input", event => {
      mdictQuery = event.target.value;
    });
    document.getElementById("mdict-query")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchMdictDictionary();
      }
    });
  }

  function mdictSourceRecordId(sourceId) {
    return `mdict-source-${sourceId}`;
  }

  function mdictSourceStatus(source) {
    const record = state.dictionarySources.find(item => item.id === mdictSourceRecordId(source.id));
    if (!record) return "";
    if (record.sourceFingerprint !== source.sourceFingerprint) return " · 文件已更新";
    return "";
  }

  async function loadMdictSources() {
    try {
      const response = await fetch("/api/dictionaries");
      if (!response.ok) throw new Error(`本地词典服务返回 HTTP ${response.status}。`);
      const payload = await response.json();
      mdictSources = Array.isArray(payload.dictionaries) ? payload.dictionaries : [];
      if (!mdictSources.some(source => source.id === mdictSelectedSourceId)) {
        mdictSelectedSourceId = (mdictSources.find(source => /词典|辞典/.test(source.name)) || mdictSources[0])?.id || "";
      }
      mdictError = "";
    } catch (error) {
      console.error("扫描本地 MDict 词典失败", error);
      mdictSources = [];
      mdictSelectedSourceId = "";
      mdictError = error instanceof TypeError || error.message === "Failed to fetch"
        ? "无法连接本地词典服务。请在项目目录运行 npm start，并使用 http://127.0.0.1:4173 打开本软件；不要用 file:// 或 Live Server。"
        : `无法扫描本地 MDict 词典：${error.message}`;
    } finally {
      mdictSourcesLoaded = true;
      if (page === "dictionary") renderDictionary();
    }
  }

  function mdictResourcePath(rawPath) {
    let resource = String(rawPath || "").trim();
    if (!resource || /^(?:https?:|data:|javascript:|file:|\/\/)/i.test(resource)) return "";
    if (/^sound:\/\//i.test(resource)) resource = resource.slice(8);
    resource = resource.split(/[?#]/, 1)[0];
    try { resource = decodeURIComponent(resource); } catch { return ""; }
    if (/[\u0000-\u001f\u007f:]/.test(resource)) return "";
    const segments = resource.replace(/\\/g, "/").split("/").filter(Boolean);
    if (!segments.length || segments.some(segment => segment === "." || segment === "..")) return "";
    const key = `\\${segments.join("\\")}`;
    if (!/\.(?:png|jpe?g|gif|webp|mp3|ogg|wav|css|js|woff2?|ttf|otf)$/i.test(key)) return "";
    return key;
  }

  function mdictResourceUrl(sourceId, resourcePath) {
    const key = mdictResourcePath(resourcePath);
    if (!key || !sourceId) return "";
    const params = new URLSearchParams({ id: sourceId, key });
    return `/api/dictionary/resource?${params}`;
  }

  function rewriteMdictCss(css, sourceId) {
    return String(css || "")
      .replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi, (match, quote, quoted, bare) => {
        const url = mdictResourceUrl(sourceId, (quoted ?? bare ?? "").trim());
        return url ? `url("${url}")` : "url(\"\")";
      })
      .replace(/@import\s+(["'])(.*?)\1/gi, (match, quote, reference) => {
        const url = mdictResourceUrl(sourceId, reference);
        return url ? `@import url("${url}")` : "";
      });
  }

  function mdictDefinitionDocument(definition, sourceId) {
    const documentNode = new DOMParser().parseFromString(String(definition || ""), "text/html");
    documentNode.querySelectorAll("base,iframe,object,embed,form,video,meta[http-equiv]").forEach(node => node.remove());
    documentNode.querySelectorAll("style").forEach(style => {
      style.textContent = rewriteMdictCss(style.textContent, sourceId);
    });
    documentNode.querySelectorAll("link").forEach(link => {
      if (!String(link.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("stylesheet")) {
        link.remove();
        return;
      }
      const url = mdictResourceUrl(sourceId, link.getAttribute("href"));
      if (!url) {
        link.remove();
        return;
      }
      link.setAttribute("href", url);
      link.setAttribute("referrerpolicy", "no-referrer");
    });
    documentNode.querySelectorAll("script[src]").forEach(script => {
      const url = mdictResourceUrl(sourceId, script.getAttribute("src"));
      if (!url) {
        script.remove();
        return;
      }
      script.setAttribute("src", url);
      script.setAttribute("referrerpolicy", "no-referrer");
    });
    documentNode.querySelectorAll("a").forEach(anchor => {
      const soundUrl = /^sound:\/\//i.test(anchor.getAttribute("href") || "");
      if (soundUrl) {
        const url = mdictResourceUrl(sourceId, anchor.getAttribute("href"));
        const audio = url ? documentNode.createElement("audio") : null;
        if (audio) {
          audio.setAttribute("controls", "");
          audio.setAttribute("preload", "none");
          audio.setAttribute("src", url);
          anchor.replaceWith(audio);
          return;
        }
      }
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
    });
    documentNode.querySelectorAll("img").forEach(image => {
      const url = mdictResourceUrl(sourceId, image.getAttribute("src") || image.getAttribute("data-src"));
      if (!url) {
        image.removeAttribute("src");
        image.removeAttribute("srcset");
        return;
      }
      image.setAttribute("src", url);
      image.removeAttribute("srcset");
      image.setAttribute("referrerpolicy", "no-referrer");
    });
    documentNode.querySelectorAll("audio,source").forEach(media => {
      const url = mdictResourceUrl(sourceId, media.getAttribute("src"));
      if (!url || (media.tagName === "SOURCE" && !media.closest("audio"))) {
        media.remove();
        return;
      }
      media.setAttribute("src", url);
      if (media.tagName === "AUDIO") {
        media.setAttribute("controls", "");
        media.setAttribute("preload", "none");
        media.setAttribute("referrerpolicy", "no-referrer");
      }
    });
    documentNode.querySelectorAll("[style]").forEach(node => {
      node.setAttribute("style", rewriteMdictCss(node.getAttribute("style"), sourceId));
    });
    const origin = window.location.origin;
    const resourceOrigin = `${origin}/api/dictionary/resource`;
    const policy = [
      "default-src 'none'",
      `img-src ${resourceOrigin} data: blob:`,
      `media-src ${resourceOrigin} data: blob:`,
      `style-src 'unsafe-inline' ${resourceOrigin}`,
      `script-src 'unsafe-inline' ${resourceOrigin}`,
      `font-src ${resourceOrigin} data:`,
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "worker-src 'none'"
    ].join("; ");
    const csp = documentNode.createElement("meta");
    csp.setAttribute("http-equiv", "Content-Security-Policy");
    csp.setAttribute("content", policy);
    documentNode.head.prepend(csp);
    const resizeScript = documentNode.createElement("script");
    resizeScript.textContent = "(()=>{const send=()=>parent.postMessage({type:'mdict-preview-resize',height:document.documentElement.scrollHeight},'*');addEventListener('load',send);new ResizeObserver(send).observe(document.documentElement)})()";
    documentNode.body.append(resizeScript);
    return `<!doctype html>${documentNode.documentElement.outerHTML}`;
  }

  async function searchMdictDictionary(queryOverride = "") {
    const query = String(queryOverride || document.getElementById("mdict-query")?.value || mdictQuery).trim();
    const sourceId = document.getElementById("mdict-source")?.value || mdictSelectedSourceId;
    if (!query) { toast("请输入词头。", true); return; }
    if (!mdictSourcesLoaded) await loadMdictSources();
    if (mdictSearchAll && !mdictSources.length) {
      mdictError = "没有发现可查询的本地 .mdx 词典。";
      renderDictionary();
      return;
    }
    if (!mdictSearchAll && !sourceId && !mdictSelectedSourceId) {
      mdictError ||= "没有可用的本地 MDict 词典。请确认 .mdx 文件位于项目「词典」目录，然后重新扫描。";
      renderDictionary();
      return;
    }
    const activeSourceId = sourceId || mdictSelectedSourceId;
    if (!mdictSearchAll) mdictSelectedSourceId = activeSourceId;
    mdictQuery = query;
    mdictError = "";
    mdictResults = [];
    const requestVersion = ++mdictRequestVersion;
    renderDictionary();
    try {
      const lookupTerms = pendingWordContext && query === pendingWordContext.surface ? possibleDictionaryForms(query) : [query];
      const foundEntries = new Map();
      for (const term of lookupTerms.slice(0, 8)) {
        const params = new URLSearchParams({ q: term });
        if (!mdictSearchAll) params.set("id", activeSourceId);
        let response;
        try {
          response = await fetch(`/api/dictionary/${mdictSearchAll ? "search-all" : "search"}?${params}`);
        } catch (error) {
          if (error instanceof TypeError || error.message === "Failed to fetch") {
            throw new Error("无法连接本地词典服务。请在项目目录运行 npm start，并通过 http://127.0.0.1:4173 使用本软件。");
          }
          throw error;
        }
        let payload;
        try { payload = await response.json(); }
        catch { throw new Error("本地词典 API 未返回 JSON。请通过 npm start 启动本软件，而不是使用静态网页服务器。"); }
        if (!response.ok) throw new Error(payload.error || `词典查询失败（HTTP ${response.status}）。`);
        if (requestVersion !== mdictRequestVersion) return;
        const groups = mdictSearchAll
          ? (payload.results || []).map(group => group.error
            ? (foundEntries.set(`error\u0000${group.source.id}\u0000${term}`, {
              sourceId: group.source.id, sourceName: group.source.name, error: group.error
            }), null)
            : ({ source: group.source, results: group.results || [] })).filter(Boolean)
          : [{ source: payload.source || { id: activeSourceId, name: mdictSources.find(source => source.id === activeSourceId)?.name || "本地 MDict" }, results: payload.results || [] }];
        for (const group of groups) {
          for (const result of group.results) {
            const entry = {
              keyText: String(result.keyText || term),
              lookupTerm: term,
              definition: result.definition,
              sourceId: group.source.id,
              sourceName: group.source.name,
              sourceFingerprint: group.source.sourceFingerprint
            };
            foundEntries.set(`${term}\u0000${entry.sourceId}\u0000${entry.keyText}\u0000${entry.definition}`, entry);
          }
        }
      }
      const values = [...foundEntries.values()];
      mdictResults = values.filter(result => !result.error);
      const failures = values.filter(result => result.error);
      mdictError = failures.length ? `${failures.length} 本词典查询失败：${failures.map(item => `${item.sourceName}（${item.error}）`).join("；")}` : "";
      if (!mdictResults.length && !failures.length) mdictError = `「${query}」在${mdictSearchAll ? "所有本地词典" : "此词典"}中没有精确匹配。`;
    } catch (error) {
      if (requestVersion !== mdictRequestVersion) return;
      mdictError = error.message || "本地词典查询失败。";
      console.error("本地 MDict 查询失败", error);
    }
    if (page === "dictionary") renderDictionary();
  }

  async function openMdictLookup(context, query) {
    pendingWordContext = context;
    dictionarySearch = "";
    dictionaryFavoritesOnly = false;
    mdictQuery = query;
    mdictResults = [];
    mdictError = "";
    setPage("dictionary");
    if (!mdictSourcesLoaded) await loadMdictSources();
    if (!mdictSources.length) {
      if (!mdictError) mdictError = "没有发现本地 .mdx 词典。请把词典放入项目「词典」目录后重新扫描。";
      renderDictionary();
      return;
    }
    await searchMdictDictionary(query);
  }

  function linkMdictWordToSentence(headword, sourceId = mdictSelectedSourceId) {
    if (!pendingWordContext || !headword) return;
    const context = pendingWordContext;
    const sentence = state.sentences.find(item => item.id === context.sentenceId);
    if (!sentence) {
      toast("原句已不存在，无法建立关联。", true);
      return;
    }
    state.words ||= [];
    let word = state.words.find(item => item.headword === headword);
    if (!word) {
      word = {
        id: uid("word"), headword, readings: [], partOfSpeech: [], conjugationType: "",
        dictionaryEntryIds: [], dictionarySources: [], relatedWordIds: [], myNotes: "", createdAt: new Date().toISOString()
      };
      state.words.push(word);
    }
    word.dictionaryEntryIds ||= [];
    word.dictionarySources ||= [];
    if (!word.dictionarySources.some(source => source.id === sourceId)) {
      word.dictionarySources.push({
        id: sourceId,
        name: mdictSources.find(source => source.id === sourceId)?.name || "本地 MDict",
        type: "mdict"
      });
    }
    sentence.wordInstances ||= [];
    const duplicate = sentence.wordInstances.find(item => item.start === context.start && item.end === context.end);
    const instance = {
      id: duplicate?.id || uid("word-instance"), wordId: word.id, dictionaryEntryId: "", surface: context.surface,
      pendingHeadword: headword, start: context.start, end: context.end,
      form: duplicate?.form || (context.surface === headword ? "辞書形 / 原形" : "句中形式"),
      dictionarySourceId: sourceId, userConfirmed: true, origin: "用户确认"
    };
    if (duplicate) Object.assign(duplicate, instance); else sentence.wordInstances.push(instance);
    persist();
    pendingWordContext = null;
    setPage("sentences");
    toast(`「${headword}」已关联到句中词语；只保存了词头和来源。`);
  }

  function mdictResultFromElement(element) {
    const index = Number(element.dataset.resultIndex);
    return Number.isInteger(index) && index >= 0 ? mdictResults[index] : null;
  }

  function mdictDefinitionText(definition) {
    const documentNode = new DOMParser().parseFromString(String(definition || ""), "text/html");
    documentNode.querySelectorAll("script,style,head,svg,iframe,object,embed").forEach(node => node.remove());
    return (documentNode.body.textContent || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  }

  async function commitMdictEntryImport(result, license, rightsConfirmed) {
    if (!String(result.definition || "").trim()) {
      toast("此词条没有可保存的释义内容。", true);
      return;
    }
    const source = mdictSources.find(item => item.id === result.sourceId);
    if (!source || source.sourceFingerprint !== result.sourceFingerprint) {
      toast("词典文件已变化或已移走；请重新扫描并查询，再导入当前版本。", true);
      return;
    }
    if (!rightsConfirmed || !license.trim()) {
      toast("请确认个人保存权限并填写词典许可信息。", true);
      return;
    }
    const now = new Date().toISOString();
    const sourceId = mdictSourceRecordId(source.id);
    const previousSource = state.dictionarySources.find(item => item.id === sourceId);
    const sourceRecord = {
      ...(previousSource || {}),
      id: sourceId,
      name: source.name,
      type: "mdict",
      relativePath: source.relativePath,
      version: `MDX ${source.sizeBytes} bytes · ${source.modifiedAt}${source.hasMdd ? ` · MDD ${source.mddSizeBytes} bytes · ${source.mddModifiedAt}` : ""}`,
      sourceFingerprint: source.sourceFingerprint,
      mdictDictionaryId: source.id,
      license: license.trim(),
      personalCopyConfirmedAt: previousSource?.personalCopyConfirmedAt || now,
      originalId: source.relativePath,
      importedAt: previousSource?.importedAt || now,
      updatedAt: now
    };
    const existing = dictionaryEntries.find(entry => entry.sourceId === sourceId && entry.originalId === result.keyText);
    const plainText = mdictDefinitionText(result.definition);
    const entry = {
      ...(existing || {}),
      id: existing?.id || `mdict-entry-${source.id}-${result.keyText}`,
      headword: result.keyText,
      readings: existing?.readings || [],
      spellings: existing?.spellings || [],
      partOfSpeech: existing?.partOfSpeech || [],
      meanings: plainText ? [plainText] : [],
      synonyms: existing?.synonyms || [],
      sourceId,
      sourceName: source.name,
      sourceType: "mdict",
      sourceVersion: sourceRecord.version,
      sourceFingerprint: source.sourceFingerprint,
      sourcePath: source.relativePath,
      license: sourceRecord.license,
      originalId: result.keyText,
      importedAt: existing?.importedAt || now,
      updatedAt: now,
      mdictDictionaryId: source.id,
      mdictDefinition: result.definition,
      isFavorite: true,
      myNotes: existing?.myNotes || ""
    };
    try {
      const nextEntries = [...dictionaryEntries.filter(item => item.id !== entry.id), entry];
      await saveDictionaryEntries(nextEntries);
      const sourceIndex = state.dictionarySources.findIndex(item => item.id === sourceId);
      if (sourceIndex < 0) state.dictionarySources.push(sourceRecord);
      else state.dictionarySources[sourceIndex] = sourceRecord;
      persist();
      selectedDictionaryEntryId = entry.id;
      dictionarySearch = entry.headword;
      closeModal();
      renderDictionary();
      toast(`「${entry.headword}」已保存到本地词库；仅导入了这一条词目。`);
    } catch (error) {
      console.error("保存 MDict 词条失败", error);
      toast(`保存 MDict 词条失败：${error.message || "本地存储不可用"}`, true);
    }
  }

  function saveMdictEntryFromResult(result) {
    if (!result) return;
    const source = mdictSources.find(item => item.id === result.sourceId);
    if (!source) {
      toast("找不到该本地词典来源，请重新扫描。", true);
      return;
    }
    const existingSource = state.dictionarySources.find(item => item.id === mdictSourceRecordId(source.id));
    if (existingSource?.personalCopyConfirmedAt) {
      void commitMdictEntryImport(result, existingSource.license || "未注明", true);
      return;
    }
    const license = existingSource?.license || "个人使用（由我确认）";
    const body = `<p class="notice">这只会把你当前选择的单条词目复制到本机 IndexedDB，不会批量导入整本词典或上传内容。原词典文件仍作为查询和媒体资源来源。</p><p class="notice">词典：${esc(source.name)}<br>文件：${esc(source.relativePath)}<br>当前版本：${esc(source.sizeBytes)} bytes · ${esc(source.modifiedAt)}${source.hasMdd ? `<br>配套 MDD：${esc(source.mddSizeBytes)} bytes · ${esc(source.mddModifiedAt)}` : ""}</p>${field("许可 / 个人使用说明", "mdictLicense", license, { required: true, full: true })}<label class="form-field full"><input type="checkbox" name="confirmMdictRights" required> 我确认已获准将这条词典内容保存到本机个人词库，并会遵守该词典的许可，不未经许可对外分享或再分发。</label>`;
    openModal("保存词典词条到本地", "请为此来源记录许可信息，并确认你有权制作个人本地副本。", body, data => {
      const confirmed = data.get("confirmMdictRights") === "on";
      void commitMdictEntryImport(result, String(data.get("mdictLicense") || ""), confirmed);
    }, "确认并保存单条词目");
  }

  function collectMdictSentenceFromResult(result) {
    if (!result) return;
    const source = mdictSources.find(item => item.id === result.sourceId);
    const documentNode = new DOMParser().parseFromString(String(result.definition || ""), "text/html");
    const candidates = [...documentNode.querySelectorAll("p, li, blockquote")]
      .filter(node => /(?:example|sentence|rei|例|用例)/i.test(`${node.className || ""} ${node.id || ""}`))
      .map(node => (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(text => /[\u3040-\u30ff\u3400-\u9fff]/.test(text));
    const example = candidates[0] || "";
    addSentence({
      japanese: example,
      sourceType: "词典例句",
      source: `${source?.name || "本地 MDict"} · ${result.keyText}`,
      notes: example ? "" : "请从词典条目中复制并粘贴要收集的日语例句。"
    });
  }

  function dictionaryEntryOccurrenceCount(entryId) {
    return state.sentences.reduce((count, sentence) => count + (sentence.wordInstances || [])
      .filter(instance => instance.dictionaryEntryId === entryId
        || (!instance.dictionaryEntryId && instance.wordId === entryId)).length, 0);
  }

  function dictionaryDetailMarkup(entry) {
    const source = state.dictionarySources.find(item => item.id === entry.sourceId);
    const occurrences = state.sentences.flatMap(sentence => (sentence.wordInstances || [])
      .filter(instance => instance.dictionaryEntryId === entry.id || (!instance.dictionaryEntryId && instance.wordId === entry.id))
      .map(instance => ({ sentence, instance })));
    const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];
    return `<section class="panel detail-panel"><div class="detail-top"><div><div class="tag-row"><span class="pill">${esc(source?.name || entry.sourceName || "未知来源")}</span>${entry.isFavorite ? `<span class="pill orange">我的词库</span>` : ""}</div><h2 class="word-headword">${esc(entry.headword)}</h2></div><div class="tag-row"><button class="button ${entry.isFavorite ? "button-secondary" : "button-primary"} button-small" data-action="toggle-wordbook" data-id="${esc(entry.id)}">${entry.isFavorite ? "✓ 已收藏" : "＋ 加入我的词库"}</button><button class="button button-secondary button-small" data-action="edit-word" data-id="${esc(entry.id)}">编辑笔记</button><button class="button button-danger button-small" data-action="delete-word" data-id="${esc(entry.id)}">删除词条</button></div></div>
      ${pendingWordContext ? `<div class="notice green dictionary-notice">当前句子中的「${esc(pendingWordContext.surface)}」${possibleDictionaryForms(pendingWordContext.surface).length > 1 ? ` · 词形候选：${possibleDictionaryForms(pendingWordContext.surface).slice(1).map(esc).join("、")}` : ""}${entryMatchesTerms(entry, possibleDictionaryForms(pendingWordContext.surface)) ? `<button class="button button-primary button-small" style="margin-left:8px" data-action="link-current-word" data-id="${esc(entry.id)}">关联到当前句子</button>` : ""}</div>` : ""}
      ${(entry.spellings || []).length ? `<div class="detail-field"><label>汉字写法</label><div>${(entry.spellings || []).map(esc).join("、")}</div></div>` : ""}
      <div class="detail-field" style="margin-top:9px"><label>读音</label><div class="word-readings">${(entry.readings || []).length ? (entry.readings || []).map(esc).join("、") : "暂无读音"}</div></div>
      <div class="section-divider">词性与释义</div>${(entry.partOfSpeech || []).length ? `<div class="tag-row">${entry.partOfSpeech.map(part => `<span class="pill gray">${esc(part)}</span>`).join("")}</div>` : ""}
      ${entry.mdictDefinition ? `<div class="section-divider">原词典条目（本地保存）</div><iframe class="mdict-preview mdict-imported-definition" data-entry-id="${esc(entry.id)}" sandbox="allow-scripts" referrerpolicy="no-referrer" title="隔离的本地词典条目预览"></iframe>` : `<ol class="dictionary-meanings">${meanings.length ? meanings.map(meaning => `<li>${esc(meaning)}</li>`).join("") : `<li class="muted">暂无释义</li>`}</ol>`}
      ${(entry.synonyms || []).length ? `<div class="detail-field"><label>同义 / 相关词</label><div>${(entry.synonyms || []).map(esc).join("、")}</div></div>` : ""}
      ${entry.myNotes ? `<div class="detail-field"><label>我的备注</label><div>${esc(entry.myNotes)}</div></div>` : ""}
      <div class="detail-field source-attribution"><label>数据出处</label><div>${esc(source?.name || entry.sourceName || "未知来源")}${entry.sourceVersion ? ` · ${esc(entry.sourceVersion)}` : ""}${source?.url ? `<br>来源 URL：${esc(source.url)}` : ""}<br>许可证：${esc(source?.license || entry.license || "未注明")}<br>原始词条 ID：${esc(entry.originalId || "—")} · 导入时间：${formatDate(entry.importedAt)}</div></div>
      <div class="section-divider">我的语料 <span class="pill gray">${occurrences.length} 次出现</span></div>${occurrences.length ? `<div class="instance-list">${occurrences.slice(0, 20).map(({ sentence, instance }) => `<div class="instance-row" data-action="open-sentence" data-id="${esc(sentence.id)}"><div class="japanese">${highlightWord(sentence.japanese, instance)}</div><div class="sentence-meta">${esc(sentence.source || sentence.sourceType || "未注明来源")} · ${formatDate(sentence.addedAt)}</div></div>`).join("")}</div>` : `<p class="muted tiny">在句子详情里点选词语并查询，或将此词条加入句中，便可建立词语—语料关联。</p>`}
      </section>`;
  }

  function highlightWord(sentence, instance) {
    const start = Number(instance.start), end = Number(instance.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sentence.length) return esc(sentence);
    return `${esc(sentence.slice(0, start))}<span class="highlighted-text">${esc(sentence.slice(start, end))}</span>${esc(sentence.slice(end))}`;
  }

  function japaneseTokens(text) {
    if (typeof Intl.Segmenter === "function") {
      const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
      const tokens = [...segmenter.segment(text)]
        .filter(item => item.isWordLike && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}\p{Number}]/u.test(item.segment))
        .map(item => ({ surface: item.segment, start: item.index, end: item.index + item.segment.length }));
      const merged = [];
      tokens.forEach(token => {
        const previous = merged[merged.length - 1];
        if (previous && previous.end === token.start && /^(っ|た|て|だ|で)$/.test(token.surface)) {
          previous.surface += token.surface;
          previous.end = token.end;
        } else merged.push({ ...token });
      });
      return merged;
    }
    return [...text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)]
      .map(match => ({ surface: match[0], start: match.index, end: match.index + match[0].length }));
  }

  function possibleDictionaryForms(surface) {
    const forms = new Set([surface]);
    const endings = [
      ["せる", "す"], ["ける", "く"], ["げる", "ぐ"], ["てる", "つ"],
      ["べる", "ぶ"], ["める", "む"], ["ねる", "ぬ"], ["れる", "る"], ["える", "う"],
      ["した", "す"], ["いた", "く"], ["いだ", "ぐ"], ["んだ", "む"]
    ];
    for (const [ending, replacement] of endings) {
      if (surface.endsWith(ending) && surface.length > ending.length) forms.add(surface.slice(0, -ending.length) + replacement);
    }
    if (surface.endsWith("かった")) forms.add(`${surface.slice(0, -3)}い`);
    return [...forms];
  }

  function entryMatchesTerms(entry, terms) {
    const values = [entry.headword, ...(entry.spellings || []), ...(entry.readings || [])].map(value => String(value || ""));
    return terms.some(term => values.includes(term));
  }

  function sentenceDetailMarkup(sentence) {
    const sorted = [...sentence.instances].sort((a, b) => a.start - b.start);
    let cursor = 0;
    let display = "";
    for (const instance of sorted) {
      const start = Number(instance.start), end = Number(instance.end);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || end <= start || end > sentence.japanese.length) continue;
      display += `${esc(sentence.japanese.slice(cursor, start))}<button class="instance-chip" data-action="edit-instance" data-sentence-id="${esc(sentence.id)}" data-instance-id="${esc(instance.id)}" title="${esc(instanceLabel(instance))}">${esc(sentence.japanese.slice(start, end))}</button>`;
      cursor = end;
    }
    display += esc(sentence.japanese.slice(cursor));
    const instanceRows = sentence.instances.map(instance => {
      const grammar = grammarById(instance.grammarId), usage = usageById(grammar, instance.usageId);
      return `<div class="instance-row"><div class="usage-head"><div><div class="usage-name">${esc(grammar?.name || instance.pendingGrammarName || "待确认语法")} <span class="muted">→</span> ${esc(usage?.name || instance.pendingUsageName || "待确认用法")}</div><div class="usage-meaning">${esc(instance.text || "")}${instance.aiJudgment ? ` · ${esc(instance.aiJudgment)}` : ""}</div><div class="instance-tags">${instance.confidence != null ? `<span class="pill gray">置信度 ${Math.round(Number(instance.confidence) * 100)}%</span>` : ""}${instance.userConfirmed ? `<span class="pill">已确认</span>` : `<span class="pill orange">待确认</span>`}${instance.userModified ? `<span class="pill gray">已修改</span>` : ""}</div></div><div class="tag-row">${!grammar && instance.pendingGrammarName ? `<button class="text-button button-small" data-action="create-pending-grammar" data-sentence-id="${esc(sentence.id)}" data-instance-id="${esc(instance.id)}">加入语法库</button>` : ""}<button class="text-button button-small" data-action="edit-instance" data-sentence-id="${esc(sentence.id)}" data-instance-id="${esc(instance.id)}">编辑</button><button class="text-button button-small" data-action="delete-instance" data-sentence-id="${esc(sentence.id)}" data-instance-id="${esc(instance.id)}">删除</button></div></div></div>`;
    }).join("");
    const tokens = japaneseTokens(sentence.japanese);
    const linkedWords = sentence.wordInstances || [];
    const aiTranslation = sentence.aiTranslation;
    const translationDetail = aiTranslation ? `<div class="detail-field practice-evaluation"><label>${aiTranslation.origin === "AI（用户审核）" ? "AI 翻译讲解" : "翻译讲解"}${aiTranslation.model ? ` · ${esc(aiTranslation.model)}` : ""}</label><div>${aiTranslation.translation !== sentence.chinese ? `<p><strong>AI 翻译建议：</strong>${esc(aiTranslation.translation || "")}</p>` : ""}<div>${esc(aiTranslation.explanation || "")}</div>${aiTranslation.savedAt ? `<small class="muted tiny">保存于 ${formatDate(aiTranslation.savedAt)}</small>` : ""}</div></div>` : "";
    return `<section class="panel sentence-detail"><div class="tag-row"><span class="pill gray">${esc(sentence.sourceType || "其他")}</span><span class="sentence-meta">${formatDate(sentence.addedAt)}</span>${sentence.favorite ? `<span class="pill orange">已收藏</span>` : ""}</div><div class="japanese">${display || esc(sentence.japanese)}</div>${sentence.chinese ? `<p class="subtitle">${esc(sentence.chinese)}${aiTranslation?.translation === sentence.chinese ? ` <span class="pill gray">AI 翻译·已确认</span>` : ""}</p>` : ""}${sentence.english ? `<p class="subtitle">${esc(sentence.english)}</p>` : ""}${sentence.source ? `<div class="sentence-meta">来源：${esc(sentence.source)}</div>` : ""}
      ${sentence.corpusSource ? `<div class="detail-field" style="margin-top:11px"><label>外部语料来源与许可证</label><div><a href="${esc(sentence.corpusSource.sentenceUrl || sentence.corpusSource.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(sentence.corpusSource.sourceName || sentence.corpusSource.sourceId)} #${esc(sentence.corpusSource.originalId)} ↗</a><br>作者：${esc(sentence.corpusSource.author || "未注明")} · ${esc(sentence.corpusSource.license || "许可未注明")}${sentence.corpusSource.translations?.length ? sentence.corpusSource.translations.map(translation => `<br>译者：${esc(translation.author)} · ${esc(translation.license)}${translation.url ? ` · <a href="${esc(translation.url)}" target="_blank" rel="noopener noreferrer">译文出处 ↗</a>` : ""}`).join("") : ""}</div></div>` : ""}
      ${sentence.notes ? `<div class="detail-field" style="margin-top:11px"><label>我的备注</label><div>${esc(sentence.notes)}</div></div>` : ""}
      ${translationDetail}
      ${sentence.practiceEvaluation ? `<div class="detail-field practice-evaluation"><label>AI 造句评价 · ${esc(sentence.practiceEvaluation.model || "模型未注明")}</label><div>Grammar ${sentence.practiceEvaluation.grammarCorrect ? "✓" : "需检查"} · Usage ${sentence.practiceEvaluation.usageCorrect ? "✓" : "需检查"} · 接续 ${sentence.practiceEvaluation.connectionCorrect ? "✓" : "需检查"} · 自然度 ${Math.round(Number(sentence.practiceEvaluation.naturalness) || 0)}/5<br>${esc(sentence.practiceEvaluation.recommendation || "")}${(sentence.practiceEvaluation.errors || []).length ? `<ul>${sentence.practiceEvaluation.errors.map(item => `<li>${esc(item.type || "反馈")}：${esc(item.description || "")}</li>`).join("")}</ul>` : ""}</div></div>` : ""}
      <div class="section-divider">点选词语查词典</div><div class="word-token-list">${tokens.map(token => {
        const linked = linkedWords.find(item => item.start === token.start && item.end === token.end);
        return `<button class="word-token${linked ? " linked" : ""}" data-action="lookup-word" data-sentence-id="${esc(sentence.id)}" data-start="${token.start}" data-end="${token.end}" data-surface="${esc(token.surface)}">${esc(token.surface)}${linked ? "　✓" : ""}</button>`;
      }).join("") || `<span class="muted tiny">无法自动切分时，可手动搜索词条并建立关联。</span>`}</div>
      <div class="detail-actions"><button class="button button-primary button-small" data-action="translate-sentence" data-id="${esc(sentence.id)}">✦ AI 翻译与讲解</button><button class="button button-secondary button-small" data-action="analyze-sentence" data-id="${esc(sentence.id)}">AI 分析语法</button><button class="button button-secondary button-small" data-action="new-instance" data-sentence-id="${esc(sentence.id)}">＋ 添加语法关联</button><button class="button button-secondary button-small" data-action="edit-sentence" data-id="${esc(sentence.id)}">编辑</button><button class="button button-secondary button-small" data-action="toggle-favorite" data-id="${esc(sentence.id)}">${sentence.favorite ? "取消收藏" : "☆ 收藏"}</button><button class="button button-danger button-small" data-action="delete-sentence" data-id="${esc(sentence.id)}">删除</button></div>
      ${linkedWords.length ? `<div class="section-divider">句中词语关联 <span class="pill gray">${linkedWords.length}</span></div><div class="word-link-list">${linkedWords.map(instance => {
        const entry = dictionaryEntries.find(item => item.id === instance.dictionaryEntryId || (!instance.dictionaryEntryId && item.id === instance.wordId));
        const word = state.words.find(item => item.id === instance.wordId);
        return `<div class="word-link-row"><div><strong>${esc(instance.surface)}</strong><span>→ ${esc(word?.headword || entry?.headword || instance.pendingHeadword || "待确认词条")}</span>${instance.form ? `<small>${esc(instance.form)}${instance.reading ? ` · ${esc(instance.reading)}` : ""}${instance.partOfSpeech ? ` · ${esc(instance.partOfSpeech)}` : ""}</small>` : ""}</div><div class="tag-row">${instance.userConfirmed ? `<span class="pill">已关联</span>` : `<button class="button button-secondary button-small" data-action="review-word-instance" data-sentence-id="${esc(sentence.id)}" data-instance-id="${esc(instance.id)}">查词并确认</button>`}<button class="text-button button-small" data-action="remove-word-instance" data-sentence-id="${esc(sentence.id)}" data-instance-id="${esc(instance.id)}">移除</button></div></div>`;
      }).join("")}</div>` : ""}
      <div class="section-divider">句中语法 <span class="pill gray">${sentence.instances.length}</span></div>${instanceRows || `<p class="muted tiny">还没有关联语法。可以手动添加，或使用 AI 分析。</p>`}</section>`;
  }

  function renderSettings() {
    root.innerHTML = `${header("YOUR DATA, YOURS", "设置与备份", "所有语料保存在当前浏览器。随时导出，带走自己的知识。",
      `<button class="button button-primary" data-action="export-json">↓ 导出完整备份</button>`)}
      <div class="settings-grid"><section class="setting-card"><h2>AI 句子分析</h2><p>使用兼容 OpenAI Chat Completions 的 API。分析语法时只发送当前句子和候选语法；AI 单词分析会显示原形、词形和高亮位置供你确认，不会自动复制词典版权内容。</p>
        <div class="form-grid"><div class="form-field full"><label for="ai-base-url">API 基础地址${hasFileAiConfig ? "（来自 api-config.js）" : ""}</label><input id="ai-base-url" type="url" value="${esc(aiConfig.baseUrl || "https://api.deepseek.com")}" placeholder="https://api.deepseek.com"${hasFileAiConfig ? " readonly" : ""}></div><div class="form-field"><label for="ai-model">模型名称${hasFileAiConfig ? "（来自 api-config.js）" : ""}</label><input id="ai-model" value="${esc(aiConfig.model || "deepseek-flash")}" placeholder="deepseek-flash"${hasFileAiConfig ? " readonly" : ""}></div><div class="form-field"><label for="ai-api-key">临时 API Key（可选）</label><input id="ai-api-key" type="password" autocomplete="off" placeholder="${sessionApiKey ? "长期密钥已从 api-config.js 载入；可临时覆盖" : "请在 api-config.js 配置长期密钥"}"></div></div>
        <div class="setting-actions">${hasFileAiConfig ? "" : `<button class="button button-secondary" data-action="use-deepseek">使用 DeepSeek 配置</button><button class="button button-primary" data-action="save-ai-settings">保存接口设置</button>`}<button class="button button-secondary" data-action="test-ai-connection">测试接口</button><button class="button button-secondary" data-action="clear-api-key">清除临时 API Key</button></div>
        <div class="notice">长期配置请编辑项目根目录的 api-config.js，填写 DeepSeek API Key 并保存；重新打开网站后会自动读取，无需反复输入。页面中的临时 API Key 仅覆盖本次打开期间。配置文件会提供给浏览器，应用只绑定本机地址；请勿公开部署、共享此文件或提交密钥。AI 请求直接发送至 DeepSeek，测试接口会产生少量用量。</div></section>
        <section class="setting-card"><h2>导入与导出</h2><p>完整备份包括 Grammar、Usage、Sentence、词语关联、数据来源和本地词条。CSV 使用 type、id、data_json 三列；词典导入支持带字段映射的 CSV/TSV、结构化 JSON，以及 JMdict XML。</p>
          <div class="setting-actions"><button class="button button-secondary" data-action="export-json">导出 JSON</button><button class="button button-secondary" data-action="export-csv">导出 CSV</button><button class="button button-secondary" data-action="import-data">导入 JSON / CSV</button></div>
          <div class="setting-actions"><button class="button button-secondary" data-action="import-dictionary">导入词典 CSV / TSV / JSON / XML</button></div>
          <hr class="divider"><div class="detail-fields"><div class="detail-field"><label>句子</label><div>${state.sentences.length}</div></div><div class="detail-field"><label>语法</label><div>${state.grammars.length}</div></div></div>
          <div class="notice green">导入会以 ID 合并记录：相同 ID 的内容将由导入文件更新，其他本地记录保留。</div></section>
        <section class="setting-card"><h2>数据源与授权状态</h2><p>当前版本支持导入有授权依据的本地词典文件，并记录词典来源、版本、许可、原始 ID 和导入时间。</p>
          <div class="detail-fields"><div class="detail-field"><label>本地词条</label><div>${dictionaryEntries.length.toLocaleString()}</div></div><div class="detail-field"><label>已登记词典来源</label><div>${(state.dictionarySources || []).filter(source => source.type !== "user").length}</div></div></div>
          <div class="notice">JMdict XML 可导入，默认登记许可 CC BY-SA 4.0。Tatoeba 日语语料已可在「外部资料」中通过公开只读 API 检索并逐条导入；Japanese Language Data 语法 JSON 可在线获取，预览并确认后导入。其他外部资源仅提供官方入口，可能要求账号或遵守专门利用规约。请勿绕过访问限制或批量复制商业内容。</div>
          <div class="provider-list">${externalResources.filter(resource => resource.name !== "Tatoeba API").map(resource => `<div class="provider-row"><div><strong>${esc(resource.name)}</strong><small>${esc(resource.category)} · ${resource.name === "Japanese Language Data" ? "可在外部资料页获取并导入" : "外链，未同步"}</small></div><a class="button button-secondary button-small" href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer">打开官方入口 ↗</a></div>`).join("")}</div>
          <div class="notice green">OpenJLPT、BCCWJ、少納言、中納言、I-JAS 和其他在线语法站点尚未接入站内同步。EPWING 解析、XLSX 和形态分析器也尚未实现；当前词形回溯仅提供有限的日语活用候选提示，需用户确认。</div></section>
        <section class="setting-card"><h2>本地数据</h2><p>此 MVP 为纯浏览器本地应用，没有账号同步。清理浏览器网站数据前，请先导出 JSON 备份。</p>
          <div class="setting-actions"><button class="button button-danger" data-action="reset-data">恢复初始示例数据</button></div>
          <div class="notice">AI 分析需要你自行配置兼容接口。该页面适合本机个人使用，不适合直接公开部署或在多人共用设备上输入敏感内容。</div></section></div>`;
  }

  function renderSources() {
    const corpusTranslationLabel = corpusTranslationLanguage === "eng" ? "英文译文" : "中文译文";
    const resultMarkup = corpusResults.length
      ? corpusResults.map((entry, index) => {
        const existing = state.sentences.find(sentence =>
          sentence.corpusSource?.sourceId === "tatoeba" && String(sentence.corpusSource.originalId) === String(entry.id));
        const translations = (entry.translations || []).filter(translation =>
          translation.lang === corpusTranslationLanguage && translation.license === "CC BY 2.0 FR" && translation.owner);
        const canSave = entry.license === "CC BY 2.0 FR" && entry.owner && !entry.is_unapproved;
        return `<article class="setting-card"><div class="tag-row"><span class="pill gray">Tatoeba · ${esc(entry.license || "许可未注明")}</span>${existing ? `<span class="pill">已收藏</span>` : ""}</div><p class="japanese">${esc(entry.text)}</p>${translations[0] ? `<p class="subtitle">${esc(translations[0].text)}</p>` : ""}<p class="muted tiny">作者：${esc(entry.owner || "未署名")} · 原始 ID：${esc(entry.id)}${translations.length ? ` · ${corpusTranslationLabel} ${translations.length} 条` : ""}</p><div class="setting-actions"><a class="button button-quiet button-small" href="https://tatoeba.org/en/sentences/${encodeURIComponent(entry.id)}" target="_blank" rel="noopener noreferrer">查看出处 ↗</a><button class="button button-secondary button-small" data-action="save-corpus-sentence" data-index="${index}"${existing || !canSave ? " disabled" : ""}>${existing ? "已加入句子库" : canSave ? "预览并收藏" : "署名或许可证不符合导入条件"}</button></div></article>`;
      }).join("")
      : corpusError ? `<p class="notice">${esc(corpusError)}</p>` : `<p class="muted tiny">搜索公开例句；结果只在你确认后加入本地句子库。</p>`;
    const duplicates = grammarSourcePreview.filter(item => state.grammars.some(grammar =>
      grammar.externalSource?.sourceId === item.sourceId && grammar.externalSource?.originalId === item.originalId
      || grammar.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase())).length;
    root.innerHTML = `${header("AUTHORIZED MATERIALS", "外部资料", "查询开放语料；导入你有权使用的结构化语法资料，来源和许可随记录保存。")}
      <section class="setting-card"><div class="panel-heading"><div><h2>Tatoeba 日语例句语料</h2><p>使用 Tatoeba 官方只读 API；搜索词会发送到 Tatoeba。仅可导入已审核、有署名且许可为 CC BY 2.0 FR 的句子。</p></div></div>
        <form id="corpus-search-form" class="search-toolbar"><input id="corpus-query" type="search" value="${esc(corpusQuery)}" placeholder="搜索日语关键词…" maxlength="100" required><select id="corpus-translation-language" aria-label="译文语言"><option value="cmn"${corpusTranslationLanguage === "cmn" ? " selected" : ""}>中文译文</option><option value="eng"${corpusTranslationLanguage === "eng" ? " selected" : ""}>英文译文</option></select><button class="button button-primary button-small" type="submit">搜索语料</button><a class="button button-quiet button-small" href="https://api.tatoeba.org/openapi" target="_blank" rel="noopener noreferrer">API 文档 ↗</a></form>
        <p class="muted tiny">结果最多每页 20 条，过滤未审核和无作者条目。语料和社区翻译准确性不保证；逐条预览可检查许可及作者。</p><div class="source-list">${corpusError ? `<p class="notice">${esc(corpusError)}</p>` : ""}${resultMarkup}</div>
        ${corpusPaging ? `<div class="setting-actions"><span class="muted tiny">已显示 ${corpusResults.length} 条，共 ${Number(corpusPaging.total || 0).toLocaleString()} 条</span>${corpusPaging.has_next ? `<button class="button button-secondary button-small" data-action="load-more-corpus">加载更多</button>` : ""}</div>` : ""}
      </section>
      <section class="setting-card"><div class="panel-heading"><div><h2>JLPT 语法资料</h2><p>从 Japanese Language Data 获取公开语法 JSON；资料会先预览，只有你确认后才写入本地语法库。</p></div><button class="button button-primary button-small" data-action="fetch-japanese-language-data"${grammarSourceLoading ? " disabled" : ""}>${grammarSourceLoading ? "正在获取…" : "获取 Japanese Language Data"}</button></div>
        <div class="notice">数据集提供 JLPT 等级、语法接续、英文释义、解释、关联语法和例句。语法条目目前标记为 draft（未由母语者审校），请把它作为学习参考而非权威结论。资料采用 CC BY-SA 4.0；导入会保留署名、版本、原始 ID 与许可。</div>
      </section>
      <section class="setting-card"><div class="panel-heading"><div><h2>导入其他语法资料</h2><p>支持 JSON / CSV / TSV；预览后确认导入，重复名称会跳过，不覆盖个人数据。</p></div><button class="button button-secondary button-small" data-action="import-grammar-source">选择资料文件</button></div>
        <div class="notice">JSON 格式：<code>{"source":{"name":"来源","url":"https://…","version":"版本","license":"许可"},"grammars":[{"id":"原始ID","name":"语法","jlpt":"N3","connection":"接续","usages":[{"id":"用法ID","name":"用法","meaning":"意义","explanation":"说明"}]}]}</code>。CSV/TSV 每行一个用法，必需 <code>name</code> 列；可选 <code>grammarId, jlpt, variants, connection, type, educationCategory, schoolCategory, usageName, meaning, explanation, usageConnection</code>。来源与许可信息会在确认时填写。仅导入你有权保存的资料；不会抓取或复制网站内容。</div>
        ${grammarSourcePreview.length ? `<div class="detail-fields"><div class="detail-field"><label>待导入语法</label><div>${grammarSourcePreview.length}</div></div><div class="detail-field"><label>重复（将跳过）</label><div>${duplicates}</div></div></div>` : `<p class="muted tiny">尚无待导入的语法资料。</p>`}
      </section>
      <section class="setting-card"><div class="panel-heading"><div><h2>其他官方资料入口</h2><p>这些站点未接入站内检索；须遵守各自条款。</p></div></div><div class="provider-list">${externalResources.filter(resource => !["Tatoeba API", "Japanese Language Data", "OpenJLPT"].includes(resource.name)).map(resource => `<div class="provider-row"><div><strong>${esc(resource.name)}</strong><small>${esc(resource.category)} · 外链，未同步</small></div><a class="button button-secondary button-small" href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer">打开官方入口 ↗</a></div>`).join("")}</div></section>`;
    root.querySelector("#corpus-search-form").addEventListener("submit", event => {
      event.preventDefault();
      searchTatoebaCorpus();
    });
    root.querySelector("#corpus-translation-language").addEventListener("change", event => {
      corpusTranslationLanguage = event.target.value === "eng" ? "eng" : "cmn";
      if (corpusQuery) searchTatoebaCorpus();
    });
  }

  async function readLimitedJson(response, label, maxBytes = 20 * 1024 * 1024) {
    if (!response.ok) throw new Error(`${label}下载失败：HTTP ${response.status}。`);
    const announcedLength = Number(response.headers.get("content-length") || 0);
    if (announcedLength > maxBytes) throw new Error(`${label}超过 20 MiB，已停止下载。`);
    if (!response.body?.getReader) throw new Error("当前浏览器不支持安全读取下载内容。");
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(`${label}超过 20 MiB，已停止下载。`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  async function fetchJapaneseLanguageData() {
    if (grammarSourceLoading) return;
    grammarSourceLoading = true;
    const requestVersion = ++grammarSourceRequestVersion;
    renderSources();
    try {
      const baseUrl = "https://raw.githubusercontent.com/jkindrix/japanese-language-data/main";
      const [manifest, dataset] = await Promise.all([
        fetch(`${baseUrl}/manifest.json`, { headers: { Accept: "application/json" } })
          .then(response => readLimitedJson(response, "Japanese Language Data 版本信息", 1024 * 1024)),
        fetch(`${baseUrl}/data/grammar/grammar.json`, { headers: { Accept: "application/json" } })
          .then(response => readLimitedJson(response, "Japanese Language Data 语法资料"))
      ]);
      if (requestVersion !== grammarSourceRequestVersion || page !== "sources") return;
      if (!Array.isArray(dataset.grammar_points) || !dataset.grammar_points.length) {
        throw new Error("语法资料格式不符合预期，没有找到 grammar_points。");
      }
      const relatedPatterns = new Map(dataset.grammar_points.map(item => [item.id, item.pattern]));
      const records = dataset.grammar_points.map(item => {
        const examples = Array.isArray(item.examples) ? item.examples
          .filter(example => typeof example?.japanese === "string" && example.japanese.trim())
          .map(example => example.japanese.trim()) : [];
        const related = Array.isArray(item.related)
          ? item.related.map(id => relatedPatterns.get(id) || id).filter(Boolean).join("、") : "";
        const notes = Array.isArray(item.formation_notes)
          ? item.formation_notes.filter(note => typeof note === "string" && note.trim()).join("\n") : "";
        return {
          originalId: String(item.id || "").trim(),
          name: String(item.pattern || "").trim(),
          jlpt: jlptLevels.includes(item.level) ? item.level : "未分类",
          type: item.formality ? `语体：${item.formality}` : "",
          reviewStatus: String(item.review_status || "unknown"),
          connection: String(item.formation || "").trim(),
          related,
          usages: item.meaning_en || item.meaning_detailed || item.formation || examples.length ? [{
            name: String(item.meaning_en || "主要用法").trim(),
            meaning: String(item.meaning_en || "主要用法").trim(),
            explanation: [item.meaning_detailed, notes].filter(Boolean).join("\n\n"),
            connection: String(item.formation || "").trim(),
            cautions: item.review_status === "draft" ? "来源条目标记为 draft，尚未经母语者审校。" : "",
            officialExamples: examples,
            reference: "Japanese Language Data · CC BY-SA 4.0"
          }] : []
        };
      }).filter(item => item.originalId && item.name);
      if (!records.length) throw new Error("语法资料没有可导入的有效条目。");
      grammarSourceMetadata = {
        name: "Japanese Language Data · Grammar",
        url: "https://github.com/jkindrix/japanese-language-data/blob/main/data/grammar/grammar.json",
        version: String(manifest.version || dataset.metadata?.generated || ""),
        license: "CC BY-SA 4.0"
      };
      grammarSourcePreview = records;
      renderSources();
      openGrammarSourceConfirmation();
    } catch (error) {
      console.error("获取 Japanese Language Data 失败", error);
      toast(`获取语法资料失败：${error.message}`, true);
    } finally {
      if (requestVersion === grammarSourceRequestVersion) grammarSourceLoading = false;
      if (page === "sources") renderSources();
    }
  }

  async function searchTatoebaCorpus(nextUrl = "") {
    const query = String(document.getElementById("corpus-query")?.value || corpusQuery).trim();
    if (!query || query.length > 100) {
      corpusError = "请输入 1–100 个字符的日语关键词。";
      renderSources();
      return;
    }
    corpusQuery = query;
    corpusError = "";
    if (!nextUrl) {
      corpusResults = [];
      corpusPaging = null;
    }
    const requestVersion = ++corpusRequestVersion;
    renderSources();
    try {
      let requestUrl;
      if (nextUrl) {
        requestUrl = new URL(nextUrl);
        if (requestUrl.origin !== "https://api.tatoeba.org" || requestUrl.pathname !== "/v1/sentences") {
          throw new Error("语料分页地址无效，已拒绝访问。");
        }
      } else {
        requestUrl = new URL("https://api.tatoeba.org/v1/sentences");
        requestUrl.searchParams.set("lang", "jpn");
        requestUrl.searchParams.set("q", query);
        requestUrl.searchParams.set("sort", "relevance");
        requestUrl.searchParams.set("is_unapproved", "no");
        requestUrl.searchParams.set("is_orphan", "no");
        requestUrl.searchParams.set("limit", "20");
        requestUrl.searchParams.set("showtrans", "all");
        requestUrl.searchParams.set("trans:lang", corpusTranslationLanguage);
      }
      const response = await fetch(requestUrl.toString(), { headers: { Accept: "application/json" } });
      if (requestVersion !== corpusRequestVersion || page !== "sources") return;
      if (!response.ok) {
        if (response.status === 429) throw new Error("Tatoeba API 请求过于频繁，请稍后再试。");
        if (response.status >= 500) throw new Error("Tatoeba 服务暂时不可用，请稍后重试。");
        throw new Error(`Tatoeba API 返回 HTTP ${response.status}。`);
      }
      const payload = await response.json();
      if (requestVersion !== corpusRequestVersion || page !== "sources") return;
      if (!Array.isArray(payload.data) || !payload.paging) throw new Error("Tatoeba API 返回的数据格式不正确。");
      const incoming = payload.data.filter(entry => Number.isInteger(Number(entry.id)) && typeof entry.text === "string");
      const seen = new Set(corpusResults.map(entry => String(entry.id)));
      corpusResults = nextUrl
        ? [...corpusResults, ...incoming.filter(entry => !seen.has(String(entry.id)))]
        : incoming;
      corpusPaging = payload.paging;
      corpusError = "";
    } catch (error) {
      if (requestVersion !== corpusRequestVersion || page !== "sources") return;
      console.error("查询 Tatoeba 语料失败", error);
      corpusError = error instanceof TypeError
        ? "无法连接 Tatoeba API；请检查网络或该服务是否可访问。此前的搜索结果仍保留。"
        : error.message || "语料搜索失败；此前的结果仍保留。";
    } finally {
      if (requestVersion === corpusRequestVersion && page === "sources") renderSources();
    }
  }

  function previewCorpusSentence(index) {
    const entry = corpusResults[index];
    if (!entry) return;
    const existing = state.sentences.find(sentence =>
      sentence.corpusSource?.sourceId === "tatoeba" && String(sentence.corpusSource.originalId) === String(entry.id));
    if (existing) {
      selectedSentenceId = existing.id;
      setPage("sentences");
      toast("这条 Tatoeba 句子已在本地语料库中。");
      return;
    }
    if (entry.license !== "CC BY 2.0 FR" || !entry.owner || entry.is_unapproved) {
      toast("这条句子的作者、审核状态或许可不满足导入条件。", true);
      return;
    }
    const usableTranslations = (entry.translations || []).filter(translation =>
      translation.lang === corpusTranslationLanguage && translation.license === "CC BY 2.0 FR" && translation.owner);
    const translationLanguageLabel = corpusTranslationLanguage === "eng" ? "英文" : "中文";
    const translationRows = usableTranslations.map((translation, i) =>
      `<label class="form-field full"><span><input type="radio" name="corpusTranslation" value="${i}"${i === 0 ? " checked" : ""}> ${esc(translation.text)}</span><small class="muted tiny">${translationLanguageLabel}译文作者：${esc(translation.owner)} · ${esc(translation.license)}</small></label>`).join("");
    const body = `<div class="form-grid"><div class="detail-field form-field full"><label>日语句子</label><div>${esc(entry.text)}</div></div><div class="detail-field form-field full"><label>出处与授权</label><div>Tatoeba #${esc(entry.id)} · 作者：${esc(entry.owner)} · ${esc(entry.license)}<br><a href="https://tatoeba.org/en/sentences/${encodeURIComponent(entry.id)}" target="_blank" rel="noopener noreferrer">查看原始句子与许可 ↗</a></div></div>${translationRows ? `<div class="form-field full"><label>可选${translationLanguageLabel}译文（译者与许可单独保留）</label>${translationRows}</div>` : `<p class="muted tiny form-field full">没有找到许可兼容且有署名的${translationLanguageLabel}译文；可只保存日语原句。</p>`}<label class="form-field full"><span><input type="checkbox" name="confirmAttribution" required> 我已检查此句子的来源和许可，并同意在本地记录作者署名和许可信息。</span></label></div>`;
    openModal("预览并保存语料", "Tatoeba 社区句子及翻译可能有错误。保存前请查看原始条目；此动作只复制当前一条。", body, data => {
      if (state.sentences.some(sentence =>
        sentence.corpusSource?.sourceId === "tatoeba" && String(sentence.corpusSource.originalId) === String(entry.id))) {
        toast("该句已导入，不会重复创建。", true);
        return;
      }
      const selectedIndex = Number(data.get("corpusTranslation"));
      const translation = Number.isInteger(selectedIndex) ? usableTranslations[selectedIndex] : null;
      const now = new Date().toISOString();
      const translationMetadata = translation ? {
        text: translation.text, lang: translation.lang, author: translation.owner, license: translation.license,
        originalId: String(translation.id || ""),
        url: translation.id ? `https://tatoeba.org/en/sentences/${encodeURIComponent(translation.id)}` : ""
      } : null;
      const sentence = {
        id: uid("sentence"), japanese: entry.text,
        chinese: translation?.lang === "cmn" ? translation.text : "",
        english: translation?.lang === "eng" ? translation.text : "",
        source: `Tatoeba #${entry.id} · ${entry.owner}`, sourceType: "真实语料",
        addedAt: now, notes: "", favorite: false, reviewed: false, analysisStatus: "待分析",
        instances: [], wordInstances: [],
        corpusSource: {
          sourceId: "tatoeba", sourceName: "Tatoeba", sourceType: "corpus",
          sourceUrl: "https://api.tatoeba.org/v1/sentences", originalId: String(entry.id),
          sentenceUrl: `https://tatoeba.org/en/sentences/${encodeURIComponent(entry.id)}`,
          author: entry.owner, license: entry.license, version: "Tatoeba API v1",
          importedAt: now, translations: translationMetadata ? [translationMetadata] : []
        }
      };
      state.sentences.unshift(sentence);
      selectedSentenceId = sentence.id;
      persist();
      closeModal();
      setPage("sentences");
      toast("已保存语料；作者、许可证和来源链接已随句子记录。");
    }, "确认并加入句子库");
  }

  function importGrammarSourceFile(file) {
    if (!file) return;
    grammarSourceMetadata = {};
    file.text().then(text => {
      let records;
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        records = Array.isArray(parsed) ? parsed : parsed.grammars;
        if (!Array.isArray(records)) throw new Error("JSON 文件必须包含 grammars 数组。");
        grammarSourceMetadata = parsed.source && typeof parsed.source === "object" ? parsed.source : {};
      } else {
        const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
        const rows = parseDelimitedRows(text, delimiter);
        const headers = (rows.shift() || []).map(value => value.trim());
        if (!headers.includes("name")) throw new Error("CSV/TSV 必须包含 name 列。");
        const grouped = new Map();
        const sourceMetadataValues = new Map(["sourceName", "sourceUrl", "sourceVersion", "license"].map(name => [name, new Set()]));
        for (const row of rows.filter(values => values.some(value => value.trim()))) {
          const item = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
          for (const [fieldName, values] of sourceMetadataValues) {
            if (item[fieldName]) values.add(item[fieldName]);
          }
          const key = item.grammarId || item.name.trim();
          if (!key) continue;
          let grammar = grouped.get(key);
          if (!grammar) {
            grammar = {
              id: item.grammarId, name: item.name.trim(), jlpt: item.jlpt, variants: item.variants,
              connection: item.connection, type: item.type, educationCategory: item.educationCategory,
              schoolCategory: item.schoolCategory, related: item.related, confusable: item.confusable, usages: []
            };
            grouped.set(key, grammar);
          } else {
            for (const fieldName of ["name", "jlpt", "variants", "connection", "type", "educationCategory", "schoolCategory", "related", "confusable"]) {
              if (item[fieldName] && grammar[fieldName] && item[fieldName] !== grammar[fieldName]) {
                throw new Error(`CSV/TSV 中「${grammar.name}」的 ${fieldName} 字段不一致。`);
              }
            }
          }
          if (item.usageName || item.meaning) grammar.usages.push({
            id: item.usageId || "", name: item.usageName || "一般用法", meaning: item.meaning || "",
            explanation: item.explanation || "", connection: item.usageConnection || ""
          });
        }
        for (const [fieldName, values] of sourceMetadataValues) {
          if (values.size > 1) throw new Error(`CSV/TSV 的来源元数据 ${fieldName} 存在冲突，请按来源拆分文件。`);
          if (values.size === 1) grammarSourceMetadata[fieldName] = [...values][0];
        }
        records = [...grouped.values()];
      }
      if (!Array.isArray(records) || !records.length) throw new Error("没有找到可导入的语法记录。");
      grammarSourcePreview = records.map((item, index) => {
        if (!item || typeof item.name !== "string" || !item.name.trim()) throw new Error(`第 ${index + 1} 条语法缺少 name。`);
        if (item.usages != null && !Array.isArray(item.usages)) throw new Error(`「${item.name}」的 usages 必须是数组。`);
        const usages = (item.usages || []).map((usage, usageIndex) => {
          if (!usage || typeof usage !== "object" || typeof usage.name !== "string" || !usage.name.trim()) {
            throw new Error(`「${item.name}」第 ${usageIndex + 1} 条用法缺少 name。`);
          }
          return { ...usage };
        });
        return { ...item, id: String(item.id || ""), name: item.name.trim(), usages,
          sourceId: "grammar-file", originalId: String(item.id || item.name.trim()), previewIndex: index };
      });
      renderSources();
      openGrammarSourceConfirmation();
    }).catch(error => {
      console.error("读取语法资料失败", error);
      grammarSourcePreview = [];
      grammarSourceMetadata = {};
      toast(`语法资料无法预览：${error.message || "文件格式无效"}`, true);
    });
  }

  function openGrammarSourceConfirmation() {
    if (!grammarSourcePreview.length) return;
    const source = grammarSourceMetadata;
    const body = `<div class="form-grid">${field("资料来源名称", "sourceName", source.name || source.sourceName || "", { required: true })}${field("来源 URL", "sourceUrl", source.url || source.sourceUrl || "", { type: "url", required: true })}${field("版本 / 获取批次", "sourceVersion", source.version || source.sourceVersion || "")}${field("许可证 / 利用条件", "sourceLicense", source.license || "", { required: true })}<div class="form-field full"><div class="detail-field"><label>预览摘要 · 重复项会跳过，不覆盖已有语法</label><div>${grammarSourcePreview.slice(0, 30).map(item => `${esc(item.name)} · ${item.usages.length} 个 Usage${state.grammars.some(grammar => grammar.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase()) ? " · 重复，跳过" : ""}`).join("<br>")}${grammarSourcePreview.length > 30 ? `<br>…另有 ${grammarSourcePreview.length - 30} 条` : ""}</div></div></div><label class="form-field full"><span><input type="checkbox" name="confirmLicense" required> 我确认已获准在本机保存这些语法资料，并已核对上述来源与许可信息。</span></label></div>`;
    openModal("核对并导入语法资料", `共 ${grammarSourcePreview.length} 条；仅新增未重复条目，不覆盖现有语法、用法或个人笔记。`, body, data => {
      const sourceName = String(data.get("sourceName") || "").trim();
      const sourceUrl = String(data.get("sourceUrl") || "").trim();
      const sourceVersion = String(data.get("sourceVersion") || "").trim();
      const license = String(data.get("sourceLicense") || "").trim();
      try {
        const parsedUrl = new URL(sourceUrl);
        if (!["https:", "http:"].includes(parsedUrl.protocol)) throw new Error("来源 URL 必须使用 HTTP 或 HTTPS。");
      } catch (error) {
        toast(error.message || "请填写有效的来源 URL。", true);
        return;
      }
      if (!sourceName || !license) { toast("请填写来源名称和许可/利用条件。", true); return; }
      const timestamp = new Date().toISOString();
      let added = 0, skipped = 0;
      for (const item of grammarSourcePreview) {
        const duplicate = state.grammars.some(grammar =>
          grammar.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase()
          || grammar.externalSource?.sourceId === sourceUrl && grammar.externalSource?.originalId === item.originalId);
        if (duplicate) { skipped++; continue; }
        const { sourceId: ignoredSourceId, originalId: ignoredOriginalId, previewIndex: ignoredPreviewIndex, ...grammarData } = item;
        state.grammars.push({
          ...grammarData, id: uid("grammar"), source: sourceName,
          externalSource: {
            sourceId: sourceUrl, sourceName, sourceType: "grammar",
            sourceUrl, originalId: item.originalId, version: sourceVersion, license, importedAt: timestamp
          },
          usages: item.usages.map(usage => ({
            ...usage, id: uid("usage"), reference: [usage.reference, sourceUrl].filter(Boolean).join(" · ")
          })),
          createdAt: timestamp, updatedAt: timestamp, myExplanation: "", myNotes: ""
        });
        added++;
      }
      grammarSourcePreview = [];
      grammarSourceMetadata = {};
      persist();
      closeModal();
      setPage("grammars");
      toast(`语法资料导入完成：新增 ${added} 条，跳过重复 ${skipped} 条。`);
    }, "确认导入");
  }

  function openModal(title, subtitle, body, onSubmit, submitLabel = "保存") {
    modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="close-button" type="button" data-action="close-modal" aria-label="关闭">×</button></div><form id="modal-form">${body}<div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">${esc(submitLabel)}</button></div></form></section></div>`;
    modalRoot.querySelector(".modal-backdrop").addEventListener("click", event => {
      if (event.target === event.currentTarget) closeModal();
    });
    modalRoot.querySelector("#modal-form").addEventListener("submit", event => {
      event.preventDefault();
      onSubmit(new FormData(event.currentTarget));
    });
    const first = modalRoot.querySelector("input, textarea, select");
    if (first) first.focus();
  }

  function closeModal() {
    modalRoot.innerHTML = "";
  }

  function field(label, name, value = "", options = {}) {
    const full = options.full ? " full" : "";
    let control;
    if (options.select) {
      control = `<select name="${esc(name)}">${options.select.map(option => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        return `<option value="${esc(optionValue)}"${String(value) === optionValue ? " selected" : ""}>${esc(optionLabel)}</option>`;
      }).join("")}</select>`;
    } else if (options.textarea) {
      control = `<textarea name="${esc(name)}" rows="${options.rows || 3}"${options.required ? " required" : ""}>${esc(value)}</textarea>`;
    } else {
      control = `<input type="${esc(options.type || "text")}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(options.placeholder || "")}"${options.required ? " required" : ""}>`;
    }
    return `<div class="form-field${full}"><label>${esc(label)}${options.required ? " *" : ""}</label>${control}</div>`;
  }

  function grammarForm(grammar = {}) {
    return `<div class="form-grid">${field("语法名称", "name", grammar.name, { required: true })}${field("JLPT 等级", "jlpt", grammar.jlpt || "未分类", { select: jlptLevels })}${field("常见变体", "variants", grammar.variants)}${field("语法类型", "type", grammar.type)}${field("接续", "connection", grammar.connection, { full: true })}${field("日本語教育分类", "educationCategory", grammar.educationCategory)}${field("学校文法分类", "schoolCategory", grammar.schoolCategory)}${field("相关语法", "related", grammar.related, { full: true })}${field("易混淆语法", "confusable", grammar.confusable, { full: true })}${field("数据来源", "source", grammar.source, { full: true })}${field("我的解释", "myExplanation", grammar.myExplanation, { textarea: true, full: true })}${field("我的备注", "myNotes", grammar.myNotes, { textarea: true, full: true })}</div>`;
  }

  function usageForm(usage = {}) {
    return `<div class="form-grid">${field("用法名称", "name", usage.name, { required: true })}${field("核心意义", "meaning", usage.meaning, { required: true })}${field("详细解释", "explanation", usage.explanation, { textarea: true, full: true })}${field("接续", "connection", usage.connection)}${field("使用条件", "conditions", usage.conditions, { textarea: true })}${field("注意事项", "cautions", usage.cautions, { textarea: true })}${field("易混淆表达", "confusable", usage.confusable, { full: true })}${field("参考来源", "reference", usage.reference, { full: true })}${field("资料例句（每行一条）", "officialExamples", (usage.officialExamples || []).join("\n"), { textarea: true })}${field("我的例句（每行一条）", "userExamples", (usage.userExamples || []).join("\n"), { textarea: true })}${field("我的理解", "myExplanation", usage.myExplanation, { textarea: true, full: true })}${field("我的备注", "myNotes", usage.myNotes, { textarea: true, full: true })}</div>`;
  }

  function exerciseForm(exercise = {}) {
    const targets = [{ value: "", label: "未关联语法" }, ...state.grammars.flatMap(grammar =>
      grammar.usages.length
        ? grammar.usages.map(usage => ({ value: `${grammar.id}::${usage.id}`, label: `${grammar.name} → ${usage.name}` }))
        : [{ value: `${grammar.id}::`, label: `${grammar.name} → （未细分用法）` }])];
    const selectedTarget = exercise.grammarId ? `${exercise.grammarId}::${exercise.usageId || ""}` : "";
    return `<div class="form-grid">${field("题型", "type", exercise.type || "choice", { select: [{ value: "choice", label: "选择题" }, { value: "fill", label: "填空题" }, { value: "free", label: "简答题" }] })}${field("Grammar / Usage", "target", selectedTarget, { select: targets, full: true })}${field("题干", "prompt", exercise.prompt || "", { textarea: true, rows: 3, required: true, full: true })}${field("选项（选择题每行一项）", "options", (exercise.options || []).join("\n"), { textarea: true, rows: 4, full: true })}${field("参考答案（多答案用 | 分隔）", "correctAnswer", exercise.correctAnswer || "", { textarea: true, rows: 2, required: true, full: true })}${field("答案解释", "explanation", exercise.explanation || "", { textarea: true, full: true })}${field("难度", "difficulty", exercise.difficulty || "", { placeholder: "例如 N3 / 易 / 中 / 难" })}</div>`;
  }

  function saveExerciseFromForm(data, existing, origin = "用户") {
    const type = data.get("type");
    const prompt = data.get("prompt").trim();
    const correctAnswer = data.get("correctAnswer").trim();
    const options = data.get("options").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const [grammarId = "", usageId = ""] = String(data.get("target") || "").split("::");
    if (!prompt || !correctAnswer) { toast("请填写题干和参考答案。", true); return false; }
    if (type === "choice" && (options.length < 2 || !options.some(option => normalizeAnswer(option) === normalizeAnswer(correctAnswer)))) {
      toast("选择题至少需要两个选项，且参考答案必须与其中一个选项一致。", true);
      return false;
    }
    const exercise = {
      ...(existing || {}), id: existing?.id || uid("exercise"), type, prompt, options: type === "choice" ? options : [],
      correctAnswer, explanation: data.get("explanation").trim(), grammarId, usageId,
      difficulty: data.get("difficulty").trim() || grammarById(grammarId)?.jlpt || "未分级",
      createdAt: existing?.createdAt || new Date().toISOString(), origin: existing?.origin || origin,
      aiModel: existing?.aiModel || (origin === "AI" ? aiConfig.model : ""),
      promptVersion: existing?.promptVersion || (origin === "AI" ? "practice-v1" : ""),
      dueAt: existing?.dueAt || new Date().toISOString(), intervalDays: existing?.intervalDays || 0,
      repetitions: existing?.repetitions || 0, lastReviewedAt: existing?.lastReviewedAt || "", suspended: false
    };
    if (existing) Object.assign(existing, exercise);
    else state.exercises.unshift(exercise);
    if (existing) {
      const relatedMistakes = state.mistakes.filter(item => item.exerciseId === exercise.id);
      for (const mistake of relatedMistakes) {
        mistake.grammarId = exercise.grammarId;
        mistake.usageId = exercise.usageId;
        mistake.fingerprint = mistakeFingerprint(exercise);
        mistake.id = mistake.fingerprint;
      }
      const activeByFingerprint = new Map();
      state.mistakes = state.mistakes.filter(mistake => {
        const duplicate = activeByFingerprint.get(mistake.fingerprint);
        if (!duplicate) { activeByFingerprint.set(mistake.fingerprint, mistake); return true; }
        duplicate.wrongCount += mistake.wrongCount;
        duplicate.firstWrongAt = [duplicate.firstWrongAt, mistake.firstWrongAt].filter(Boolean).sort()[0] || "";
        duplicate.lastWrongAt = [duplicate.lastWrongAt, mistake.lastWrongAt].filter(Boolean).sort().at(-1) || "";
        duplicate.resolvedAt = duplicate.resolvedAt && mistake.resolvedAt ? [duplicate.resolvedAt, mistake.resolvedAt].sort().at(-1) : "";
        return false;
      });
    }
    selectedExerciseId = exercise.id;
    revealedExerciseId = "";
    persist();
    closeModal();
    setPage("review");
    toast(existing ? "练习题已更新" : "练习题已保存到本地");
    return true;
  }

  function openExerciseModal(exercise = {}, origin = "用户") {
    openModal(exercise.id ? "编辑练习题" : origin === "AI" ? "确认 AI 生成的练习题" : "手动创建练习题",
      "检查题干与答案；未确认保存前，题目不会加入复习队列。", exerciseForm(exercise),
      data => saveExerciseFromForm(data, exercise.id ? exercise : null, origin),
      exercise.id ? "保存修改" : "确认并保存");
  }

  function normalizeAnswer(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase();
  }

  function mistakeFingerprint(exercise) {
    const source = `${exercise.grammarId || ""}|${exercise.usageId || ""}|${normalizeAnswer(exercise.prompt)}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `mistake_${(hash >>> 0).toString(16)}`;
  }

  function scheduleExercise(exercise, attempt, rating) {
    const previous = attempt.scheduleBefore || {};
    const previousInterval = Number(previous.intervalDays || 0);
    let intervalDays;
    if (!attempt.isCorrect || rating === "again") {
      intervalDays = 1;
      exercise.repetitions = 0;
    } else if (rating === "hard") {
      intervalDays = Math.max(1, Math.ceil(previousInterval * 1.2));
      exercise.repetitions = Number(previous.repetitions || 0) + 1;
    } else if (rating === "easy") {
      intervalDays = Math.max(4, Math.ceil(previousInterval * 3.2));
      exercise.repetitions = Number(previous.repetitions || 0) + 1;
    } else {
      intervalDays = previousInterval === 0 ? 1 : previousInterval < 3 ? 3 : Math.ceil(previousInterval * 2.4);
      exercise.repetitions = Number(previous.repetitions || 0) + 1;
    }
    exercise.intervalDays = intervalDays;
    exercise.lastReviewedAt = attempt.answeredAt;
    exercise.dueAt = new Date(new Date(attempt.answeredAt).getTime() + intervalDays * 86400000).toISOString();
    attempt.rating = !attempt.isCorrect ? "again" : rating;
    if (attempt.isCorrect && rating !== "again") {
      const mistake = state.mistakes.find(item => item.fingerprint === mistakeFingerprint(exercise));
      if (mistake && !mistake.resolvedAt) mistake.resolvedAt = attempt.answeredAt;
    } else if (!attempt.isCorrect) {
      const mistake = state.mistakes.find(item => item.fingerprint === mistakeFingerprint(exercise));
      if (mistake) mistake.resolvedAt = "";
    }
    persist();
    renderReview();
  }

  function submitExerciseAnswer(exerciseId, answer) {
    const exercise = state.exercises.find(item => item.id === exerciseId);
    if (!exercise) return;
    const expected = String(exercise.correctAnswer || "").split("|").map(normalizeAnswer).filter(Boolean);
    const isCorrect = expected.includes(normalizeAnswer(answer));
    const answeredAt = new Date().toISOString();
    const attempt = {
      id: uid("attempt"), exerciseId, answer, isCorrect, answeredAt, rating: "",
      scheduleBefore: {
        intervalDays: Number(exercise.intervalDays || 0), repetitions: Number(exercise.repetitions || 0),
        dueAt: exercise.dueAt || "", lastReviewedAt: exercise.lastReviewedAt || ""
      }
    };
    state.reviewAttempts.push(attempt);
    if (!isCorrect) {
      const fingerprint = mistakeFingerprint(exercise);
      const existing = state.mistakes.find(item => item.fingerprint === fingerprint);
      if (existing) {
        existing.wrongCount++;
        existing.lastWrongAt = answeredAt;
        existing.lastAnswer = answer;
        existing.resolvedAt = "";
      } else {
        state.mistakes.push({
          id: fingerprint, fingerprint, exerciseId, grammarId: exercise.grammarId, usageId: exercise.usageId,
          wrongCount: 1, firstWrongAt: answeredAt, lastWrongAt: answeredAt, lastAnswer: answer, resolvedAt: ""
        });
      }
    }
    exercise.lastReviewedAt = answeredAt;
    reviewFilter = "all";
    scheduleExercise(exercise, attempt, isCorrect ? "good" : "again");
    selectedExerciseId = exerciseId;
    revealedExerciseId = exerciseId;
    renderReview();
    toast(isCorrect ? "回答正确，已记录本次练习。" : "答案不正确，已加入错题库；重复错误会合并记录。", !isCorrect);
  }

  async function generateExerciseWithAi() {
    const grammar = grammarById(selectedGrammarId) || state.grammars[0];
    if (!grammar) {
      toast("还没有语法条目，请先手动添加语法或建立普通练习题。", true);
      openExerciseModal();
      return;
    }
    if (!sessionApiKey || !aiConfig.baseUrl || !aiConfig.model) {
      toast("AI 不可用，已切换到手动建题；请配置 AI 后再试。", true);
      openExerciseModal({ grammarId: grammar.id, usageId: grammar.usages[0]?.id || "" });
      return;
    }
    const button = root.querySelector('[data-action="generate-exercise"]');
    if (button) { button.disabled = true; button.textContent = "生成中…"; }
    const examples = state.sentences.filter(sentence => sentence.instances.some(instance =>
      instance.grammarId === grammar.id && (!grammar.usages.length || grammar.usages.some(usage => sentence.instances.some(i => i.grammarId === grammar.id && i.usageId === usage.id)))))
      .slice(0, 5).map(sentence => sentence.japanese);
    const prompt = `只返回 JSON：{"type":"choice","prompt":"题干","options":["选项A","选项B","选项C","选项D"],"correctAnswer":"正确选项原文","explanation":"简短中文解释","usageId":"已有用法ID","difficulty":"N3"}。为指定语法生成一道唯一答案的日语练习题，题干、选项和答案必须一致，避免依赖未提供的外部知识。`;
    const payload = {
      model: aiConfig.model, temperature: 0.2, max_tokens: 1200, response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify({
          grammar: { id: grammar.id, name: grammar.name, jlpt: grammar.jlpt, connection: grammar.connection,
            usages: grammar.usages.map(usage => ({ id: usage.id, name: usage.name, meaning: usage.meaning, explanation: usage.explanation })) },
          personalExamples: examples
        }) }
      ]
    };
    try {
      const base = aiConfig.baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + sessionApiKey },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}。`);
      const result = jsonFromResponse((await response.json()).choices?.[0]?.message?.content || "");
      const type = ["choice", "fill", "free"].includes(result.type) ? result.type : "choice";
      const options = Array.isArray(result.options) ? result.options.map(String) : [];
      if (!String(result.prompt || "").trim() || !String(result.correctAnswer || "").trim()
        || (type === "choice" && (options.length < 2 || !options.some(option => normalizeAnswer(option) === normalizeAnswer(result.correctAnswer))))) {
        throw new Error("AI 返回的题目缺字段或答案与选项不一致。");
      }
      const selectedUsage = grammar.usages.find(usage => usage.id === result.usageId) || grammar.usages[0];
      openExerciseModal({
        type, prompt: result.prompt, options, correctAnswer: result.correctAnswer, explanation: result.explanation || "",
        grammarId: grammar.id, usageId: selectedUsage?.id || "", difficulty: result.difficulty || grammar.jlpt,
        origin: "AI", aiModel: aiConfig.model, promptVersion: "practice-v1"
      }, "AI");
    } catch (error) {
      console.error("生成练习题失败", error);
      toast(`AI 出题失败：${error.message || "网络或响应异常"}。请手动填写，已保留本地练习入口。`, true);
      openExerciseModal({ grammarId: grammar.id, usageId: grammar.usages[0]?.id || "" });
    } finally {
      if (button?.isConnected) { button.disabled = false; button.textContent = "✦ AI 生成题目"; }
    }
  }

  function createPracticeSentence() {
    const targets = state.grammars.flatMap(grammar => grammar.usages.map(usage => ({
      value: `${grammar.id}::${usage.id}`, label: `${grammar.name} → ${usage.name}`
    })));
    if (!targets.length) { toast("请先添加一条 Grammar/Usage。", true); return; }
    const targetOptions = targets.map(target => `<option value="${esc(target.value)}">${esc(target.label)}</option>`).join("");
    pendingPracticeEvaluation = null;
    const body = `<div class="form-grid"><div class="form-field full"><label>Grammar / Usage</label><select name="target">${targetOptions}</select></div><div class="form-field full"><label>我的日语造句 *</label><textarea name="japanese" rows="3" required></textarea></div><div class="form-field full"><label>中文意思（可选）</label><textarea name="chinese" rows="2"></textarea></div><div class="form-field full"><div id="practice-evaluation" class="practice-evaluation muted tiny">AI 评价为辅助建议。无网络或 AI 不可用时，可以照常手动保存。</div></div><div class="setting-actions form-field full"><button type="button" class="button button-secondary" data-action="evaluate-practice-sentence">✦ AI 评价</button></div></div>`;
    openModal("主动造句与语法评价", "先选目标用法并写句子；AI 评价失败不会清除草稿，仍可手动保存。", body, data => {
      const japanese = data.get("japanese").trim();
      if (!japanese) { toast("请填写日语句子。", true); return; }
      const [grammarId, usageId] = String(data.get("target") || "").split("::");
      const evaluation = pendingPracticeEvaluation?.signature === practiceSignature(japanese, grammarId, usageId)
        ? pendingPracticeEvaluation.result : null;
      const instance = evaluation && Number.isInteger(evaluation.start) && Number.isInteger(evaluation.end)
        && evaluation.start >= 0 && evaluation.end > evaluation.start && evaluation.end <= japanese.length
        && japanese.slice(evaluation.start, evaluation.end) === evaluation.text
        ? [{ id: uid("instance"), grammarId, usageId, start: evaluation.start, end: evaluation.end,
          text: evaluation.text, aiJudgment: evaluation.recommendation || "AI 评价关联", confidence: 0.7,
          userConfirmed: false, userModified: false, origin: "AI 造句评价" }] : [];
      const sentence = {
        id: uid("sentence"), japanese, chinese: data.get("chinese").trim(), source: "练习造句",
        sourceType: "自己造句", addedAt: new Date().toISOString(), notes: "",
        favorite: false, reviewed: false, analysisStatus: "待分析", instances: instance,
        wordInstances: [], practiceEvaluation: evaluation ? { ...evaluation, grammarId, usageId, evaluatedAt: new Date().toISOString(), model: aiConfig.model } : null
      };
      state.sentences.unshift(sentence);
      selectedSentenceId = sentence.id;
      pendingPracticeEvaluation = null;
      persist(); closeModal(); setPage("sentences");
      toast(instance.length ? "造句与 AI 评价已保存，语法关联仍可人工修订。" : "造句已保存；可稍后手动添加并定位 Grammar/Usage。");
    }, "保存造句");
    modalRoot.querySelector("#modal-form").addEventListener("input", () => {
      pendingPracticeEvaluation = null;
      const result = document.getElementById("practice-evaluation");
      if (result) result.textContent = "句子或目标用法已修改，请重新评价；也可以直接手动保存。";
    });
  }

  function practiceSignature(japanese, grammarId, usageId) {
    return `${grammarId}::${usageId}::${japanese.trim()}`;
  }

  async function evaluatePracticeSentence() {
    const form = modalRoot.querySelector("#modal-form");
    const japanese = form?.elements.namedItem("japanese")?.value.trim();
    const [grammarId, usageId] = String(form?.elements.namedItem("target")?.value || "").split("::");
    const grammar = grammarById(grammarId);
    const usage = usageById(grammar, usageId);
    const resultNode = document.getElementById("practice-evaluation");
    if (!japanese || !grammar || !usage) {
      toast("请填写句子并选择有效的 Grammar/Usage。", true);
      return;
    }
    if (!sessionApiKey || !aiConfig.baseUrl || !aiConfig.model) {
      if (resultNode) resultNode.textContent = "AI 未配置或当前不可用。草稿仍在；你可以自行判断语法正确性并直接保存。";
      toast("AI 不可用；可按人工流程继续保存造句。", true);
      return;
    }
    const button = modalRoot.querySelector('[data-action="evaluate-practice-sentence"]');
    if (button) { button.disabled = true; button.textContent = "评价中…"; }
    if (resultNode) resultNode.textContent = "正在请求 AI 评价；草稿仅保留在当前表单中。";
    const system = `作为谨慎的日语教师，评价学生是否正确使用指定 Grammar 和 Usage。只返回 JSON：{"grammarCorrect":true,"usageCorrect":true,"connectionCorrect":true,"naturalness":1,"errors":[{"type":"类型","description":"说明"}],"recommendation":"简短中文建议","text":"原句中对应语法片段","start":0,"end":1}。naturalness 为 1 到 5。start/end 是原句 UTF-16 索引，end 不包含；找不到准确片段时 text 设为空且 start/end 设为 -1。不得把不确定内容说成确定事实。`;
    try {
      const base = aiConfig.baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + sessionApiKey },
        body: JSON.stringify({
          model: aiConfig.model, temperature: 0.1, max_tokens: 900, response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify({ japanese, grammar: grammar.name, usage: usage.name, meaning: usage.meaning, connection: usage.connection }) }
          ]
        })
      });
      if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}。`);
      const result = jsonFromResponse((await response.json()).choices?.[0]?.message?.content || "");
      if (typeof result.grammarCorrect !== "boolean" || typeof result.usageCorrect !== "boolean"
        || typeof result.connectionCorrect !== "boolean" || !Array.isArray(result.errors)
        || !Number.isFinite(Number(result.naturalness)) || Number(result.naturalness) < 1 || Number(result.naturalness) > 5) {
        throw new Error("AI 返回内容不完整或格式无效。");
      }
      const start = Number(result.start), end = Number(result.end), text = String(result.text || "");
      const validRange = Number.isInteger(start) && Number.isInteger(end) && start >= 0
        && end > start && end <= japanese.length && japanese.slice(start, end) === text;
      const normalizedResult = { ...result, start: validRange ? start : -1, end: validRange ? end : -1, text: validRange ? text : "" };
      pendingPracticeEvaluation = {
        signature: practiceSignature(japanese, grammarId, usageId), result: normalizedResult
      };
      if (resultNode) {
        const flags = [["Grammar", result.grammarCorrect], ["Usage", result.usageCorrect], ["接续", result.connectionCorrect]]
          .map(([label, valid]) => `${label} ${valid ? "✓" : "需检查"}`).join(" · ");
        const errors = result.errors.map(item => `${item.type || "反馈"}：${item.description || ""}`).join("\n");
        resultNode.textContent = `${flags}\n自然度 ${Math.round(Number(result.naturalness))}/5\n${result.recommendation || ""}${errors ? `\n${errors}` : ""}${validRange ? `\n已定位片段：${text}` : "\n未能可靠定位语法片段，保存后请人工添加关联。"}\n确认无误后点击“保存造句”；该反馈会标记为 AI 生成。`;
        resultNode.classList.add("has-evaluation");
      }
    } catch (error) {
      console.error("AI 造句评价失败", error);
      if (resultNode) {
        resultNode.textContent = `AI 评价失败：${error.message || "网络或服务异常"}。草稿没有丢失；请重试或按自己的判断直接保存。`;
        resultNode.classList.remove("has-evaluation");
      }
      toast("AI 评价失败；可重试或手动保存草稿。", true);
    } finally {
      if (button?.isConnected) { button.disabled = false; button.textContent = "✦ AI 评价"; }
    }
  }

  function openSentenceTranslationModal(sentenceId) {
    const sentence = state.sentences.find(item => item.id === sentenceId);
    if (!sentence) return;
    let generatedAt = "";
    let generatedModel = "";
    const body = `<div class="form-grid"><div class="form-field full"><label>日语原文</label><textarea rows="3" readonly>${esc(sentence.japanese)}</textarea></div><div class="form-field full"><label>中文翻译 *</label><textarea name="translation" rows="3" required>${esc(sentence.chinese || sentence.aiTranslation?.translation || "")}</textarea></div><div class="form-field full"><label>翻译讲解 *</label><textarea name="explanation" rows="6" required>${esc(sentence.aiTranslation?.explanation || "")}</textarea></div><div class="form-field full"><div class="setting-actions"><button type="button" class="button button-secondary" data-action="generate-sentence-translation">✦ 生成 / 重新生成</button><span class="muted tiny">原文及关联语法会发送到当前配置的 AI 服务；生成内容经你保存后才写入本地。</span></div><p id="translation-status" class="muted tiny" aria-live="polite"></p></div></div>`;
    openModal("AI 翻译与讲解", "可离线编辑已保存的译文和讲解。AI 生成结果需经检查并保存；不会覆盖你的备注或语法关联。", body, data => {
      const translation = String(data.get("translation") || "").trim();
      const explanation = String(data.get("explanation") || "").trim();
      if (!translation || !explanation) {
        toast("请填写中文翻译和翻译讲解。", true);
        return;
      }
      const previous = sentence.aiTranslation || {};
      sentence.chinese = translation;
      sentence.aiTranslation = {
        translation,
        explanation,
        origin: generatedAt ? "AI（用户审核）" : previous.origin || "用户编辑",
        model: generatedModel || previous.model || "",
        generatedAt: generatedAt || previous.generatedAt || "",
        savedAt: new Date().toISOString()
      };
      persist();
      closeModal();
      renderSentences();
      toast("翻译与讲解已保存到本地句子。");
    }, "保存翻译与讲解");
    modalRoot.querySelector('[data-action="generate-sentence-translation"]').addEventListener("click", () => {
      generateSentenceTranslation(sentence, value => {
        generatedAt = value.generatedAt;
        generatedModel = value.model;
      });
    });
  }

  async function generateSentenceTranslation(sentence, onGenerated) {
    const form = modalRoot.querySelector("#modal-form");
    const button = modalRoot.querySelector('[data-action="generate-sentence-translation"]');
    const status = modalRoot.querySelector("#translation-status");
    if (!form || !button) return;
    if (!sessionApiKey || !aiConfig.baseUrl || !aiConfig.model) {
      if (status) status.textContent = "AI 接口未配置；请取消后前往设置。当前草稿仍保留。";
      return;
    }
    if (sentence.japanese.length > 5000) {
      if (status) status.textContent = "句子超过 5000 个字符，为避免发送过长内容，请先拆分后分别翻译。";
      return;
    }
    const base = aiConfig.baseUrl.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
    try {
      const url = new URL(base);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("AI API 地址必须使用 HTTP 或 HTTPS。");
    } catch (error) {
      if (status) status.textContent = error.message || "AI API 地址无效。";
      return;
    }
    button.disabled = true;
    button.textContent = "生成中…";
    if (status) status.textContent = "正在请求 AI；当前表单内容不会丢失。";
    const grammarContext = sentence.instances.map(instance => {
      const grammar = grammarById(instance.grammarId);
      const usage = usageById(grammar, instance.usageId);
      return {
        grammar: grammar?.name || instance.pendingGrammarName || "",
        usage: usage?.name || instance.pendingUsageName || "",
        meaning: usage?.meaning || instance.aiJudgment || ""
      };
    }).filter(item => item.grammar || item.usage);
    const prompt = "你是日语翻译与语言学习讲解助手。将用户提供的日语句子准确翻译成自然、忠实的简体中文，并用简明中文解释句意、关键语法/表达、语气或翻译取舍。优先依据给出的语法关联；不要臆造上下文、语法知识或句中没有的信息。若原句有歧义，说明可能的解释，不要把不确定内容写成确定结论。只返回 JSON：{\"translation\":\"中文译文\",\"explanation\":\"中文翻译讲解\"}。";
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + sessionApiKey },
        body: JSON.stringify({
          model: aiConfig.model,
          temperature: 0.2,
          max_tokens: 1400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify({ japanese: sentence.japanese, grammarContext }) }
          ]
        })
      });
      if (!response.ok) {
        const reason = response.status === 401 || response.status === 403
          ? "API Key 或服务权限无效。"
          : response.status === 429 ? "服务商限流或余额不足，请稍后检查账户。"
            : response.status >= 500 ? "服务商暂时不可用，请稍后重试。"
              : `服务商返回 HTTP ${response.status}。`;
        throw new Error(reason);
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error("AI 服务未返回有效 JSON 响应。"); }
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("AI 服务没有返回翻译内容。");
      let result;
      try { result = jsonFromResponse(content); }
      catch { throw new Error("AI 未返回有效的翻译 JSON；草稿未更改。"); }
      if (typeof result.translation !== "string" || typeof result.explanation !== "string") {
        throw new Error("AI 返回结果缺少字符串格式的译文或讲解；草稿未更改。");
      }
      const translation = result.translation.trim();
      const explanation = result.explanation.trim();
      if (!translation || !explanation) throw new Error("AI 返回结果缺少译文或讲解；草稿未更改。");
      form.elements.namedItem("translation").value = translation;
      form.elements.namedItem("explanation").value = explanation;
      const generatedAt = new Date().toISOString();
      onGenerated({ generatedAt, model: aiConfig.model });
      if (status) status.textContent = "生成完成。可编辑以上内容；点击“保存翻译与讲解”后才会写入本地。";
    } catch (error) {
      console.error("AI 翻译失败", error);
      const detail = error instanceof TypeError
        ? "网络请求失败；请检查网络、API 地址和服务商的浏览器跨域策略。"
        : error.message || "网络或响应异常。";
      if (status) status.textContent = `翻译失败：${detail} 当前草稿仍保留，可修改后重试。`;
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "✦ 生成 / 重新生成";
      }
    }
  }

  function sentenceForm(sentence = {}) {
    return `<div class="form-grid">${field("日语原文", "japanese", sentence.japanese, { textarea: true, full: true, required: true, rows: 3 })}${field("中文翻译（可选）", "chinese", sentence.chinese, { textarea: true, full: true })}${field("英文翻译（可选）", "english", sentence.english, { textarea: true, full: true })}${field("来源类型", "sourceType", sentence.sourceType || "其他", { select: sourceTypes })}${field("具体来源", "source", sentence.source, { placeholder: "例如：第 12 集、小说书名" })}${field("我的备注", "notes", sentence.notes, { textarea: true, full: true })}</div>`;
  }

  function wordForm(entry = {}) {
    return `<div class="form-grid">${field("词条 / 辞書形", "headword", entry.headword, { required: true })}${field("读音（多个用逗号分隔）", "readings", (entry.readings || []).join(", "))}${field("汉字写法（多个用逗号分隔）", "spellings", (entry.spellings || []).join(", "))}${field("词性（多个用逗号分隔）", "partOfSpeech", (entry.partOfSpeech || []).join(", "))}${field("释义（每行一条）", "meanings", (entry.meanings || []).join("\n"), { textarea: true, full: true })}${field("同义 / 相关词（多个用逗号分隔）", "synonyms", (entry.synonyms || []).join(", "), { full: true })}${field("我的备注", "myNotes", entry.myNotes, { textarea: true, full: true })}</div>`;
  }

  function listFromInput(value) {
    return String(value || "").split(/[,，、;]/).map(item => item.trim()).filter(Boolean);
  }

  function addWord(entry = {}) {
    const isEdit = Boolean(entry.id);
    openModal(isEdit ? "编辑词条与个人备注" : "添加个人词条", "词典字段、外部数据来源和你的个人备注分别保存。", wordForm(entry), data => {
      const next = {
        ...(entry || {}),
        id: entry.id || uid("word"),
        headword: data.get("headword").trim(),
        readings: listFromInput(data.get("readings")),
        spellings: listFromInput(data.get("spellings")),
        partOfSpeech: listFromInput(data.get("partOfSpeech")),
        meanings: data.get("meanings").split(/\r?\n/).map(item => item.trim()).filter(Boolean),
        synonyms: listFromInput(data.get("synonyms")),
        myNotes: data.get("myNotes").trim(),
        sourceId: entry.sourceId || "source-user",
        sourceName: entry.sourceName || "我的词库",
        sourceType: entry.sourceType || "user",
        license: entry.license || "用户自行编写",
        importedAt: entry.importedAt || new Date().toISOString(),
        isFavorite: entry.isFavorite ?? true
      };
      const nextEntries = [...dictionaryEntries];
      const index = nextEntries.findIndex(item => item.id === next.id);
      if (index < 0) nextEntries.unshift(next); else nextEntries[index] = next;
      saveDictionaryEntries(nextEntries).then(() => {
        if (!state.dictionarySources.some(source => source.id === "source-user")) {
          state.dictionarySources.unshift({ id: "source-user", name: "我的词库", type: "user", version: "", license: "用户自行编写", originalId: "", importedAt: new Date().toISOString() });
          persist();
        }
        if (pendingWordContext) linkWordToSentence(next, pendingWordContext);
        selectedDictionaryEntryId = next.id;
        closeModal(); renderDictionary(); toast(isEdit ? "词条已更新" : "词条已加入我的词库");
      }).catch(error => {
        console.error("保存词条失败", error);
        toast(`保存词条失败：${error.message}`, true);
      });
    });
  }

  function linkWordToSentence(entry, context) {
    const sentence = state.sentences.find(item => item.id === context.sentenceId);
    if (!sentence) return;
    sentence.wordInstances ||= [];
    const word = ensureWordEntity(entry);
    const duplicate = sentence.wordInstances.find(item => item.start === context.start && item.end === context.end);
    const instance = {
      id: duplicate?.id || uid("word-instance"), wordId: word.id, dictionaryEntryId: entry.id, surface: context.surface,
      start: context.start, end: context.end, form: context.surface === entry.headword ? "辞書形 / 原形" : "句中形式",
      origin: "用户确认", userConfirmed: true
    };
    if (duplicate) Object.assign(duplicate, instance); else sentence.wordInstances.push(instance);
    persist();
  }

  function removeWordInstance(sentenceId, instanceId) {
    const sentence = state.sentences.find(item => item.id === sentenceId);
    const instance = sentence?.wordInstances?.find(item => item.id === instanceId);
    if (!sentence || !instance) return;
    sentence.wordInstances = sentence.wordInstances.filter(item => item.id !== instanceId);
    if (instance.wordId && !state.sentences.some(item => (item.wordInstances || []).some(word => word.wordId === instance.wordId))) {
      state.words = state.words.filter(word => word.id !== instance.wordId);
    }
    persist(); renderSentences(); toast("句中单词关联已移除。");
  }

  function linkCurrentWord(entryId) {
    const entry = dictionaryEntries.find(item => item.id === entryId);
    if (!entry || !pendingWordContext) return;
    linkWordToSentence(entry, pendingWordContext);
    pendingWordContext = null;
    setPage("sentences");
    toast(`「${entry.headword}」已关联到句中词语。`);
  }

  async function removeDictionarySource(sourceId) {
    const source = state.dictionarySources.find(item => item.id === sourceId);
    if (!source || source.type === "user") return;
    const removedIds = new Set(dictionaryEntries.filter(entry => entry.sourceId === sourceId).map(entry => entry.id));
    const nextEntries = dictionaryEntries.filter(entry => entry.sourceId !== sourceId);
    try {
      await saveDictionaryEntries(nextEntries);
      state.sentences.forEach(sentence => {
        sentence.wordInstances = (sentence.wordInstances || []).map(instance => {
          if (removedIds.has(instance.dictionaryEntryId)) return { ...instance, dictionaryEntryId: "" };
          if (source.type === "mdict" && instance.dictionarySourceId === source.mdictDictionaryId) {
            return { ...instance, dictionarySourceId: "" };
          }
          return instance;
        });
      });
      state.words.forEach(word => {
        word.dictionaryEntryIds = (word.dictionaryEntryIds || []).filter(id => !removedIds.has(id));
        if (source.type === "mdict") {
          word.dictionarySources = (word.dictionarySources || []).filter(item =>
            item.id !== source.id && item.id !== source.mdictDictionaryId);
        }
      });
      state.dictionarySources = state.dictionarySources.filter(item => item.id !== sourceId);
      persist();
      selectedDictionaryEntryId = "";
      renderDictionary();
      toast(`已移除来源「${source.name}」及 ${removedIds.size} 条词条。`);
    } catch (error) {
      console.error("移除词典来源失败", error);
      toast(`移除来源失败：${error.message}`, true);
    }
  }

  async function deleteDictionaryEntry(entryId) {
    const entry = dictionaryEntries.find(item => item.id === entryId);
    if (!entry) return;
    try {
      await saveDictionaryEntries(dictionaryEntries.filter(item => item.id !== entryId));
      state.words.forEach(word => {
        word.dictionaryEntryIds = (word.dictionaryEntryIds || []).filter(id => id !== entryId);
      });
      state.sentences.forEach(sentence => {
        sentence.wordInstances = (sentence.wordInstances || []).map(instance => instance.dictionaryEntryId === entryId
          ? { ...instance, dictionaryEntryId: "" } : instance);
      });
      persist();
      selectedDictionaryEntryId = "";
      renderDictionary();
      toast(`词条「${entry.headword}」已删除，保留了句中单词记录。`);
    } catch (error) {
      console.error("删除词条失败", error);
      toast(`删除词条失败：${error.message}`, true);
    }
  }

  function lookupWordFromSentence(sentenceId, start, end, surface) {
    void openMdictLookup({ sentenceId, start, end, surface }, surface);
  }

  function openDictionaryImport() {
    document.getElementById("dictionary-file").click();
  }

  function sourceIdFor(name, license) {
    const previous = state.dictionarySources.find(source => source.name === name && source.license === license && source.type !== "user");
    return previous?.id || uid("source");
  }

  function importDictionaryEntries(rawEntries, metadata) {
    if (!rawEntries.length) {
      toast("没有找到可导入的词条。", true);
      return;
    }
    const now = new Date().toISOString();
    const sourceId = sourceIdFor(metadata.name, metadata.license);
    const source = {
      id: sourceId, name: metadata.name, type: metadata.type || "dictionary",
      url: metadata.url || "", version: metadata.version || "", license: metadata.license || "未注明",
      originalId: "", importedAt: now
    };
    const existingIds = new Set(dictionaryEntries.map(entry => entry.id));
    const imported = rawEntries.map((raw, index) => {
      const headword = String(raw.headword || "").trim();
      if (!headword) return null;
      const originalId = String(raw.originalId || raw.original_id || "").trim();
      const id = originalId ? `dict_${sourceId}_${originalId}` : `dict_${sourceId}_${encodeURIComponent(headword)}_${index}`;
      const previous = dictionaryEntries.find(entry => entry.id === id);
      return {
        ...(previous || {}),
        id, headword,
        readings: listFromInput(Array.isArray(raw.readings) ? raw.readings.join(",") : raw.readings),
        spellings: listFromInput(Array.isArray(raw.spellings) ? raw.spellings.join(",") : raw.spellings),
        partOfSpeech: listFromInput(Array.isArray(raw.partOfSpeech) ? raw.partOfSpeech.join(",") : (raw.partOfSpeech || raw.pos)),
        meanings: (Array.isArray(raw.meanings) ? raw.meanings : String(raw.meanings || raw.meaning || "").split(/\r?\n/)).map(item => String(item).trim()).filter(Boolean),
        synonyms: listFromInput(Array.isArray(raw.synonyms) ? raw.synonyms.join(",") : raw.synonyms),
        sourceId, sourceName: source.name, sourceType: source.type, sourceUrl: source.url, sourceVersion: source.version,
        license: source.license, originalId, importedAt: now,
        isFavorite: Boolean(previous?.isFavorite), myNotes: previous?.myNotes || "",
        occurrenceCount: previous?.occurrenceCount || 0
      };
    }).filter(Boolean);
    const merged = new Map(dictionaryEntries.map(entry => [entry.id, entry]));
    imported.forEach(entry => merged.set(entry.id, entry));
    const nextEntries = [...merged.values()];
    saveDictionaryEntries(nextEntries).then(() => {
      const index = state.dictionarySources.findIndex(item => item.id === source.id);
      if (index >= 0) state.dictionarySources[index] = source;
      else state.dictionarySources.push(source);
      persist();
      selectedDictionaryEntryId = imported[0]?.id || "";
      dictionarySearch = "";
      renderDictionary();
      toast(`导入完成：${imported.length} 条词条（新增或更新），来源：${source.name}`);
    }).catch(error => {
      console.error("导入词典失败", error);
      toast(`导入词典失败：${error.message}`, true);
    });
  }

  function parseJmdictXml(text) {
    const normalized = text.replace(/<!DOCTYPE[\s\S]*?>/i, "")
      .replace(/&([A-Za-z][A-Za-z0-9._-]*);/g, (entity, name) =>
        ["amp", "lt", "gt", "quot", "apos"].includes(name) ? entity : name);
    const xml = new DOMParser().parseFromString(normalized, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("JMdict XML 格式无效或文件不完整。");
    const entries = [...xml.getElementsByTagName("entry")];
    if (!entries.length) throw new Error("XML 中未找到 JMdict entry 节点。");
    return entries.map(node => {
      const originalId = node.querySelector("ent_seq")?.textContent?.trim() || "";
      const spellings = [...node.querySelectorAll("k_ele > keb")].map(item => item.textContent.trim()).filter(Boolean);
      const readings = [...node.querySelectorAll("r_ele > reb")].map(item => item.textContent.trim()).filter(Boolean);
      const senses = [...node.querySelectorAll("sense")];
      const partOfSpeech = [...new Set(senses.flatMap(sense => [...sense.children]
        .filter(item => item.localName === "pos").map(item => item.textContent.trim()).filter(Boolean)))];
      const meanings = senses.flatMap(sense => [...sense.children].filter(item => item.localName === "gloss")
        .filter(item => !item.getAttribute("xml:lang") || item.getAttribute("xml:lang") === "eng")
        .map(item => item.textContent.trim()).filter(Boolean));
      return { originalId, headword: spellings[0] || readings[0] || "", spellings, readings, partOfSpeech, meanings };
    }).filter(entry => entry.headword);
  }

  function showDelimitedMapping(rows, fileName, delimiter) {
    if (rows.length < 2) throw new Error("词典文件至少需要一行表头和一行数据。");
    const headers = rows[0].map((value, index) => value.trim() || `列 ${index + 1}`);
    const columns = [{ value: "", label: "不映射" }, ...headers.map((header, index) => ({ value: String(index), label: header }))];
    const initial = (names) => {
      const index = headers.findIndex(header => names.some(name => header.toLowerCase().includes(name)));
      return index < 0 ? "" : String(index);
    };
    const selector = (fieldName, label, defaultColumn, required = false) => `<div class="form-field"><label>${esc(label)}${required ? " *" : ""}</label><select name="${fieldName}"${required ? " required" : ""}>${columns.map(column => `<option value="${esc(column.value)}"${column.value === defaultColumn ? " selected" : ""}>${esc(column.label)}</option>`).join("")}</select></div>`;
    const body = `<div class="form-grid">${field("词典名称", "sourceName", fileName.replace(/\.[^.]+$/, ""), { required: true })}${field("版本 / 日期", "sourceVersion", "")}${field("许可证", "sourceLicense", "", { required: true, placeholder: "如未知，请填写“未注明”" })}${field("来源 URL", "sourceUrl", "", { full: true })}<div class="form-field"><label>字段映射</label></div>${selector("mapHeadword", "词条 / 辞書形", initial(["headword", "word", "kanji", "term", "词条", "单词"]), true)}${selector("mapReading", "读音", initial(["reading", "kana", "读音", "假名"]))}${selector("mapSpelling", "汉字写法", initial(["spelling", "kanji", "写法"]))}${selector("mapPos", "词性", initial(["part_of_speech", "pos", "词性"]))}${selector("mapMeaning", "释义", initial(["meaning", "gloss", "definition", "释义", "解释"]))}${selector("mapSynonyms", "同义 / 相关词", initial(["synonym", "related", "同义"]))}${selector("mapOriginalId", "原始词条 ID", initial(["original_id", "entry_id", "id", "ent_seq"]))}</div>
      <p class="notice form-field full">${rows.length - 1} 行数据将导入本地 IndexedDB。请确认你有权使用该数据，并填写准确的来源与许可。</p>`;
    openModal("导入词典 · 字段映射", "预览表头并将原始字段映射到统一 Dictionary Entry。", body, data => {
      const column = key => data.get(key) === "" ? "" : Number(data.get(key));
      const get = (row, key) => { const index = column(key); return index === "" ? "" : row[index] || ""; };
      if (column("mapHeadword") === "") { toast("请映射词条 / 辞書形字段。", true); return; }
      const mapped = rows.slice(1).filter(row => row.some(Boolean)).map(row => ({
        headword: get(row, "mapHeadword"), readings: get(row, "mapReading"), spellings: get(row, "mapSpelling"),
        partOfSpeech: get(row, "mapPos"), meanings: get(row, "mapMeaning"), synonyms: get(row, "mapSynonyms"),
        originalId: get(row, "mapOriginalId")
      }));
      const name = data.get("sourceName").trim();
      const license = data.get("sourceLicense").trim();
      if (!license) { toast("请填写词典许可；如未知，请明确填写“未注明”。", true); return; }
      closeModal();
      importDictionaryEntries(mapped, { name, license, version: data.get("sourceVersion").trim(), url: data.get("sourceUrl").trim(), type: "dictionary" });
    }, "映射并导入");
  }

  async function importDictionaryFile(file) {
    try {
      const text = await file.text();
      const extension = file.name.toLowerCase().split(".").pop();
      if (extension === "xml") {
        const entries = parseJmdictXml(text);
        openModal("导入 JMdict XML", "JMdict 数据许可为 CC BY-SA 4.0；保留署名与许可证信息。", `<div class="form-grid">${field("数据源名称", "sourceName", "JMdict", { required: true })}${field("数据版本", "sourceVersion", "未注明")}${field("许可证", "sourceLicense", "CC BY-SA 4.0", { required: true })}${field("来源 URL", "sourceUrl", "https://www.edrdg.org/jmdict/j_jmdict.html", { full: true })}<p class="notice form-field full">检测到 ${entries.length.toLocaleString()} 个词条。数据写入本机 IndexedDB，并记录来源及原始 ent_seq。</p></div>`, data => {
          const name = data.get("sourceName").trim(), license = data.get("sourceLicense").trim();
          if (!license) { toast("请填写 JMdict 许可证。", true); return; }
          closeModal();
          importDictionaryEntries(entries, { name, version: data.get("sourceVersion").trim(), license, url: data.get("sourceUrl").trim(), type: "dictionary" });
        }, "导入 JMdict");
      } else if (extension === "json") {
        const parsed = JSON.parse(text);
        const entries = Array.isArray(parsed) ? parsed : (parsed.entries || parsed.dictionaryEntries || []);
        if (!Array.isArray(entries)) throw new Error("JSON 需要是词条数组，或包含 entries 数组。");
        const source = parsed.source || {};
        openModal("导入 JSON 词典", "将 JSON 词条映射到统一词条字段。", `<div class="form-grid">${field("数据源名称", "sourceName", source.name || file.name.replace(/\.[^.]+$/, ""), { required: true })}${field("数据版本", "sourceVersion", source.version || "")}${field("许可证", "sourceLicense", source.license || "", { required: true, placeholder: "如未知，请填写“未注明”" })}${field("来源 URL", "sourceUrl", source.url || "", { full: true })}<p class="notice form-field full">检测到 ${entries.length.toLocaleString()} 条 JSON 记录。支持 headword、reading(s)、partOfSpeech/pos、meaning(s)、spellings、synonyms 和 originalId。</p></div>`, data => {
          const license = data.get("sourceLicense").trim();
          if (!license) { toast("请填写词典许可证；如未知，请明确填写“未注明”。", true); return; }
          closeModal();
          importDictionaryEntries(entries.map(item => ({
            headword: item.headword || item.word || item.term,
            readings: item.readings || item.reading,
            spellings: item.spellings || item.kanji,
            partOfSpeech: item.partOfSpeech || item.part_of_speech || item.pos,
            meanings: item.meanings || item.meaning || item.gloss,
            synonyms: item.synonyms || item.related,
            originalId: item.originalId || item.original_id || item.ent_seq || item.id
          })), { name: data.get("sourceName").trim(), version: data.get("sourceVersion").trim(), license, url: data.get("sourceUrl").trim(), type: "dictionary" });
        }, "导入 JSON");
      } else {
        const delimiter = extension === "tsv" || file.type.includes("tab-separated") ? "\t" : ",";
        const rows = parseDelimitedRows(text, delimiter);
        showDelimitedMapping(rows, file.name, delimiter);
      }
    } catch (error) {
      console.error("读取词典文件失败", error);
      toast(`读取词典文件失败：${error.message}`, true);
    }
  }

  function instanceForm(sentence, instance = {}) {
    const grammar = grammarById(instance.grammarId) || state.grammars[0];
    const selectedGrammarId = grammar?.id || "";
    const usages = grammar?.usages || [];
    return `<div class="form-grid">${field("关联语法", "grammarId", selectedGrammarId, { select: state.grammars.map(item => ({ value: item.id, label: item.name })) })}
      <div class="form-field"><label>具体用法</label><select name="usageId">${usages.map(u => `<option value="${esc(u.id)}"${u.id === instance.usageId ? " selected" : ""}>${esc(u.name)} — ${esc(u.meaning || "")}</option>`).join("")}<option value="">待确认用法</option></select></div>
      ${field("高亮文本", "text", instance.text || "", { required: true })}${field("AI判断 / 备注", "aiJudgment", instance.aiJudgment || "", { placeholder: "例如：能力发生变化" })}
      ${field("起始位置（从 0 开始）", "start", instance.start ?? "", { required: true })}${field("结束位置（不含）", "end", instance.end ?? "", { required: true })}
      ${field("置信度（0–1）", "confidence", instance.confidence ?? "", { placeholder: "例如 0.9" })}<div class="form-field"><label>用户确认</label><select name="userConfirmed"><option value="false"${!instance.userConfirmed ? " selected" : ""}>待确认</option><option value="true"${instance.userConfirmed ? " selected" : ""}>已确认</option></select></div>
      <p class="tiny muted form-field full">原句：<span class="japanese">${esc(sentence.japanese)}</span>（位置按 JavaScript 字符串索引计算）</p></div>`;
  }

  function addGrammar() {
    openModal("添加语法", "Grammar 是语法形式；一个 Grammar 可以有多个独立 Usage。", grammarForm(), data => {
      const now = new Date().toISOString();
      const grammar = {
        id: uid("grammar"), name: data.get("name").trim(), jlpt: data.get("jlpt"), variants: data.get("variants"),
        type: data.get("type"), connection: data.get("connection"), educationCategory: data.get("educationCategory"),
        schoolCategory: data.get("schoolCategory"), related: data.get("related"), confusable: data.get("confusable"),
        myExplanation: data.get("myExplanation"), myNotes: data.get("myNotes"), source: data.get("source"),
        createdAt: now, updatedAt: now, usages: []
      };
      state.grammars.unshift(grammar);
      selectedGrammarId = grammar.id;
      persist(); closeModal(); setPage("grammars"); toast("语法已添加");
    });
  }

  function editGrammar(id) {
    const grammar = grammarById(id);
    if (!grammar) return;
    openModal("编辑语法", "修改语法信息；你的个人解释与备注会独立保存。", grammarForm(grammar), data => {
      Object.assign(grammar, Object.fromEntries(["name", "jlpt", "variants", "type", "connection", "educationCategory", "schoolCategory", "related", "confusable", "source", "myExplanation", "myNotes"].map(key => [key, data.get(key).trim()])));
      grammar.updatedAt = new Date().toISOString();
      persist(); closeModal(); render(); toast("语法已更新");
    });
  }

  function addUsage(grammarId, existing) {
    const grammar = grammarById(grammarId);
    if (!grammar) return;
    openModal(existing ? "编辑具体用法" : `为「${grammar.name}」添加用法`, "用法、用户笔记和例句与 Grammar 分层保存。", usageForm(existing || {}), data => {
      const usageData = {
        name: data.get("name").trim(), meaning: data.get("meaning").trim(), explanation: data.get("explanation").trim(),
        connection: data.get("connection").trim(), conditions: data.get("conditions").trim(), cautions: data.get("cautions").trim(),
        confusable: data.get("confusable").trim(), reference: data.get("reference").trim(),
        officialExamples: data.get("officialExamples").split(/\r?\n/).map(s => s.trim()).filter(Boolean),
        userExamples: data.get("userExamples").split(/\r?\n/).map(s => s.trim()).filter(Boolean),
        myExplanation: data.get("myExplanation").trim(), myNotes: data.get("myNotes").trim()
      };
      if (existing) Object.assign(existing, usageData);
      else grammar.usages.push({ id: uid("usage"), ...usageData });
      grammar.updatedAt = new Date().toISOString();
      persist(); closeModal(); render(); toast(existing ? "用法已更新" : "用法已添加");
    });
  }

  function addSentence(prefill = {}, relation = null) {
    openModal("收集一句日语", "可以先保存句子，再分析或手动关联语法。", sentenceForm(prefill), data => {
      const sentence = {
        id: uid("sentence"), japanese: data.get("japanese").trim(), chinese: data.get("chinese").trim(), english: data.get("english").trim(),
        source: data.get("source").trim(), sourceType: data.get("sourceType"), addedAt: new Date().toISOString(),
        notes: data.get("notes").trim(), favorite: false, reviewed: false, analysisStatus: "待分析", instances: []
      };
      state.sentences.unshift(sentence);
      selectedSentenceId = sentence.id;
      if (relation) {
        const grammar = grammarById(relation.grammarId);
        const usage = usageById(grammar, relation.usageId);
        if (grammar && usage) {
          usage.userExamples ||= [];
          usage.userExamples.push(sentence.japanese);
          const selectedText = relation.selectedText || "";
          const start = selectedText ? sentence.japanese.indexOf(selectedText) : -1;
          const text = start >= 0 ? selectedText : sentence.japanese;
          sentence.instances.push({ id: uid("instance"), grammarId: grammar.id, usageId: usage.id,
            start: Math.max(0, start), end: Math.max(0, start) + text.length, text,
            aiJudgment: "", confidence: null, userConfirmed: true, userModified: true, origin: "用户添加" });
        }
      }
      persist(); closeModal(); setPage("sentences"); toast("句子已保存");
    });
  }

  function editSentence(id) {
    const sentence = state.sentences.find(item => item.id === id);
    if (!sentence) return;
    openModal("编辑句子", "修改原文后，请检查已有语法高亮位置是否仍然准确。", sentenceForm(sentence), data => {
      Object.assign(sentence, {
        japanese: data.get("japanese").trim(), chinese: data.get("chinese").trim(), english: data.get("english").trim(),
        source: data.get("source").trim(), sourceType: data.get("sourceType"), notes: data.get("notes").trim()
      });
      persist(); closeModal(); render(); toast("句子已更新");
    });
  }

  function addInstance(sentenceId, existing) {
    const sentence = state.sentences.find(item => item.id === sentenceId);
    if (!sentence || !state.grammars.length) {
      toast("请先添加一条语法，再建立语法关联。", true);
      return;
    }
    openModal(existing ? "修改语法实例" : "添加句中语法", "调整具体 Grammar、Usage 和句中高亮范围。", instanceForm(sentence, existing || {}), data => {
      const start = Number(data.get("start")), end = Number(data.get("end"));
      const selectedText = data.get("text").trim();
      const confidenceValue = data.get("confidence");
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > sentence.japanese.length || end <= start) {
        toast("高亮位置无效，请检查起始/结束位置。", true);
        return;
      }
      if (confidenceValue !== "" && (!Number.isFinite(Number(confidenceValue)) || Number(confidenceValue) < 0 || Number(confidenceValue) > 1)) {
        toast("置信度必须是 0 到 1 之间的数字。", true);
        return;
      }
      if (sentence.japanese.slice(start, end) !== selectedText) {
        toast("高亮文本与所选位置不一致，请调整文本或位置。", true);
        return;
      }
      const item = {
        id: existing?.id || uid("instance"), grammarId: data.get("grammarId"), usageId: data.get("usageId") || "",
        start, end, text: selectedText, aiJudgment: data.get("aiJudgment").trim(),
        confidence: data.get("confidence") === "" ? null : Number(data.get("confidence")),
        userConfirmed: data.get("userConfirmed") === "true", userModified: true, origin: existing?.origin || "用户添加"
      };
      if (existing) Object.assign(existing, item);
      else sentence.instances.push(item);
      sentence.analysisStatus = "已分析";
      persist(); closeModal(); render(); toast(existing ? "语法实例已更新" : "语法实例已添加");
    });
    const grammarSelect = modalRoot.querySelector('[name="grammarId"]');
    grammarSelect.addEventListener("change", () => {
      const grammar = grammarById(grammarSelect.value);
      const usageSelect = modalRoot.querySelector('[name="usageId"]');
      usageSelect.innerHTML = `${(grammar?.usages || []).map(usage => `<option value="${esc(usage.id)}">${esc(usage.name)} — ${esc(usage.meaning || "")}</option>`).join("")}<option value="">待确认用法</option>`;
    });
  }

  function goToSentence(id) {
    selectedSentenceId = id;
    setPage("sentences");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportJson() {
    try {
      const entries = await openDictionaryDb().then(db => new Promise((resolve, reject) => {
        const request = db.transaction(DICTIONARY_STORE, "readonly").objectStore(DICTIONARY_STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("读取词库备份失败。"));
      }));
      const output = { format: "kotobacho-backup", version: 3, exportedAt: new Date().toISOString(), ...state, dictionaryEntries: entries };
      download(`kotobacho-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(output), "application/json");
      toast("完整 JSON 备份已导出");
    } catch (error) {
      console.error("导出 JSON 失败", error);
      toast(`导出失败：${error.message}`, true);
    }
  }

  function csvEscape(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  async function exportCsv() {
    const rows = [["type", "id", "data_json"]];
    for (const grammar of state.grammars) rows.push(["grammar", grammar.id, JSON.stringify(grammar)]);
    for (const word of state.words || []) rows.push(["word", word.id, JSON.stringify(word)]);
    for (const sentence of state.sentences) rows.push(["sentence", sentence.id, JSON.stringify(sentence)]);
    for (const source of state.dictionarySources || []) rows.push(["dictionarySource", source.id, JSON.stringify(source)]);
    for (const exercise of state.exercises || []) rows.push(["exercise", exercise.id, JSON.stringify(exercise)]);
    for (const attempt of state.reviewAttempts || []) rows.push(["reviewAttempt", attempt.id, JSON.stringify(attempt)]);
    for (const mistake of state.mistakes || []) rows.push(["mistake", mistake.id, JSON.stringify(mistake)]);
    try {
      const entries = await openDictionaryDb().then(db => new Promise((resolve, reject) => {
        const request = db.transaction(DICTIONARY_STORE, "readonly").objectStore(DICTIONARY_STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("读取词库备份失败。"));
      }));
      for (const entry of entries) rows.push(["dictionaryEntry", entry.id, JSON.stringify(entry)]);
      const csv = "\uFEFF" + rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
      download(`kotobacho-backup-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
      toast("完整 CSV 备份已导出");
    } catch (error) {
      console.error("导出 CSV 失败", error);
      toast(`导出失败：${error.message}`, true);
    }
  }

  function parseDelimitedRows(text, delimiter) {
    const rows = [];
    let row = [], value = "", quoted = false;
    for (let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
        else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) { row.push(value); value = ""; }
      else if (char === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
      else value += char;
    }
    if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
    if (quoted) throw new Error("分隔文本文件包含未闭合的引号。");
    return rows;
  }

  function parseCsv(text) {
    const rows = parseDelimitedRows(text, ",");
    const headerRow = rows.shift()?.map(item => item.trim()) || [];
    const typeIndex = headerRow.indexOf("type"), dataIndex = headerRow.indexOf("data_json");
    if (typeIndex < 0 || dataIndex < 0) throw new Error("CSV 必须包含 type 和 data_json 列。");
    return rows.filter(item => item[dataIndex]).map(item => {
      const data = JSON.parse(item[dataIndex]);
      return { type: item[typeIndex], data };
    });
  }

  async function importFile(file) {
    try {
      const text = await file.text();
      let incoming;
      if (file.name.toLowerCase().endsWith(".csv")) {
        const rows = parseCsv(text);
        incoming = {
          grammars: rows.filter(row => row.type === "grammar").map(row => row.data),
          words: rows.filter(row => row.type === "word").map(row => row.data),
          sentences: rows.filter(row => row.type === "sentence").map(row => row.data),
          dictionarySources: rows.filter(row => row.type === "dictionarySource").map(row => row.data),
          dictionaryEntries: rows.filter(row => row.type === "dictionaryEntry").map(row => row.data),
          exercises: rows.filter(row => row.type === "exercise").map(row => row.data),
          reviewAttempts: rows.filter(row => row.type === "reviewAttempt").map(row => row.data),
          mistakes: rows.filter(row => row.type === "mistake").map(row => row.data)
        };
      } else incoming = JSON.parse(text);
      if (!Array.isArray(incoming.grammars) || !Array.isArray(incoming.sentences)) throw new Error("文件需要包含 grammars 和 sentences 数组。");
      if (incoming.words && !Array.isArray(incoming.words)) throw new Error("words 必须是数组。");
      for (const key of ["exercises", "reviewAttempts", "mistakes"]) {
        if (incoming[key] && !Array.isArray(incoming[key])) throw new Error(`${key} 必须是数组。`);
      }
      const grammarMap = new Map(state.grammars.map(item => [item.id, item]));
      incoming.grammars.forEach(item => {
        if (!item.id || !item.name || !Array.isArray(item.usages)) throw new Error("语法记录缺少 id、name 或 usages 数组。");
        grammarMap.set(item.id, item);
      });
      const sentenceMap = new Map(state.sentences.map(item => [item.id, item]));
      incoming.sentences.forEach(item => {
        if (!item.id || typeof item.japanese !== "string" || !Array.isArray(item.instances)) throw new Error("句子记录缺少 id、日语原文或 instances 数组。");
        if (!Array.isArray(item.wordInstances)) item.wordInstances = [];
        sentenceMap.set(item.id, item);
      });
      if (incoming.dictionarySources && !Array.isArray(incoming.dictionarySources)) throw new Error("dictionarySources 必须是数组。");
      if (incoming.dictionaryEntries && !Array.isArray(incoming.dictionaryEntries)) throw new Error("dictionaryEntries 必须是数组。");
      for (const item of incoming.exercises || []) {
        if (!item.id || !item.prompt || !item.correctAnswer) throw new Error("练习题记录缺少 id、prompt 或 correctAnswer。");
        if (!Array.isArray(item.options)) item.options = [];
      }
      for (const item of incoming.reviewAttempts || []) {
        if (!item.id || !item.exerciseId || typeof item.isCorrect !== "boolean") throw new Error("作答记录缺少 id、exerciseId 或 isCorrect。");
      }
      for (const item of incoming.mistakes || []) {
        if (!item.id || !item.exerciseId || !item.fingerprint) throw new Error("错题记录缺少 id、exerciseId 或 fingerprint。");
      }
      if (incoming.dictionarySources?.length) {
        const sourceMap = new Map((state.dictionarySources || []).map(item => [item.id, item]));
        incoming.dictionarySources.forEach(item => {
          if (!item.id || !item.name) throw new Error("词典来源记录缺少 id 或 name。");
          sourceMap.set(item.id, item);
        });
        state.dictionarySources = [...sourceMap.values()];
      }
      if (incoming.words?.length) {
        const wordMap = new Map((state.words || []).map(item => [item.id, item]));
        incoming.words.forEach(item => {
          if (!item.id || !item.headword) throw new Error("单词记录缺少 id 或 headword。");
          wordMap.set(item.id, item);
        });
        state.words = [...wordMap.values()];
      }
      for (const [key, incomingRecords] of [
        ["exercises", incoming.exercises || []],
        ["reviewAttempts", incoming.reviewAttempts || []],
        ["mistakes", incoming.mistakes || []]
      ]) {
        const recordMap = new Map((state[key] || []).map(item => [item.id, item]));
        incomingRecords.forEach(item => recordMap.set(item.id, item));
        state[key] = [...recordMap.values()];
      }
      state.grammars = [...grammarMap.values()];
      state.sentences = [...sentenceMap.values()];
      if (incoming.dictionaryEntries?.length) {
        const current = new Map(dictionaryEntries.map(item => [item.id, item]));
        incoming.dictionaryEntries.forEach(item => {
          if (!item.id || !item.headword) throw new Error("词典词条缺少 id 或 headword。");
          current.set(item.id, item);
        });
        await saveDictionaryEntries([...current.values()]);
      }
      persist(); setPage(page); toast(`导入完成：${incoming.grammars.length} 条语法，${incoming.sentences.length} 条句子`);
    } catch (error) {
      console.error("导入失败", error);
      toast(`导入失败：${error.message || "文件格式不正确"}`, true);
    }
  }

  function jsonFromResponse(text) {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(cleaned);
  }

  async function analyzeSentence(sentenceId) {
    const sentence = state.sentences.find(item => item.id === sentenceId);
    if (!sentence) return;
    if (!sessionApiKey) {
      toast("请先到「设置与备份」填写本次会话的 API Key。", true);
      setPage("settings");
      return;
    }
    if (!aiConfig.model || !aiConfig.baseUrl) {
      toast("请先填写 API 地址和模型名称。", true);
      setPage("settings");
      return;
    }
    const button = root.querySelector(`[data-action="analyze-sentence"][data-id="${CSS.escape(sentenceId)}"]`);
    if (button) { button.disabled = true; button.textContent = "分析中…"; }
    const previousAnalysisStatus = sentence.analysisStatus;
    sentence.analysisStatus = "分析中";
    const sentenceNgrams = new Set();
    for (let size = 2; size <= 5; size++) {
      for (let index = 0; index <= sentence.japanese.length - size; index++) sentenceNgrams.add(sentence.japanese.slice(index, index + size));
    }
    const candidates = state.grammars.map(grammar => ({
      id: grammar.id, name: grammar.name, variants: grammar.variants, connection: grammar.connection,
      usages: grammar.usages.map(usage => ({ id: usage.id, name: usage.name, meaning: usage.meaning, explanation: usage.explanation }))
    })).map(grammar => {
      const searchable = `${grammar.name} ${grammar.variants || ""} ${grammar.connection || ""} ${grammar.usages.map(usage => `${usage.name} ${usage.meaning || ""}`).join(" ")}`.replace(/[～〜「」『』（）()「」、，,。・+\s]/g, "");
      let score = 0;
      for (let size = 2; size <= 5; size++) {
        for (let index = 0; index <= searchable.length - size; index++) {
          if (sentenceNgrams.has(searchable.slice(index, index + size))) score += size;
        }
      }
      return { grammar, score };
    }).sort((a, b) => b.score - a.score).slice(0, 50).map(item => item.grammar);
    const wordTokens = japaneseTokens(sentence.japanese);
    const wordCandidates = dictionaryEntries.filter(entry => {
      const forms = [entry.headword, ...(entry.spellings || []), ...(entry.readings || [])];
      return wordTokens.some(token => possibleDictionaryForms(token.surface).some(candidate => forms.includes(candidate))
        || forms.some(form => form && token.surface.includes(form)));
    }).slice(0, 80).map(entry => ({
      id: entry.id, headword: entry.headword, readings: entry.readings,
      spellings: entry.spellings, partOfSpeech: entry.partOfSpeech, meanings: (entry.meanings || []).slice(0, 3)
    }));
    const systemPrompt = `你是严谨的日语语法与词形分析助手。只返回一个 JSON 对象，格式：
{"instances":[{"grammarName":"语法名","grammarId":"已有ID或null","usageName":"用法名","usageId":"已有ID或null","start":0,"end":1,"text":"原句片段","judgment":"本句中的具体意义","confidence":0.9}],"wordInstances":[{"lemma":"辞書形","dictionaryEntryId":"候选词条ID或null","reading":"假名读音或空字符串","partOfSpeech":"词性或空字符串","form":"句中活用形式，如可能形","surface":"原句词语片段","start":0,"end":1,"confidence":0.9}]}
只标注有把握的语法和实词，不必给助词、标点逐字造词条。优先复用候选列表中已有 grammarId、usageId、dictionaryEntryId；不存在时 ID 设为 null，不要虚构 ID。start/end 为原文 JavaScript UTF-16 字符索引，end 不包含在范围内，必须满足原句.slice(start,end) === text 或 surface。输出置信度为 0 到 1 的数字。不要返回 Markdown。`;
    const userPrompt = JSON.stringify({ sentence: sentence.japanese, grammarCandidates: candidates, dictionaryCandidates: wordCandidates });
    try {
      const base = aiConfig.baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionApiKey}` },
        body: JSON.stringify({ model: aiConfig.model, temperature: 0.1, response_format: { type: "json_object" },
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }] })
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API 返回 ${response.status}：${body.slice(0, 260)}`);
      }
      const payload = await response.json();
      const parsed = jsonFromResponse(payload.choices?.[0]?.message?.content || "");
      if (!Array.isArray(parsed.instances)) throw new Error("AI 返回格式无效：缺少 instances 数组。");
      const newInstances = parsed.instances.map(item => {
        const grammar = grammarById(item.grammarId) || state.grammars.find(g => g.name === item.grammarName);
        const usage = grammar && (usageById(grammar, item.usageId) || grammar.usages.find(u => u.name === item.usageName));
        let start = Number(item.start), end = Number(item.end);
        const text = String(item.text || "");
        if (!Number.isInteger(start) || !Number.isInteger(end) || sentence.japanese.slice(start, end) !== text) {
          const found = text ? sentence.japanese.indexOf(text) : -1;
          start = found; end = found < 0 ? -1 : found + text.length;
        }
        if (start < 0 || end <= start || end > sentence.japanese.length || !text) return null;
        return {
          id: uid("instance"), grammarId: grammar?.id || "", usageId: usage?.id || "",
            pendingGrammarName: grammar ? undefined : String(item.grammarName || "待确认语法"),
            pendingUsageName: usage ? undefined : String(item.usageName || "待确认用法"),
          start, end, text, aiJudgment: String(item.judgment || ""), confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
          userConfirmed: false, userModified: false, origin: "AI"
        };
      }).filter(Boolean);
      const analyzedWords = Array.isArray(parsed.wordInstances) ? parsed.wordInstances.map(item => {
        const surface = String(item.surface || "");
        let start = Number(item.start), end = Number(item.end);
        if (!Number.isInteger(start) || !Number.isInteger(end) || sentence.japanese.slice(start, end) !== surface) {
          start = surface ? sentence.japanese.indexOf(surface) : -1;
          end = start < 0 ? -1 : start + surface.length;
        }
        if (!surface || start < 0 || end <= start || end > sentence.japanese.length) return null;
        const entry = dictionaryEntries.find(candidate =>
          candidate.id === item.dictionaryEntryId
          || candidate.headword === item.lemma
          || (candidate.spellings || []).includes(item.lemma));
        return {
          id: uid("word-instance"), wordId: "",
          dictionaryEntryId: entry?.id || "",
          pendingHeadword: entry ? "" : String(item.lemma || surface),
          surface, start, end, form: String(item.form || ""),
          reading: String(item.reading || ""), partOfSpeech: String(item.partOfSpeech || ""),
          confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
          userConfirmed: false, origin: "AI"
        };
      }).filter(Boolean) : [];
      sentence.analysisStatus = previousAnalysisStatus;
      openAnalysisReviewModal(sentence, newInstances, analyzedWords, parsed.instances.length);
    } catch (error) {
      sentence.analysisStatus = "分析失败";
      persist();
      console.error("AI 分析失败", error);
      toast(`AI 分析失败：${error.message || "请检查网络和接口设置"}`, true);
      renderSentences();
    }
  }

  function openAnalysisReviewModal(sentence, grammarCandidates, wordCandidates, originalGrammarCount) {
    const targetOptions = state.grammars.flatMap(grammar => grammar.usages.map(usage => ({
      value: `${grammar.id}::${usage.id}`, label: `${grammar.name} → ${usage.name}`
    })));
    const grammarRows = grammarCandidates.map((instance, index) => {
      const currentTarget = instance.grammarId && instance.usageId ? `${instance.grammarId}::${instance.usageId}` : "";
      const options = `<option value="">待确认：${esc(instance.pendingGrammarName || "新语法")} → ${esc(instance.pendingUsageName || "新用法")}</option>${targetOptions.map(option => `<option value="${esc(option.value)}"${option.value === currentTarget ? " selected" : ""}>${esc(option.label)}</option>`).join("")}`;
      return `<details class="analysis-candidate" open><summary><label><input type="checkbox" name="grammarCandidate" value="${index}" checked> 语法候选 ${index + 1}</label></summary><div class="form-grid"><div class="form-field full"><label>Grammar / Usage</label><select name="grammarTarget_${index}">${options}</select></div>${field("原句片段", `grammarText_${index}`, instance.text, { required: true })}${field("开始索引（含）", `grammarStart_${index}`, instance.start, { type: "number", required: true })}${field("结束索引（不含）", `grammarEnd_${index}`, instance.end, { type: "number", required: true })}${field("AI 判断", `grammarJudgment_${index}`, instance.aiJudgment, { full: true })}</div></details>`;
    }).join("") || `<p class="muted tiny">没有找到可定位的语法实例。</p>`;
    const wordRows = wordCandidates.map((instance, index) =>
      `<details class="analysis-candidate"><summary><label><input type="checkbox" name="wordCandidate" value="${index}" checked> 词语候选 ${esc(instance.surface)} → ${esc(instance.pendingHeadword || dictionaryEntries.find(entry => entry.id === instance.dictionaryEntryId)?.headword || "")}</label></summary><div class="form-grid">${field("原句词形", `wordSurface_${index}`, instance.surface, { required: true })}${field("原形 / 词头", `wordLemma_${index}`, instance.pendingHeadword || dictionaryEntries.find(entry => entry.id === instance.dictionaryEntryId)?.headword || instance.surface, { required: true })}${field("开始索引（含）", `wordStart_${index}`, instance.start, { type: "number", required: true })}${field("结束索引（不含）", `wordEnd_${index}`, instance.end, { type: "number", required: true })}${field("活用形式", `wordForm_${index}`, instance.form)}${field("读音", `wordReading_${index}`, instance.reading)}${field("词性", `wordPos_${index}`, instance.partOfSpeech)}</div></details>`
    ).join("") || `<p class="muted tiny">没有找到可定位的词语实例。</p>`;
    const body = `<p class="notice">AI 结果暂未写入本地。检查并调整候选、范围与词形；取消则不保存本次分析。无效范围不能确认。</p><div class="section-divider">语法实例（${grammarCandidates.length} / ${originalGrammarCount} 个有效定位）</div>${grammarRows}<div class="section-divider">词语实例（${wordCandidates.length} 个有效定位）</div>${wordRows}`;
    openModal("审核 AI 分析结果", "仅勾选并确认的关联才会保存到此句子；可以修正片段范围、语法关联与词形。", body, data => {
      const selectedGrammar = [];
      for (const index of data.getAll("grammarCandidate").map(Number)) {
        const source = grammarCandidates[index];
        const start = Number(data.get(`grammarStart_${index}`));
        const end = Number(data.get(`grammarEnd_${index}`));
        const text = String(data.get(`grammarText_${index}`) || "").trim();
        if (!source || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
          || end > sentence.japanese.length || sentence.japanese.slice(start, end) !== text) {
          toast(`语法候选 ${index + 1} 的定位范围与片段不匹配。`, true);
          return;
        }
        const [grammarId = "", usageId = ""] = String(data.get(`grammarTarget_${index}`) || "").split("::");
        const grammar = grammarById(grammarId);
        const usage = usageById(grammar, usageId);
        selectedGrammar.push({
          ...source, grammarId: usage ? grammar.id : "", usageId: usage?.id || "",
          pendingGrammarName: usage ? "" : source.pendingGrammarName || "待确认语法",
          pendingUsageName: usage ? "" : source.pendingUsageName || "待确认用法",
          start, end, text, aiJudgment: String(data.get(`grammarJudgment_${index}`) || ""),
          userModified: text !== source.text || start !== source.start || end !== source.end
            || (usage && (grammar.id !== source.grammarId || usage.id !== source.usageId))
        });
      }
      const selectedWords = [];
      for (const index of data.getAll("wordCandidate").map(Number)) {
        const source = wordCandidates[index];
        const surface = String(data.get(`wordSurface_${index}`) || "").trim();
        const start = Number(data.get(`wordStart_${index}`));
        const end = Number(data.get(`wordEnd_${index}`));
        if (!source || !surface || !Number.isInteger(start) || !Number.isInteger(end)
          || start < 0 || end <= start || end > sentence.japanese.length || sentence.japanese.slice(start, end) !== surface) {
          toast(`词语候选 ${index + 1} 的定位范围与词形不匹配。`, true);
          return;
        }
        selectedWords.push({
          ...source, surface, start, end,
          pendingHeadword: String(data.get(`wordLemma_${index}`) || "").trim(),
          form: String(data.get(`wordForm_${index}`) || "").trim(),
          reading: String(data.get(`wordReading_${index}`) || "").trim(),
          partOfSpeech: String(data.get(`wordPos_${index}`) || "").trim()
        });
      }
      sentence.instances = [
        ...sentence.instances.filter(instance => instance.userModified || instance.userConfirmed),
        ...selectedGrammar
      ];
      sentence.wordInstances = [
        ...(sentence.wordInstances || []).filter(instance => instance.userConfirmed),
        ...selectedWords
      ];
      sentence.analysisStatus = "已分析";
      persist();
      closeModal();
      renderSentences();
      toast(`已保存审核结果：${selectedGrammar.length} 个语法实例，${selectedWords.length} 个词语实例。`);
    }, "确认并保存分析");
  }

  function saveAiSettings() {
    if (hasFileAiConfig) {
      toast("API 地址、模型和长期密钥由 api-config.js 管理；编辑该文件后刷新页面即可。", true);
      return;
    }
    const baseUrl = document.getElementById("ai-base-url").value.trim();
    const model = document.getElementById("ai-model").value.trim();
    const key = document.getElementById("ai-api-key").value.trim();
    if (!baseUrl || !model) { toast("请填写 API 地址和模型名称。", true); return; }
    try { new URL(baseUrl); } catch { toast("API 地址必须是有效 URL。", true); return; }
    aiConfig = { baseUrl, model };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(aiConfig));
    if (key) sessionApiKey = key;
    toast(key ? "接口地址和模型已保存；本次会话使用临时 API Key。长期密钥请写入 api-config.js。" : "接口地址和模型已保存；长期密钥请配置 api-config.js。");
  }

  function useDeepSeekConfig() {
    document.getElementById("ai-base-url").value = "https://api.deepseek.com";
    document.getElementById("ai-model").value = "deepseek-flash";
    toast("已填写 DeepSeek API 地址和模型；长期 API Key 请配置在 api-config.js。");
  }

  async function testAiConnection() {
    const baseUrl = document.getElementById("ai-base-url").value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "");
    const model = document.getElementById("ai-model").value.trim();
    const temporaryKey = document.getElementById("ai-api-key").value.trim();
    const key = temporaryKey || sessionApiKey;
    if (!key) { toast("请填写 API Key 后测试接口。", true); return; }
    if (!baseUrl || !model) { toast("请填写 API 地址和模型名称后测试。", true); return; }
    try {
      const url = new URL(baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("API 地址必须使用 HTTP 或 HTTPS。");
    } catch (error) {
      toast(error.message || "API 地址必须是有效 URL。", true);
      return;
    }
    const button = root.querySelector('[data-action="test-ai-connection"]');
    if (button) { button.disabled = true; button.textContent = "测试中…"; }
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 32,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return only a JSON object: {\"ok\":true}." },
            { role: "user", content: "Connection test. Reply with {\"ok\":true}." }
          ]
        })
      });
      if (!response.ok) throw new Error(`服务商返回 HTTP ${response.status}。请检查模型、API Key 和账户额度。`);
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("接口已响应，但返回内容不符合 Chat Completions 格式。");
      let result;
      try { result = jsonFromResponse(content); } catch { throw new Error("接口已响应，但模型未返回有效 JSON。"); }
      if (result.ok !== true) throw new Error("接口已响应，但模型未通过 JSON 输出检查。");
      aiConfig = { baseUrl, model };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(aiConfig));
      if (temporaryKey) sessionApiKey = temporaryKey;
      toast("接口测试成功；地址与模型已保存。长期 API Key 由 api-config.js 提供。");
    } catch (error) {
      console.error("AI 接口测试失败", error);
      const detail = error instanceof TypeError
        ? "网络请求失败；请检查网络、API 地址和服务商的浏览器跨域策略。"
        : error.message;
      toast(`AI 接口测试失败：${detail}`, true);
    } finally {
      if (button?.isConnected) { button.disabled = false; button.textContent = "测试接口"; }
    }
  }

  function handleAction(action, element) {
    const id = element.dataset.id;
    if (action === "new-grammar") addGrammar();
    else if (action === "new-sentence") addSentence();
    else if (action === "translate-sentence") openSentenceTranslationModal(id);
    else if (action === "save-corpus-sentence") previewCorpusSentence(Number(element.dataset.index));
    else if (action === "load-more-corpus") {
      if (corpusPaging?.next) searchTatoebaCorpus(corpusPaging.next);
    }
    else if (action === "import-grammar-source") document.getElementById("grammar-source-file").click();
    else if (action === "fetch-japanese-language-data") fetchJapaneseLanguageData();
    else if (action === "add-word") addWord();
    else if (action === "import-dictionary") openDictionaryImport();
    else if (action === "select-dictionary-entry") {
      selectedDictionaryEntryId = id;
      renderDictionary();
    } else if (action === "toggle-wordbook-filter") {
      dictionaryFavoritesOnly = !dictionaryFavoritesOnly;
      renderDictionary();
    } else if (action === "search-mdict") {
      searchMdictDictionary();
    } else if (action === "toggle-mdict-search-all") {
      mdictSearchAll = !mdictSearchAll;
      mdictResults = [];
      mdictError = "";
      renderDictionary();
    } else if (action === "save-mdict-entry") {
      saveMdictEntryFromResult(mdictResultFromElement(element));
    } else if (action === "collect-mdict-sentence") {
      collectMdictSentenceFromResult(mdictResultFromElement(element));
    } else if (action === "reload-mdict-sources") {
      mdictSourcesLoaded = false;
      mdictError = "";
      loadMdictSources();
    } else if (action === "link-mdict-word") {
      linkMdictWordToSentence(element.dataset.headword, element.dataset.sourceId);
    } else if (action === "toggle-wordbook") {
      const entry = dictionaryEntries.find(item => item.id === id);
      if (entry) {
        saveDictionaryEntries(dictionaryEntries.map(item => item.id === id ? { ...item, isFavorite: !item.isFavorite } : item))
          .then(() => { renderDictionary(); toast(entry.isFavorite ? "已从我的词库移除" : "已加入我的词库"); })
          .catch(error => toast(`更新词库失败：${error.message}`, true));
      }
    } else if (action === "edit-word") {
      const entry = dictionaryEntries.find(item => item.id === id);
      if (entry) addWord(entry);
    } else if (action === "delete-word") {
      const entry = dictionaryEntries.find(item => item.id === id);
      if (entry && window.confirm(`删除词条「${entry.headword}」及其所有句中关联？此操作不会删除词典来源。`)) deleteDictionaryEntry(id);
    } else if (action === "lookup-word") {
      lookupWordFromSentence(element.dataset.sentenceId, Number(element.dataset.start), Number(element.dataset.end), element.dataset.surface);
    } else if (action === "link-current-word") {
      linkCurrentWord(id);
    } else if (action === "review-word-instance") {
      const sentence = state.sentences.find(item => item.id === element.dataset.sentenceId);
      const instance = sentence?.wordInstances?.find(item => item.id === element.dataset.instanceId);
      if (sentence && instance) {
        void openMdictLookup({
          sentenceId: sentence.id, start: instance.start, end: instance.end,
          surface: instance.surface, pendingHeadword: instance.pendingHeadword || ""
        }, instance.pendingHeadword || instance.surface);
      }
    } else if (action === "remove-word-instance") {
      removeWordInstance(element.dataset.sentenceId, element.dataset.instanceId);
    } else if (action === "remove-dictionary-source") {
      const source = state.dictionarySources.find(item => item.id === id);
      if (source && window.confirm(`移除「${source.name}」及其全部词条？句中对应的未确认关联也会删除。`)) removeDictionarySource(id);
    }
    else if (action === "new-usage") addUsage(element.dataset.grammarId);
    else if (action === "edit-usage") {
      const grammar = grammarById(element.dataset.grammarId);
      const usage = usageById(grammar, element.dataset.usageId);
      if (usage) addUsage(grammar.id, usage);
    } else if (action === "edit-grammar") editGrammar(id);
    else if (action === "select-grammar") { selectedGrammarId = id; renderGrammars(); }
    else if (action === "open-grammar") { selectedGrammarId = id; setPage("grammars"); }
    else if (action === "open-sentence") goToSentence(id);
    else if (action === "select-sentence") { selectedSentenceId = id; renderSentences(); }
    else if (action === "edit-sentence") editSentence(id);
    else if (action === "new-instance") addInstance(element.dataset.sentenceId);
    else if (action === "edit-instance") {
      const sentence = state.sentences.find(s => s.id === element.dataset.sentenceId);
      const instance = sentence?.instances.find(i => i.id === element.dataset.instanceId);
      if (sentence && instance) addInstance(sentence.id, instance);
    } else if (action === "delete-instance") {
      const sentence = state.sentences.find(s => s.id === element.dataset.sentenceId);
      if (sentence && window.confirm("删除这条句中语法关联？")) {
        sentence.instances = sentence.instances.filter(i => i.id !== element.dataset.instanceId);
        persist(); render(); toast("语法关联已删除");
      }
    } else if (action === "toggle-favorite") {
      const sentence = state.sentences.find(s => s.id === id);
      if (sentence) { sentence.favorite = !sentence.favorite; persist(); render(); }
    } else if (action === "delete-sentence") {
      if (window.confirm("删除这条句子及其语法关联？此操作不可撤销。")) {
        state.sentences = state.sentences.filter(s => s.id !== id);
        selectedSentenceId = state.sentences[0]?.id || "";
        persist(); render(); toast("句子已删除");
      }
    } else if (action === "delete-grammar") {
      const grammar = grammarById(id);
      if (grammar && window.confirm(`删除「${grammar.name}」及其所有用法？相关句子会保留，但对应语法关联将被删除。`)) {
        state.grammars = state.grammars.filter(g => g.id !== id);
        state.sentences.forEach(sentence => { sentence.instances = sentence.instances.filter(instance => instance.grammarId !== id); });
        selectedGrammarId = state.grammars[0]?.id || "";
        persist(); render(); toast("语法及其语法关联已删除");
      }
    } else if (action === "create-pending-grammar") {
      const sentence = state.sentences.find(item => item.id === element.dataset.sentenceId);
      const instance = sentence?.instances.find(item => item.id === element.dataset.instanceId);
      if (sentence && instance?.pendingGrammarName) {
        const existingGrammar = state.grammars.find(item => item.name === instance.pendingGrammarName);
        let grammar = existingGrammar;
        if (!grammar) {
          grammar = {
            id: uid("grammar"), name: instance.pendingGrammarName, variants: "", connection: "", type: "",
            jlpt: "未分类", educationCategory: "", schoolCategory: "", related: "", confusable: "",
            source: "AI 分析待确认", myExplanation: "", myNotes: "", createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(), usages: []
          };
          state.grammars.unshift(grammar);
        }
        const usage = grammar.usages.find(item => item.name === instance.pendingUsageName);
        if (!usage && instance.pendingUsageName) {
          const newUsage = {
            id: uid("usage"), name: instance.pendingUsageName, meaning: instance.aiJudgment || "",
            explanation: "", connection: "", conditions: "", cautions: "", confusable: "", reference: "",
            myExplanation: "", myNotes: "", officialExamples: [], userExamples: []
          };
          grammar.usages.push(newUsage);
        }
        const createdUsage = grammar.usages.find(item => item.name === instance.pendingUsageName);
        instance.grammarId = grammar.id;
        instance.usageId = createdUsage?.id || "";
        delete instance.pendingGrammarName;
        delete instance.pendingUsageName;
        instance.userModified = true;
        selectedGrammarId = grammar.id;
        persist(); render(); toast("语法已加入知识库，可继续完善用法说明。");
      }
    } else if (action === "analyze-sentence") analyzeSentence(id);
    else if (action === "filter-usage-sentences") {
      sentenceGrammarFilter = element.dataset.grammarId;
      sentenceUsageFilter = element.dataset.usageId;
      sentenceSearch = "";
      goToSentence(sentencesForUsage(element.dataset.grammarId, element.dataset.usageId)[0]?.sentence.id || "");
    } else if (action === "clear-usage-filter") {
      sentenceGrammarFilter = "";
      sentenceUsageFilter = "";
      renderSentences();
    } else if (action === "add-usage-example") {
      const grammar = grammarById(element.dataset.grammarId), usage = usageById(grammar, element.dataset.usageId);
      if (grammar && usage) addSentence({ sourceType: "自己造句" }, { grammarId: grammar.id, usageId: usage.id });
    } else if (action === "go-sentences") setPage("sentences");
    else if (action === "go-grammars") setPage("grammars");
    else if (action === "export-json") exportJson();
    else if (action === "export-csv") exportCsv();
    else if (action === "import-data") document.getElementById("import-file").click();
    else if (action === "save-ai-settings") saveAiSettings();
    else if (action === "use-deepseek") useDeepSeekConfig();
    else if (action === "test-ai-connection") testAiConnection();
    else if (action === "new-exercise") openExerciseModal();
    else if (action === "generate-exercise") generateExerciseWithAi();
    else if (action === "new-practice-sentence") createPracticeSentence();
    else if (action === "evaluate-practice-sentence") evaluatePracticeSentence();
    else if (action === "review-filter") { reviewFilter = element.dataset.filter; revealedExerciseId = ""; renderReview(); }
    else if (action === "select-exercise") { selectedExerciseId = id; revealedExerciseId = ""; renderReview(); }
    else if (action === "open-mistake") { reviewFilter = "mistakes"; selectedExerciseId = id; revealedExerciseId = ""; renderReview(); }
    else if (action === "retry-exercise") { selectedExerciseId = id; revealedExerciseId = ""; renderReview(); }
    else if (action === "edit-exercise") {
      const exercise = state.exercises.find(item => item.id === id);
      if (exercise) openExerciseModal(exercise);
    } else if (action === "delete-exercise") {
      const exercise = state.exercises.find(item => item.id === id);
      if (exercise && window.confirm("将此题从复习队列移除？作答历史会保留。")) {
        exercise.suspended = true;
        const mistake = state.mistakes.find(item => item.exerciseId === id && !item.resolvedAt);
        if (mistake) mistake.resolvedAt = new Date().toISOString();
        revealedExerciseId = "";
        persist(); renderReview(); toast("题目已从复习队列移除，历史记录已保留。");
      }
    } else if (action === "rate-exercise") {
      const exercise = state.exercises.find(item => item.id === id);
      const attempt = [...state.reviewAttempts].reverse().find(item => item.exerciseId === id);
      if (exercise && attempt) {
        scheduleExercise(exercise, attempt, element.dataset.rating);
        toast(`已调整复习间隔：${exercise.intervalDays} 天后。`);
      }
    }
    else if (action === "clear-api-key") { sessionApiKey = typeof fileAiConfig.apiKey === "string" ? fileAiConfig.apiKey.trim() : ""; const input = document.getElementById("ai-api-key"); if (input) input.value = ""; toast(sessionApiKey ? "临时 API Key 已清除；已恢复使用 api-config.js 中的配置。" : "本次会话的临时 API Key 已清除。"); }
    else if (action === "reset-data") {
      if (window.confirm("这将删除当前浏览器保存的所有语法和句子，并恢复初始示例数据。请确认已导出需要保留的内容。")) {
        state = starterState(); selectedGrammarId = state.grammars[0].id; selectedSentenceId = state.sentences[0].id;
        saveDictionaryEntries([]).then(() => { persist(); render(); toast("初始示例数据已恢复"); })
          .catch(error => toast(`恢复失败：${error.message}`, true));
      }
    } else if (action === "dismiss-modal" || action === "close-modal") closeModal();
  }

  window.addEventListener("message", event => {
    if (event.origin !== "null" || event.data?.type !== "mdict-preview-resize") return;
    const frame = [...root.querySelectorAll(".mdict-preview")]
      .find(candidate => candidate.contentWindow === event.source);
    const height = Number(event.data.height);
    if (!frame || !Number.isFinite(height) || height < 100) return;
    frame.style.height = `${Math.min(height + 16, 2400)}px`;
  });
  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-page]");
    if (nav) {
      if (nav.dataset.page !== "dictionary") pendingWordContext = null;
      setPage(nav.dataset.page);
      return;
    }
    const actionElement = event.target.closest("[data-action]");
    if (actionElement) handleAction(actionElement.dataset.action, actionElement);
  });
  document.getElementById("quick-add-sentence").addEventListener("click", () => addSentence());
  document.getElementById("import-file").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) importFile(file);
    event.target.value = "";
  });
  document.getElementById("dictionary-file").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) importDictionaryFile(file);
    event.target.value = "";
  });
  document.getElementById("grammar-source-file").addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (file) importGrammarSourceFile(file);
    event.target.value = "";
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
  });
  persist();
  render();
  loadDictionaryEntries().catch(error => {
    console.error("加载本地词典失败", error);
    dictionaryReady = false;
    toast(`本地词典无法打开：${error.message}`, true);
  });
  loadMdictSources();
})();
