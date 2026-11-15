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

  it('總表上找不到任何課綱時報錯，不產生檔案', async () => {
    const fetchImpl = (async () => new Response('<p>空的</p>')) as unknown as typeof fetch;
    await expect(importSemester({ url: URL1, dataDir, fetchImpl, extract })).rejects.toThrow('找不到');
  });
});
