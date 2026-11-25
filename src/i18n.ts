// 介面文字（繁體中文為預設，另有英文）。課綱全文、簡述、TAG 等資料只有中文版本，不翻譯；
// 課名在英文模式改用資料裡的英文課名（沒有時退回中文課名）。

export type Lang = 'zh' | 'en';
export const LANGS: Lang[] = ['zh', 'en'];
export const STORAGE_KEY = 'nthu-syllabus-search:lang';

const zh = {
  htmlLang: 'zh-Hant',
  switchTo: 'English', // 切換按鈕上顯示「要切換到的語言」
  switchLabel: 'Switch to English',
  semester: '學期',
  keyword: '關鍵字',
  placeholder: '例：人工智慧、永續、機器學習',
  search: '搜尋',
  hint: '搜尋課綱（PDF、文字檔）與課程簡述、TAG。多個關鍵字用逗號或頓號分隔，符合任一個就會列出；不分大小寫、會忽略斷行與空白。英文縮寫（如 AI）只比對完整單字。',
  semesterOption: (label: string, n: number) => `${label}（${n} 門）`,
  loadingList: '載入學期清單中…',
  listFailed: (err: string) => `學期清單載入失敗（${err}），請稍後再試。`,
  noData: '目前還沒有課綱資料。',
  loadingSemester: (label: string) => `載入${label}課綱資料中…`,
  semesterFailed: (err: string) => `課綱資料載入失敗（${err}），請稍後再試。`,
  idle: (label: string, n: number, updated: string) => `${label}：共 ${n} 份課綱（資料更新：${updated}）。輸入關鍵字開始搜尋。`,
  found: (label: string, n: number) => `${label}：共 ${n} 門課程符合`,
  none: (label: string) => `${label}：沒有課綱包含這些關鍵字。`,
  more: (n: number) => `顯示更多（還有 ${n} 門）`,
  openPdf: '開啟 PDF',
  textSyllabus: '文字檔課綱',
  noSyllabus: '尚無課綱',
  hitCount: (k: string, n: number) => `${k} · ${n} 處`,
  moreSnippets: (n: number) => `再顯示 ${n} 段`,
  fullText: '查看完整課綱',
  desc: '簡述',
  expandDesc: '展開簡述',
  collapseDesc: '收合簡述',
  dataNote: '',
};

export type Messages = typeof zh;

const en: Messages = {
  htmlLang: 'en',
  switchTo: '中文',
  switchLabel: '切換為中文',
  semester: 'Semester',
  keyword: 'Keywords',
  placeholder: 'e.g. 人工智慧, sustainability, machine learning',
  search: 'Search',
  hint: 'Searches syllabi (PDF and text) plus course descriptions and tags. Separate keywords with commas; courses matching any keyword are listed. Case, line breaks and spaces are ignored. Abbreviations such as AI match whole words only.',
  semesterOption: (label, n) => `${label} (${n} ${n === 1 ? 'course' : 'courses'})`,
  loadingList: 'Loading semesters…',
  listFailed: err => `Could not load the semester list (${err}). Please try again later.`,
  noData: 'No syllabus data yet.',
  loadingSemester: label => `Loading ${label} syllabi…`,
  semesterFailed: err => `Could not load syllabus data (${err}). Please try again later.`,
  idle: (label, n, updated) => `${label}: ${n} syllabi (updated ${updated}). Enter keywords to search.`,
  found: (label, n) => `${label}: ${n} ${n === 1 ? 'course matches' : 'courses match'}`,
  none: label => `${label}: no syllabus contains these keywords.`,
  more: n => `Show more (${n} left)`,
  openPdf: 'Open PDF',
  textSyllabus: 'Text syllabus',
  noSyllabus: 'No syllabus yet',
  hitCount: (k, n) => `${k} · ${n} ${n === 1 ? 'match' : 'matches'}`,
  moreSnippets: n => `Show ${n} more`,
  fullText: 'View full syllabus',
  desc: 'Description',
  expandDesc: 'Show full description',
  collapseDesc: 'Show less',
  dataNote: 'Most syllabi, descriptions and tags are provided by instructors in Chinese only, so search with Chinese keywords for the best results.',
};

export const MESSAGES: Record<Lang, Messages> = { zh, en };

export function isLang(v: unknown): v is Lang {
  return v === 'zh' || v === 'en';
}

/** 讀取記住的語言。localStorage 可能被封鎖（無痕模式、CMS 的 iframe 沙箱），失敗時當作沒有記錄。 */
export function loadLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch { return null; }
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* 無法儲存時只影響下次開啟的預設語言 */ }
}
