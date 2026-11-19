import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importSemester, semesterFile, semestersFile, type SemesterFile, type SemesterInfo } from '../src/build-index.ts';

// 假的校方網站：總表頁＋PDF，可設定 ETag、失敗、內容
type Pdf = { text: string; etag: string; fail?: boolean };
function fakeSite(courses: Record<string, { name: string; teacher?: string }>, pdfs: Record<string, Pdf>) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const index = Object.entries(courses).map(([code, c]) =>
    `<td>科號&nbsp;Course Number：${code}</td><td>中文名稱&nbsp;Course Title：${c.name}</td>` +
    `<td>授課教師&nbsp;Instructor：${c.teacher ?? '王老師'}</td><a href='/pdf/${code}.pdf'>PDF</a>`).join('\n');
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url, headers });
    if (url.endsWith('all.htm')) return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const code = decodeURIComponent(url.split('/pdf/')[1].replace('.pdf', ''));
    const p = pdfs[code];
    if (!p || p.fail) return new Response('nope', { status: 500 });
    if (headers['If-None-Match'] === p.etag) return new Response(null, { status: 304 });
    return new Response(new TextEncoder().encode(`%PDF-1.4 ${p.text}`), { headers: { etag: p.etag } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}
const extract = async (bytes: Uint8Array) => ({ pages: 1, text: new TextDecoder().decode(bytes).replace('%PDF-1.4 ', '') });
const URL1 = 'https://school.example/11420/all.htm';
const TXT = 'https://school.example/11420/all_txt.htm';

// 假的文字檔總表：大綱全文直接在頁面上
function textSite(courses: Record<string, { name: string; text: string }>) {
  const requests: string[] = [];
  const html = Object.entries(courses).map(([code, c]) =>
    `<td>科號&nbsp;Course Number：${code}</td><td>中文名稱&nbsp;Course Title：${c.name}</td>` +
    `<tr><td>課程大綱&nbsp;Syllabus：</td></tr><tr><td>${c.text}</td></tr></table>`).join('\n');
  const fetchImpl = (async (input: string | URL) => {
    requests.push(String(input));
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe('匯入', () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), 'nss-')); });
  const read = async (id: string) => JSON.parse(await readFile(semesterFile(dataDir, id), 'utf8')) as SemesterFile;
  const list = async () => JSON.parse(await readFile(semestersFile(dataDir), 'utf8')) as SemesterInfo[];

  it('第一次匯入：下載全部 PDF，寫成該學期的資料檔與學期清單', async () => {
    const site = fakeSite({ '11420AAA 100100': { name: '人工智慧導論' }, '11420BBB 200200': { name: '電路學' } },
      { '11420AAA 100100': { text: 'AI 與永續', etag: '"a1"' }, '11420BBB 200200': { text: '電路', etag: '"b1"' } });
    const r = await importSemester({ url: URL1, dataDir, fetchImpl: site.fetchImpl, extract });
    expect([r.updated, r.unchanged, r.failed, r.removed]).toEqual([2, 0, 0, 0]);
    const f = await read('11420');
    expect(f.label).toBe('114 學年度第 2 學期');
    expect(f.docs.map(d => [d.code, d.name, d.text])).toEqual([['11420AAA 100100', '人工智慧導論', 'AI 與永續'], ['11420BBB 200200', '電路學', '電路']]);
    expect((await list()).map(s => [s.id, s.count])).toEqual([['11420', 2]]);
  });

  it('再匯入：沒變動的 PDF 以 ETag 判斷不重新下載；課名改了也會更新；總表上消失的課移除', async () => {
    const pdfs = { '11420AAA 100100': { text: 'AI', etag: '"a1"' }, '11420BBB 200200': { text: '電路', etag: '"b1"' } };
    await importSemester({ url: URL1, dataDir, fetchImpl: fakeSite({ '11420AAA 100100': { name: '舊課名' }, '11420BBB 200200': { name: '電路學' } }, pdfs).fetchImpl, extract });

    const site = fakeSite({ '11420AAA 100100': { name: '新課名' } }, pdfs);
    const r = await importSemester({ url: URL1, dataDir, fetchImpl: site.fetchImpl, extract });
    expect([r.updated, r.unchanged, r.removed]).toEqual([0, 1, 1]);
    expect(site.requests.find(q => q.url.includes('AAA'))?.headers['If-None-Match']).toBe('"a1"');
    const f = await read('11420');
    expect(f.docs.map(d => [d.name, d.text])).toEqual([['新課名', 'AI']]);
  });

  it('內容完全沒變時不重寫檔案：更新時間維持上次有變動的時間，排程才不會每週產生空的提交', async () => {
    const courses = { '11420AAA 100100': { name: '課' } };
    const pdfs = { '11420AAA 100100': { text: 'x', etag: '"a1"' } };
    await importSemester({ url: URL1, dataDir, extract, fetchImpl: fakeSite(courses, pdfs).fetchImpl, now: () => new Date('2026-01-01T00:00:00Z') });
    const r = await importSemester({ url: URL1, dataDir, extract, fetchImpl: fakeSite(courses, pdfs).fetchImpl, now: () => new Date('2026-02-01T00:00:00Z') });
    expect(r.unchanged).toBe(1);
    expect((await read('11420')).updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect((await list())[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('下載失敗：保留上次的文字讓搜尋仍可用，記下錯誤；下次不帶 ETag 整個重抓', async () => {
    const pdfs: Record<string, Pdf> = { '11420AAA 100100': { text: '舊文字', etag: '"a1"' } };
    const courses = { '11420AAA 100100': { name: '課' } };
    await importSemester({ url: URL1, dataDir, fetchImpl: fakeSite(courses, pdfs).fetchImpl, extract });

    pdfs['11420AAA 100100'] = { text: '新文字', etag: '"a2"', fail: true };
    const r = await importSemester({ url: URL1, dataDir, fetchImpl: fakeSite(courses, pdfs).fetchImpl, extract });
    expect(r.failed).toBe(1);
    expect(r.info.failures[0]).toEqual({ code: '11420AAA 100100', error: 'HTTP 500' });
    const f = await read('11420');
    expect(f.docs[0]).toMatchObject({ text: '舊文字', error: 'HTTP 500' });

    pdfs['11420AAA 100100'].fail = false;
    const site = fakeSite(courses, pdfs);
    await importSemester({ url: URL1, dataDir, fetchImpl: site.fetchImpl, extract });
    expect(site.requests.find(q => q.url.includes('AAA'))?.headers['If-None-Match']).toBeUndefined();
    expect((await read('11420')).docs[0]).toMatchObject({ text: '新文字', error: '' });
  });

  it('不同學期各存一個檔案，匯入新學期不會動到舊學期；清單新學期在前', async () => {
    await importSemester({ url: 'https://school.example/11410/all.htm', dataDir, extract,
      fetchImpl: fakeSite({ '11410AAA 100100': { name: '上學期' } }, { '11410AAA 100100': { text: 'x', etag: '"1"' } }).fetchImpl });
    await importSemester({ url: URL1, dataDir, extract,
      fetchImpl: fakeSite({ '11420AAA 100100': { name: '下學期' } }, { '11420AAA 100100': { text: 'y', etag: '"2"' } }).fetchImpl });
    expect((await list()).map(s => s.id)).toEqual(['11420', '11410']);
    expect((await read('11410')).docs[0].name).toBe('上學期');
  });

  it('同一學期的 PDF 總表與文字檔總表合併在同一個檔案；文字檔課綱不下載', async () => {
    const pdfSite = fakeSite({ '11420AAA 100100': { name: 'PDF 課' } }, { '11420AAA 100100': { text: 'pdf 內容', etag: '"a1"' } });
    await importSemester({ url: URL1, dataDir, fetchImpl: pdfSite.fetchImpl, extract });
    const txt = textSite({ '11420BBB 200200': { name: '文字課', text: '第一行<br>永續發展' } });
    const r = await importSemester({ url: TXT, dataDir, fetchImpl: txt.fetchImpl, extract });
    expect(txt.requests).toEqual([TXT]);
    expect([r.updated, r.removed]).toEqual([1, 0]);
    const f = await read('11420');
    expect(f.sources).toEqual([URL1, TXT]);
    expect(f.docs.map(d => [d.code, d.pdfUrl ? 'pdf' : 'text', d.text, d.source])).toEqual([
      ['11420AAA 100100', 'pdf', 'pdf 內容', URL1], ['11420BBB 200200', 'text', '第一行\n永續發展', TXT]]);
    expect((await list())[0]).toMatchObject({ sources: [URL1, TXT], count: 2, pdf: 1, textDocs: 1 });
  });

  it('再匯入其中一個總表，只增刪來自該總表的課，另一個總表的課不受影響', async () => {
    const pdfs = { '11420AAA 100100': { text: 'pdf', etag: '"a1"' } };
    await importSemester({ url: URL1, dataDir, fetchImpl: fakeSite({ '11420AAA 100100': { name: 'PDF 課' } }, pdfs).fetchImpl, extract });
    await importSemester({ url: TXT, dataDir, extract, fetchImpl: textSite({ '11420BBB 200200': { name: '甲', text: 'x' }, '11420CCC 300300': { name: '乙', text: 'y' } }).fetchImpl });
    const r = await importSemester({ url: TXT, dataDir, extract, fetchImpl: textSite({ '11420BBB 200200': { name: '甲', text: '改過' } }).fetchImpl });
    expect([r.updated, r.unchanged, r.removed]).toEqual([1, 0, 1]);
    expect((await read('11420')).docs.map(d => [d.code, d.text])).toEqual([['11420AAA 100100', 'pdf'], ['11420BBB 200200', '改過']]);
  });

  it('舊格式資料檔（只有 url、課綱沒有 source）可以直接沿用並轉成新格式', async () => {
    const { writeFile } = await import('node:fs/promises');
    const old = { etag: '"a1"', lastModified: '', pages: 1, error: '', code: '11420AAA 100100', name: '課', nameEn: '', teacher: '王老師', time: '', pdfUrl: 'https://school.example/pdf/11420AAA%20100100.pdf', text: 'x' };
    await writeFile(semesterFile(dataDir, '11420'), JSON.stringify({ id: '11420', label: '114 學年度第 2 學期', url: URL1, updatedAt: '2026-01-01T00:00:00.000Z', docs: [old] }));
    await writeFile(semestersFile(dataDir), JSON.stringify([{ id: '11420', label: '114 學年度第 2 學期', url: URL1, updatedAt: '2026-01-01T00:00:00.000Z', count: 1, noText: 0, failed: 0, failures: [] }]));
    const site = fakeSite({ '11420AAA 100100': { name: '課' } }, { '11420AAA 100100': { text: 'x', etag: '"a1"' } });
    const r = await importSemester({ url: URL1, dataDir, fetchImpl: site.fetchImpl, extract });
    expect([r.unchanged, r.removed]).toEqual([1, 0]);
    const f = await read('11420');
    expect(f).toMatchObject({ sources: [URL1], updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(f.docs[0].source).toBe(URL1);
    expect((await list())[0]).toMatchObject({ sources: [URL1], pdf: 1, textDocs: 0 });
  });

  it('校方網站顯示「網頁維護中」時報錯並說明原因', async () => {
    const fetchImpl = (async () => new Response('<h1>網頁維護中</h1>')) as unknown as typeof fetch;
    await expect(importSemester({ url: TXT, dataDir, fetchImpl, extract })).rejects.toThrow('網頁維護中');
  });

  it('總表上找不到任何課綱時報錯，不產生檔案', async () => {
    const fetchImpl = (async () => new Response('<p>空的</p>')) as unknown as typeof fetch;
    await expect(importSemester({ url: URL1, dataDir, fetchImpl, extract })).rejects.toThrow('找不到');
  });
});
