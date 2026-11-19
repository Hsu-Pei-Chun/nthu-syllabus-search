// 課綱關鍵字搜尋的純函式（不碰資料庫，方便測試）。
// PDF 擷取出的文字常在詞中間斷行或插入空白（例如「人工\n智慧」「人 工 智 慧」），
// 所以比對時一律忽略空白、全形半形與大小寫。

export const MAX_KEYWORDS = 10;

/** 搜尋用的正規化：全形轉半形（NFKC）、轉小寫、去掉所有空白。 */
export function compactText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 以逗號、頓號、分號或換行分隔多個關鍵字（同一個關鍵字內的空格會被忽略）。 */
export function parseKeywords(q: string): string[] {
  const out: string[] = [];
  for (const raw of q.split(/[,，、;；\n]+/)) {
    const k = raw.trim();
    if (k && compactText(k) && !out.some(o => compactText(o) === compactText(k))) out.push(k);
  }
  return out.slice(0, MAX_KEYWORDS);
}

function keywordRegex(keyword: string): RegExp {
  const compact = compactText(keyword);
  const chars = [...compact].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const body = chars.join('\\s*');
  // 純英數關鍵字（AI、ESG、IoT…）只比對完整單字：前後不可緊接英數字，
  // 否則 AI 會命中 detail、maintain、email，幾乎每份課綱都符合。緊鄰中文（生成式AI、AI倫理）仍算命中。
  return /^[a-z0-9]+$/.test(compact)
    ? new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'giu')
    : new RegExp(body, 'giu');
}

export type Segment = { text: string; hit: boolean };
export type KeywordHits = { keyword: string; count: number; snippets: Segment[][] };

const CONTEXT = 40;

/**
 * 在原文中找出關鍵字出現次數與前後文片段（每個關鍵字最多 maxSnippets 段）。
 * 片段切成 { text, hit } 陣列，交給畫面用 <mark> 標出，不必用 dangerouslySetInnerHTML。
 */
export function findHits(text: string, keyword: string, maxSnippets = 3): KeywordHits {
  // NFKC 可能改變字串長度，所以在正規化後的文字上找、也從它切片段（只用來顯示）
  const source = text.normalize('NFKC');
  const re = keywordRegex(keyword);
  const snippets: Segment[][] = [];
  let count = 0;
  let lastEnd = -1;
  for (const m of source.matchAll(re)) {
    count++;
    const start = m.index;
    const end = start + m[0].length;
    if (snippets.length >= maxSnippets || start < lastEnd) continue;
    const from = Math.max(0, start - CONTEXT);
    const to = Math.min(source.length, end + CONTEXT);
    lastEnd = to;
    const clean = (s: string) => s.replace(/\s+/g, ' ');
    snippets.push([
      { text: (from > 0 ? '…' : '') + clean(source.slice(from, start)), hit: false },
      { text: clean(m[0]), hit: true },
      { text: clean(source.slice(end, to)) + (to < source.length ? '…' : ''), hit: false },
    ]);
  }
  return { keyword, count, snippets };
}

/** tags／desc：課程 TAG 與簡述（來自另一份 Excel，載入時依科號合併；沒有時不存在） */
export type Doc = { code: string; name: string; nameEn: string; teacher: string; time: string; pdfUrl: string; text: string; tags?: string; desc?: string };
export type Result = Omit<Doc, 'text'> & { total: number; hits: KeywordHits[] };
export type Indexed = { doc: Doc; searchable: string; compact: string };

export type BriefLike = { code: string; name: string; nameEn: string; teacher: string; tags: string; desc: string };

/**
 * 把簡述／TAG 依科號併進課綱。只有簡述、沒有課綱的課也列入（pdfUrl、text 皆為空），
 * 這樣用 TAG 或簡述搜尋時也找得到。
 */
export function withBriefs(docs: Doc[], briefs: BriefLike[]): Doc[] {
  const map = new Map(briefs.map(b => [b.code, b]));
  const out: Doc[] = docs.map(d => {
    const b = map.get(d.code);
    if (!b) return d;
    map.delete(d.code);
    return { ...d, nameEn: d.nameEn || b.nameEn, teacher: d.teacher || b.teacher, tags: b.tags, desc: b.desc };
  });
  for (const b of map.values()) {
    out.push({ code: b.code, name: b.name, nameEn: b.nameEn, teacher: b.teacher, time: '', pdfUrl: '', text: '', tags: b.tags, desc: b.desc });
  }
  return out;
}

/** 預先算好每份課綱的搜尋用字串（載入資料檔後做一次） */
export function prepare(docs: Doc[]): Indexed[] {
  return docs.map(doc => {
    const searchable = [doc.code, doc.name, doc.nameEn, doc.teacher, doc.tags ?? '', doc.desc ?? '', doc.text].join('\n');
    return { doc, searchable, compact: compactText(searchable) };
  });
}

/**
 * 找出包含任一關鍵字的課綱，依命中次數多到少排序。
 * 先以去空白後的子字串初篩（快），再用 findHits 精算；英數關鍵字只算完整單字，只出現在單字中間的不列出。
 */
export function search(index: Indexed[], q: string): { keywords: string[]; results: Result[] } {
  const keywords = parseKeywords(q);
  if (keywords.length === 0) return { keywords, results: [] };
  const needles = keywords.map(compactText);
  const results: Result[] = [];
  for (const { doc, searchable, compact } of index) {
    if (!needles.some(n => compact.includes(n))) continue;
    const hits = keywords.map(k => findHits(searchable, k));
    const total = hits.reduce((n, h) => n + h.count, 0);
    if (total === 0) continue;
    const { text: _text, ...meta } = doc;
    results.push({ ...meta, total, hits });
  }
  results.sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  return { keywords, results };
}
