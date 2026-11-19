// 匯入：讀校方課綱總表 → 下載 PDF 抽出文字（文字檔課綱直接取用）→ 寫成 data/syllabi-<學期>.json，並更新 data/semesters.json。
// 每學期一個檔案，舊學期不會被動到。同一學期可以有多個總表（PDF 總表、文字檔總表），各自匯入後合併在同一個檔案；
// 再匯入某個總表只會更動來自該總表的課綱，PDF 只下載有變動的（ETag／Last-Modified）。
//
// 用法：
//   npx tsx src/build-index.ts <總表網址> [<總表網址> …]   匯入（或更新）這些總表（可一次給 PDF 與文字檔兩個）
//   npx tsx src/build-index.ts --refresh-latest            重新整理最新一個學期的所有總表（排程用）
//
// 課程簡述＋TAG 的 Excel（.xlsx）也用同一個指令匯入：給 Excel 網址或本機檔案路徑皆可，
// 存成 data/briefs-<學期>.json（每學期一份，再匯入會整份取代），小工具載入時依科號與課綱合併。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeHtml, parseSyllabusIndex, type SyllabusEntry } from './parse.ts';
import { semesterLabel, semesterOf } from './semester.ts';
import type { Doc } from './search.ts';
import { isXlsx, readFirstSheet } from './xlsx.ts';
import { parseBriefRows, type Brief } from './brief.ts';

/** source：這份課綱來自哪個總表網址；pdfUrl 為空字串表示文字檔課綱 */
export type StoredDoc = Doc & { source: string; etag: string; lastModified: string; pages: number; error: string };
export type SemesterFile = { id: string; label: string; sources: string[]; updatedAt: string; docs: StoredDoc[] };
export type BriefFile = { id: string; source: string; updatedAt: string; briefs: Brief[] };
export type Failure = { code: string; error: string };
export type SemesterInfo = {
  id: string; label: string; sources: string[]; updatedAt: string;
  /** count：課綱或簡述任一有的課程數（科號聯集） */
  count: number; pdf: number; textDocs: number;
  /** 簡述／TAG：筆數與來源（網址，或本機上傳的檔名 file:xxx.xlsx）；沒有時為 0 與空字串 */
  briefs: number; briefSource: string;
  noText: number; failed: number; failures: Failure[];
};
export type ImportResult = { info: SemesterInfo; updated: number; unchanged: number; failed: number; removed: number };

type Extract = (bytes: Uint8Array) => Promise<{ pages: number; text: string }>;
type Options = {
  url: string;
  dataDir: string;
  fetchImpl?: typeof fetch;
  extract?: Extract;
  concurrency?: number;
  now?: () => Date;
  log?: (msg: string) => void;
};

const UA = 'Mozilla/5.0 (compatible; nthu-syllabus-search importer)';
const PAGE_TIMEOUT_MS = 60_000;
const PDF_TIMEOUT_MS = 45_000;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_FAILURES_KEPT = 50;

// 注意：package.json 必須保留 pdfjs-dist。unpdf 偵測到它就改用完整版 pdf.js 與其附帶的 CMap／字型資料；
// 少了它，部分課綱的中文字型無法轉成文字，中文整段消失（見 tests/extract.test.ts）。
export async function extractPdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    // 空白一律收成一個，資料檔小很多；搜尋本來就忽略空白
    return { pages: totalPages, text: text.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim() };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export const semesterFile = (dataDir: string, id: string) => path.join(dataDir, `syllabi-${id}.json`);
export const semestersFile = (dataDir: string) => path.join(dataDir, 'semesters.json');

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return fallback; }
}

/** 舊版資料檔只有一個 url、課綱沒有 source：補成新格式 */
type LegacyFile = Omit<SemesterFile, 'sources' | 'docs'> & { url?: string; sources?: string[]; docs: (Omit<StoredDoc, 'source'> & { source?: string })[] };
async function readSemester(file: string): Promise<SemesterFile | null> {
  const f = await readJson<LegacyFile | null>(file, null);
  if (!f) return null;
  const { url, ...rest } = f;
  const sources = f.sources ?? (url ? [url] : []);
  return { ...rest, sources, docs: f.docs.map(d => ({ ...d, source: d.source ?? url ?? '' })) };
}
type LegacyInfo = Partial<SemesterInfo> & { id: string; url?: string };
async function readSemesters(dataDir: string): Promise<LegacyInfo[]> {
  return readJson<LegacyInfo[]>(semestersFile(dataDir), []);
}
export const sourcesOf = (s: LegacyInfo) => s.sources ?? (s.url ? [s.url] : []);

