// 解析校方「全部課程大綱」總表頁（純函式，不連網，方便測試）。
// 總表頁格式：每門課一個區塊，含「科號 Course Number：…」「中文名稱 Course Title：…」等欄位，
// 以及「課程大綱 Syllabus：」欄。老師上傳課綱時可選 PDF 或文字：校方分成兩種總表頁，
//   PDF 總表：大綱欄是「觀看上傳之檔案」連結 → pdfUrl
//   文字檔總表：大綱欄直接是全文 → text（pdfUrl 為空字串）
// 若網址換成別種格式的頁面，退而求其次：抓出頁面上所有 .pdf 連結。

export type SyllabusEntry = {
  code: string;
  name: string;
  nameEn: string;
  teacher: string;
  time: string;
  /** 文字檔課綱為空字串 */
  pdfUrl: string;
  /** 只有文字檔課綱才有：大綱全文（保留換行） */
  text?: string;
};

/** 依 HTTP 標頭或 <meta charset> 決定編碼；都沒寫時先試 UTF-8，不合法再用 Big5（清大舊系統的總表是 Big5）。 */
export function decodeHtml(bytes: Uint8Array, contentType = ''): string {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
    ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.slice(0, 2048)))?.[1];
  if (declared) {
    try { return new TextDecoder(declared.toLowerCase()).decode(bytes); } catch { /* 不認得的編碼名稱，往下猜 */ }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('big5').decode(bytes);
  }
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|tr|p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

function field(text: string, label: string, keepSpaces = false): string {
  const m = new RegExp(`${label}\\s*[：:][ \\t]*([^\\n]*)`).exec(text);
  const v = (m?.[1] ?? '').trim();
  return keepSpaces ? v : v.replace(/\s+/g, ' ');
}

function pdfLinks(html: string): string[] {
  return [...html.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map(m => (m[1] ?? m[2] ?? m[3]).trim())
    .filter(h => /\.pdf(?:[?#].*)?$/i.test(h));
}

function resolver(html: string, pageUrl: string): (href: string) => string {
  const baseHref = /<base[^>]+href\s*=\s*["']?([^"'\s>]+)/i.exec(html)?.[1];
  const base = baseHref ? new URL(baseHref, pageUrl).href : pageUrl;
  return (href) => new URL(href.replace(/&amp;/g, '&'), base).href;
}

/** 文字檔課綱整理：每行去頭尾空白、行內連續空白收成一個、空行最多一行 */
function tidy(text: string): string {
  return text.split('\n').map(l => l.replace(/[ \t　 ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function parseSyllabusIndex(html: string, pageUrl: string): SyllabusEntry[] {
  const resolve = resolver(html, pageUrl);
  const seen = new Set<string>();
  const out: SyllabusEntry[] = [];
  const push = (e: SyllabusEntry) => {
    if (!e.code || seen.has(e.code)) return;
    seen.add(e.code);
    out.push(e);
  };

  // 以「Course Number」切出每門課的區塊（區塊內才有該課的 PDF 連結）
  const blocks = html.split(/(?=科號(?:&nbsp;|\s)*Course Number)/i).slice(1);
  for (const block of blocks) {
    // 「課程大綱 Syllabus：」之後是大綱欄；之前是課程資料
    const [head, syllabus] = block.split(/課程大綱(?:&nbsp;|\s)*Syllabus\s*[：:]/i, 2) as [string, string | undefined];
    const text = htmlToText(head);
    const meta = {
      code: field(text, 'Course Number', true), // 科號內的空格是補位，需原樣保留（與課程管理的科號一致）
      name: field(text, 'Course Title'),
      nameEn: field(text, 'Course English Title'),
      teacher: field(text, 'Instructor'),
      time: field(text, 'Time'),
    };
    if (syllabus !== undefined) {
      // 大綱欄只有「觀看上傳之檔案」連結的是 PDF 課綱；其他是老師直接填的文字（文字裡可能也有連結）
      const uploaded = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>\s*觀看上傳之檔案/i.exec(syllabus);
      if (uploaded) { push({ ...meta, pdfUrl: resolve((uploaded[1] ?? uploaded[2] ?? uploaded[3]).trim()) }); continue; }
      const body = tidy(htmlToText(syllabus.replace(/<\/table>[\s\S]*$/i, '')));
      push({ ...meta, pdfUrl: '', text: body });
      continue;
    }
    const link = pdfLinks(block)[0];
    if (link) push({ ...meta, pdfUrl: resolve(link) });
  }
  if (out.length > 0) return out;

  // 其他格式：只有 PDF 連結，用檔名當作科號
  for (const link of pdfLinks(html)) {
    const pdfUrl = resolve(link);
    const file = decodeURIComponent(new URL(pdfUrl).pathname.split('/').pop() ?? '').replace(/\.pdf$/i, '');
    push({ code: file || pdfUrl, name: '', nameEn: '', teacher: '', time: '', pdfUrl });
  }
  return out;
}
