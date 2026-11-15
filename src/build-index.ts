// 匯入：讀校方課綱總表 → 下載 PDF 抽出文字 → 寫成 data/syllabi-<學期>.json，並更新 data/semesters.json。
// 每學期一個檔案，舊學期不會被動到；同一學期再匯入時只下載有變動的 PDF（ETag／Last-Modified）。
//
// 用法：
//   npx tsx src/build-index.ts <總表網址>      匯入（或更新）該網址的學期
//   npx tsx src/build-index.ts --refresh-latest  重新整理最新一個學期（排程用）
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeHtml, parseSyllabusIndex, type SyllabusEntry } from './parse.ts';
import { semesterLabel, semesterOf } from './semester.ts';
import type { Doc } from './search.ts';

export type StoredDoc = Doc & { etag: string; lastModified: string; pages: number; error: string };
export type SemesterFile = { id: string; label: string; url: string; updatedAt: string; docs: StoredDoc[] };
export type Failure = { code: string; error: string };
export type SemesterInfo = {
  id: string; label: string; url: string; updatedAt: string;
  count: number; noText: number; failed: number; failures: Failure[];
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

/** 先寫暫存檔再改名，避免中途失敗留下半個檔案 */
async function writeAtomic(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.tmp', content, 'utf8');
  await rename(file + '.tmp', file);
}

/** 一份課綱一行：git diff 只會顯示有變動的課，倉庫也比較小 */
export function serializeSemester(f: SemesterFile): string {
  const head = JSON.stringify({ id: f.id, label: f.label, url: f.url, updatedAt: f.updatedAt });
  return head.slice(0, -1) + ',"docs":[\n' + f.docs.map(d => JSON.stringify(d)).join(',\n') + '\n]}\n';
}

export async function importSemester(opts: Options): Promise<ImportResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const extract = opts.extract ?? extractPdfText;
  const log = opts.log ?? (() => {});
  const now = opts.now ?? (() => new Date());

  const page = await fetchImpl(opts.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), redirect: 'follow' });
  if (!page.ok) throw new Error(`總表頁讀取失敗（HTTP ${page.status}）`);
  const html = decodeHtml(new Uint8Array(await page.arrayBuffer()), page.headers.get('content-type') ?? '');
  const entries = parseSyllabusIndex(html, page.url || opts.url);
  if (entries.length === 0) throw new Error('總表頁上找不到任何課綱 PDF 連結，請確認網址是否正確');

  const id = semesterOf(entries.map(e => e.code));
  const file = semesterFile(opts.dataDir, id);
  const prevFile = await readJson<SemesterFile | null>(file, null);
  const prev = new Map((prevFile?.docs ?? []).map(d => [d.code, d]));
  log(`${semesterLabel(id)}：總表 ${entries.length} 門，已有資料 ${prev.size} 門`);

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
    return { ...entry, etag: res.headers.get('etag') ?? '', lastModified: res.headers.get('last-modified') ?? '', pages, text, error: '' };
  }

  const out = new Map<string, StoredDoc>();
  const failures: Failure[] = [];
  let updated = 0, unchanged = 0, failed = 0, done = 0, next = 0;

  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      const old = prev.get(entry.code);
      let lastError: unknown;
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const r = await fetchDoc(entry, old);
          if (r === 'not-modified') {
            // PDF 沒變，但總表上的課名、教師、時間可能改了
            out.set(entry.code, { ...old!, ...entry });
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
        if (failures.length < MAX_FAILURES_KEPT) failures.push({ code: entry.code, error });
        // 保留舊的文字讓搜尋仍可用，並記下錯誤：下次會整個重抓
        out.set(entry.code, old ? { ...old, ...entry, error } : { ...entry, etag: '', lastModified: '', pages: 0, text: '', error });
      }
      if (++done % 100 === 0 || done === entries.length) log(`  已處理 ${done} / ${entries.length}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, worker));

  const removed = [...prev.keys()].filter(c => !out.has(c)).length;
  const docs = [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
  const updatedAt = now().toISOString();
  const label = semesterLabel(id);
  await writeAtomic(file, serializeSemester({ id, label, url: opts.url, updatedAt, docs }));

  const info: SemesterInfo = {
    id, label, url: opts.url, updatedAt, count: docs.length,
    noText: docs.filter(d => !d.error && !d.text).length,
    failed: docs.filter(d => d.error).length,
    failures,
  };
  const list = (await readJson<SemesterInfo[]>(semestersFile(opts.dataDir), [])).filter(s => s.id !== id);
  list.push(info);
  list.sort((a, b) => b.id.localeCompare(a.id));
  await writeAtomic(semestersFile(opts.dataDir), JSON.stringify(list, null, 2) + '\n');

  log(`完成：新增或更新 ${updated}、未變更 ${unchanged}、失敗 ${failed}、移除 ${removed}`);
  return { info, updated, unchanged, failed, removed };
}

async function main() {
  const dataDir = path.resolve('data');
  const arg = process.argv[2]?.trim();
  let url = arg;
  if (!arg || arg === '--refresh-latest') {
    const latest = (await readJson<SemesterInfo[]>(semestersFile(dataDir), []))[0];
    if (!latest) throw new Error('還沒有任何學期的資料，請提供總表網址：npx tsx src/build-index.ts <網址>');
    url = latest.url;
  }
  if (!/^https?:\/\//i.test(url!)) throw new Error('總表網址需以 http:// 或 https:// 開頭');
  const r = await importSemester({ url: url!, dataDir, log: m => console.log(m) });
  // 失敗太多多半是網址錯了或校方網站故障，讓排程顯示失敗以便察覺（資料檔仍已寫入，保留舊文字）
  if (r.info.count > 0 && r.failed / r.info.count > 0.2) {
    console.error(`失敗比例過高（${r.failed}/${r.info.count}），請檢查網址或校方網站。`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