/** 先寫暫存檔再改名，避免中途失敗留下半個檔案 */
async function writeAtomic(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.tmp', content, 'utf8');
  await rename(file + '.tmp', file);
}

/** 一份課綱一行：git diff 只會顯示有變動的課，倉庫也比較小 */
export function serializeSemester(f: SemesterFile): string {
  const head = JSON.stringify({ id: f.id, label: f.label, sources: f.sources, updatedAt: f.updatedAt });
  return head.slice(0, -1) + ',"docs":[\n' + f.docs.map(d => JSON.stringify(d)).join(',\n') + '\n]}\n';
}

export const briefFile = (dataDir: string, id: string) => path.join(dataDir, `briefs-${id}.json`);

export function serializeBriefs(f: BriefFile): string {
  const head = JSON.stringify({ id: f.id, source: f.source, updatedAt: f.updatedAt });
  return head.slice(0, -1) + ',"briefs":[\n' + f.briefs.map(b => JSON.stringify(b)).join(',\n') + '\n]}\n';
}

export function summarize(f: SemesterFile, b: BriefFile | null = null): SemesterInfo {
  const textDocs = f.docs.filter(d => !d.pdfUrl).length;
  const errors = f.docs.filter(d => d.error);
  const codes = new Set([...f.docs.map(d => d.code), ...(b?.briefs ?? []).map(x => x.code)]);
  return {
    id: f.id, label: f.label, sources: f.sources,
    updatedAt: b && b.updatedAt > f.updatedAt ? b.updatedAt : f.updatedAt,
    count: codes.size, pdf: f.docs.length - textDocs, textDocs,
    briefs: b?.briefs.length ?? 0, briefSource: b?.source ?? '',
    noText: f.docs.filter(d => !d.error && !d.text).length,
    failed: errors.length,
    failures: errors.slice(0, MAX_FAILURES_KEPT).map(d => ({ code: d.code, error: d.error })),
  };
}

/** 重新計算某學期在 semesters.json 的那一筆（課綱或簡述任一更新後呼叫） */
async function writeInfo(dataDir: string, id: string): Promise<SemesterInfo> {
  const sem = (await readSemester(semesterFile(dataDir, id)))
    ?? { id, label: semesterLabel(id), sources: [], updatedAt: '', docs: [] };
  const info = summarize(sem, await readJson<BriefFile | null>(briefFile(dataDir, id), null));
  const list = (await readSemesters(dataDir)).filter(s => s.id !== id);
  list.push(info);
  list.sort((a, b) => b.id.localeCompare(a.id));
  await writeAtomic(semestersFile(dataDir), JSON.stringify(list, null, 2) + '\n');
  return info;
}

/** 讀網址或本機檔（本機檔只用於上傳的 Excel）；回傳內容與記錄用的來源名稱 */
async function load(url: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string; source: string }> {
  if (!/^https?:\/\//i.test(url)) {
    const bytes = new Uint8Array(await readFile(url));
    return { bytes, contentType: '', finalUrl: url, source: `file:${path.basename(url)}` };
  }
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`讀取失敗（HTTP ${res.status}）`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '', finalUrl: res.url || url, source: url };
}

export type BriefResult = { info: SemesterInfo; count: number; matched: number; unchanged: boolean };

export async function importBriefs(bytes: Uint8Array, source: string, opts: Pick<Options, 'dataDir' | 'now' | 'log'>): Promise<BriefResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const briefs = parseBriefRows(readFirstSheet(bytes)).sort((a, b) => a.code.localeCompare(b.code));
  if (briefs.length === 0) throw new Error('Excel 裡沒有任何課程');
  const id = semesterOf(briefs.map(b => b.code));
  const file = briefFile(opts.dataDir, id);
  const prev = await readJson<BriefFile | null>(file, null);
  const sem = await readSemester(semesterFile(opts.dataDir, id));
  const have = new Set((sem?.docs ?? []).map(d => d.code));
  const matched = briefs.filter(b => have.has(b.code)).length;
  log(`${semesterLabel(id)}：簡述／TAG ${briefs.length} 門，其中 ${matched} 門有課綱`);

  const unchanged = prev !== null && prev.source === source && JSON.stringify(prev.briefs) === JSON.stringify(briefs);
  if (!unchanged) await writeAtomic(file, serializeBriefs({ id, source, updatedAt: now().toISOString(), briefs }));
  const info = await writeInfo(opts.dataDir, id);
  log(unchanged ? '完成：簡述／TAG 沒有變動' : `完成：簡述／TAG 已更新（${briefs.length} 門）`);
  return { info, count: briefs.length, matched, unchanged };
}

/** 依內容自動分辨：Excel → 簡述／TAG；HTML → 課綱總表 */
export async function importAny(opts: Options): Promise<{ kind: 'briefs'; result: BriefResult } | { kind: 'syllabi'; result: ImportResult }> {
  const loaded = await load(opts.url, opts.fetchImpl ?? fetch);
  if (isXlsx(loaded.bytes)) return { kind: 'briefs', result: await importBriefs(loaded.bytes, loaded.source, opts) };
  if (!/^https?:\/\//i.test(opts.url)) throw new Error('本機檔案只支援簡述／TAG 的 Excel（.xlsx）');
  return { kind: 'syllabi', result: await importSemester(opts, loaded) };
}

export async function importSemester(opts: Options, loaded?: Awaited<ReturnType<typeof load>>): Promise<ImportResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const extract = opts.extract ?? extractPdfText;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());
  const source = opts.url;

  let page: Awaited<ReturnType<typeof load>>;
  try { page = loaded ?? await load(source, fetchImpl); } catch (e) {
    throw new Error(`總表頁${e instanceof Error ? e.message : e}`);
  }
  const html = decodeHtml(page.bytes, page.contentType);
  const entries = parseSyllabusIndex(html, page.finalUrl);
  if (entries.length === 0) {
    const hint = /維護中/.test(html) ? '（校方網站顯示「網頁維護中」，請稍後再試）' : '，請確認網址是否正確';
    throw new Error(`總表頁上找不到任何課綱${hint}`);
  }

  const id = semesterOf(entries.map(e => e.code));
  const file = semesterFile(opts.dataDir, id);
  const prevFile = await readSemester(file);
  const prevDocs = prevFile?.docs ?? [];
  const prev = new Map(prevDocs.map(d => [d.code, d]));
  const textCount = entries.filter(e => e.text !== undefined).length;
  log(`${semesterLabel(id)}：總表 ${entries.length} 門（PDF ${entries.length - textCount}、文字檔 ${textCount}），此學期已有資料 ${prev.size} 門`);

  async function fetchDoc(entry: SyllabusEntry, old: StoredDoc | undefined): Promise<StoredDoc | 'not-modified'> {
    const headers: Record<string, string> = { 'User-Agent': UA };
    // 只有上次成功、且網址相同時才用條件式請求；上次失敗的整個重抓
    if (old && old.pdfUrl === entry.pdfUrl && !old.error) {
      if (old.etag) headers['If-None-Match'] = old.etag;
      if (old.lastModified) headers['If-Modified-Since'] = old.lastModified;
    }
    const res = await fetchImpl(entry.pdfUrl, { headers, signal: AbortSignal.timeout(PDF_TIMEOUT_MS), redirect: 'follow' });
    if (res.status === 304) return 'not-modified';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_PDF_BYTES) throw new Error('檔案過大');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('檔案過大');
    if (new TextDecoder('latin1').decode(bytes.slice(0, 1024)).indexOf('%PDF') < 0) throw new Error('不是 PDF 檔');
    const { pages, text } = await extract(bytes);
    return { ...entry, source, etag: res.headers.get('etag') ?? '', lastModified: res.headers.get('last-modified') ?? '', pages, text, error: '' };
  }

  const out = new Map<string, StoredDoc>();
  let updated = 0, unchanged = 0, failed = 0, done = 0, next = 0;

  // 文字檔課綱：全文就在總表頁上，不必另外下載
  const pdfEntries: SyllabusEntry[] = [];
  for (const entry of entries) {
    if (entry.text === undefined) { pdfEntries.push(entry); continue; }
    const doc: StoredDoc = { ...entry, text: entry.text, pdfUrl: '', source, etag: '', lastModified: '', pages: 0, error: '' };
    const old = prev.get(entry.code);
    if (old && JSON.stringify(old) === JSON.stringify(doc)) unchanged++; else updated++;
    out.set(entry.code, doc);
  }

  const worker = async () => {
    while (next < pdfEntries.length) {
      const entry = pdfEntries[next++];
      const old = prev.get(entry.code);
      let lastError: unknown;
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const r = await fetchDoc(entry, old);
          if (r === 'not-modified') {
            // PDF 沒變，但總表上的課名、教師、時間可能改了
            out.set(entry.code, { ...old!, ...entry, source });
            unchanged++;
          } else {
            out.set(entry.code, r);
            updated++;
          }
          ok = true;
        } catch (e) { lastError = e; }
      }
      if (!ok) {
        const error = lastError instanceof Error ? lastError.message : String(lastError);
        failed++;
        // 保留舊的文字讓搜尋仍可用，並記下錯誤：下次會整個重抓
        out.set(entry.code, old && old.pdfUrl
          ? { ...old, ...entry, source, error }
          : { ...entry, text: '', source, etag: '', lastModified: '', pages: 0, error });
      }
      if (++done % 100 === 0 || done === pdfEntries.length) log(`  PDF 已處理 ${done} / ${pdfEntries.length}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, worker));

  // 來自這個總表、但總表上已經沒有的課 → 移除；其他總表的課原樣保留
  const removed = prevDocs.filter(d => d.source === source && !out.has(d.code)).length;
  for (const d of prevDocs) if (d.source !== source && !out.has(d.code)) out.set(d.code, d);
  const docs = [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
  const sources = [...new Set([...(prevFile?.sources ?? []), source])];
  const label = semesterLabel(id);
  const prevInfo = (await readSemesters(opts.dataDir)).find(s => s.id === id);

  // 內容完全沒變就不重寫：更新時間代表「課綱上次有變動」，排程也不會每週產生空的提交
  const sameDocs = prevFile !== null && prevFile.sources.includes(source) && JSON.stringify(prevFile.docs) === JSON.stringify(docs);
  if (sameDocs && prevInfo?.sources && prevInfo.briefSource !== undefined) {
    log(`完成：沒有任何變動（未變更 ${unchanged}、失敗 ${failed}），資料檔維持不變`);
    return { info: prevInfo as SemesterInfo, updated, unchanged, failed, removed };
  }

  const semester: SemesterFile = { id, label, sources, updatedAt: (sameDocs ? prevFile!.updatedAt : now().toISOString()), docs };
  await writeAtomic(file, serializeSemester(semester));
  const info = await writeInfo(opts.dataDir, id);

  log(`完成：新增或更新 ${updated}、未變更 ${unchanged}、失敗 ${failed}、移除 ${removed}；此學期共 ${info.count} 門（PDF ${info.pdf}、文字檔 ${info.textDocs}）`);
  return { info, updated, unchanged, failed, removed };
}

async function main() {
  const dataDir = path.resolve('data');
  // 網址可以用空白、換行或逗號分隔（GitHub Actions 的輸入框只有一行）
  // （本機檔案路徑可能含空白，只拆以 http 開頭的參數）
  let urls = process.argv.slice(2).flatMap(a => (/^\s*https?:/i.test(a) ? a.split(/[\s,，]+/) : [a.trim()])).filter(Boolean);
  if (urls.length === 0 || (urls.length === 1 && urls[0] === '--refresh-latest')) {
    const latest = (await readSemesters(dataDir))[0];
    if (!latest) throw new Error('還沒有任何學期的資料，請提供總表網址：npx tsx src/build-index.ts <網址>');
    // 本機上傳的簡述檔（file:…）沒辦法重新下載，略過
    urls = [...sourcesOf(latest), latest.briefSource ?? ''].filter(u => /^https?:\/\//i.test(u));
  }

  // 每個來源各自匯入：其中一個失敗不影響其他的，但最後讓排程顯示失敗以便察覺
  for (const url of urls) {
    console.log(`\n== ${url}`);
    try {
      const any = await importAny({ url, dataDir, log: m => console.log(m) });
      if (any.kind === 'briefs') continue;
      const r = any.result;
      const pdfInRun = r.updated + r.unchanged + r.failed;
      // 失敗太多多半是校方網站故障（資料檔仍已寫入，保留舊文字）
      if (pdfInRun > 0 && r.failed / pdfInRun > 0.2) {
        console.error(`失敗比例過高（${r.failed}/${pdfInRun}），請檢查網址或校方網站。`);
        process.exitCode = 1;
      }
    } catch (e) {
      console.error(`匯入失敗：${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
