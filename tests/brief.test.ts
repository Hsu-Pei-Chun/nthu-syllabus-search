import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { isXlsx, readFirstSheet } from '../src/xlsx.ts';
import { cleanBriefText, parseBriefRows } from '../src/brief.ts';
import { briefFile, importAny, importSemester, semestersFile, type BriefFile, type SemesterInfo } from '../src/build-index.ts';
import { prepare, search, withBriefs, type Doc } from '../src/search.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 做一個最小的 .xlsx：rows 內的字串一律放 sharedStrings；null 表示空儲存格（不輸出） */
function makeXlsx(rows: (string | null)[][], opts: { sheetFile?: string; extraSi?: string } = {}): Uint8Array {
  const shared: string[] = [];
  const sheetFile = opts.sheetFile ?? 'sheet1.xml';
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    if (v === null) return '';
    shared.push(v);
    return `<c r="${col(ci)}${ri + 1}" t="s"><v>${shared.length - 1}</v></c>`;
  }).join('') + '</row>').join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="簡述" sheetId="1" r:id="rId3"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(`<Relationships><Relationship Id="rId3" Type="ws" Target="worksheets/${sheetFile}"/></Relationships>`),
    'xl/sharedStrings.xml': strToU8('<sst>' + shared.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('') + (opts.extraSi ?? '') + '</sst>'),
    [`xl/worksheets/${sheetFile}`]: strToU8(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

describe('讀 Excel', () => {
  it('依 workbook 的關聯找到第一個工作表；欄位依儲存格位置排好，空格補空字串', () => {
    const x = makeXlsx([['科號', '課名'], ['11420AAA 100100', null, '溢出']], { sheetFile: 'data.xml' });
    expect(isXlsx(x)).toBe(true);
    expect(readFirstSheet(x)).toEqual([['科號', '課名'], ['11420AAA 100100', '', '溢出']]);
  });

  it('多段格式文字合併、不含拼音標註；inline 字串、數字、Excel 控制字元跳脫', () => {
    const zip = zipSync({
      'xl/sharedStrings.xml': strToU8('<sst><si><r><t>人工</t></r><r><rPr/><t>智慧</t></r><rPh><t>じんこう</t></rPh></si><si><t>文獻_x000B_註記 &amp; 其他</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>' +
        '<c r="C1" t="inlineStr"><is><t>行內</t></is></c><c r="D1"><v>3</v></c><c r="E1" s="2"/></row></sheetData></worksheet>'),
    });
    expect(readFirstSheet(zip)).toEqual([['人工智慧', '文獻\u000b註記 & 其他', '行內', '3', '']]);
  });

  it('不是 Excel 的內容不會被當成 Excel', () => {
    expect(isXlsx(new TextEncoder().encode('<html>'))).toBe(false);
  });
});

describe('簡述／TAG 解析', () => {
  it('依標題找欄位（兩種學期的欄名、順序都可），去掉 <TAG:>／<DESC:> 前綴與 <x>，保留科號補位空格', () => {
    const a = parseBriefRows([
      ['科號', '課名', '英文課名', '學分', '教師', '語言', 'TAG', '簡述'],
      ['11420FL  100100', '日文', 'Japanese', '3', '王老師', '中', '<TAG:>語言; 文化', '<DESC:>The ob&lt;x&gt;jectives  of\nthis course'],
    ]);
    expect(a).toEqual([{ code: '11420FL  100100', name: '日文', nameEn: 'Japanese', teacher: '王老師', lang: '中', tags: '語言; 文化', desc: 'The objectives of this course' }]);
    const b = parseBriefRows([
      ['科號', '中文課名', '英文課名', '學分', '教師', '語言', '課程簡述', '關鍵字'],
      ['11510AES 450100', '環境微生物學', '', '3', '李清福', '中', '<DESC:>微生物', '<TAG:>微生物生態'],
    ]);
    expect(b[0]).toMatchObject({ name: '環境微生物學', tags: '微生物生態', desc: '微生物' });
  });

  it('最後一欄溢出到無標題欄位的內容接回去；空的前綴視為沒有內容；重複與無效科號略過', () => {
    const rows = parseBriefRows([
      ['科號', '課名', '課程簡述', '關鍵字', '', ''],
      ['11510GE  167200', '課', '<DESC:>簡述', '<TAG:>智慧醫療', '醫療物聯網', '精準醫療'],
      ['11510GE  167200', '重複', '', '', '', ''],
      ['', '空白列', '', '', '', ''],
      ['260000', '壞科號', '', '', '', ''],
      ['11510AAA 100100', '沒內容', '<DESC:>', '<TAG:>', '', ''],
    ]);
    expect(rows.map(r => [r.code, r.tags, r.desc])).toEqual([['11510GE  167200', '智慧醫療, 醫療物聯網, 精準醫療', '簡述'], ['11510AAA 100100', '', '']]);
  });

  it('找不到科號欄時說明原因', () => {
    expect(() => parseBriefRows([['a', 'b']])).toThrow('科號');
  });

  it('清理文字：HTML 跳脫、控制字元、連續空白', () => {
    expect(cleanBriefText('<TAG:>文獻\u000b註記&amp;  資料\t收集')).toBe('文獻註記& 資料 收集');
  });
});

describe('簡述與課綱合併搜尋', () => {
  const docs: Doc[] = [{ code: '11420AAA 100100', name: '電路學', nameEn: '', teacher: '', time: 'M1', pdfUrl: 'x.pdf', text: '電阻與電容' }];
  const merged = withBriefs(docs, [
    { code: '11420AAA 100100', name: '電路學', nameEn: 'Circuits', teacher: '王老師', tags: '永續能源', desc: '介紹電路' },
    { code: '11420BBB 200200', name: '沒有課綱的課', nameEn: '', teacher: '李老師', tags: '永續', desc: '只有簡述' },
  ]);

  it('依科號併入 TAG、簡述，課綱沒有的英文課名與教師由簡述補上；只有簡述的課也列入', () => {
    expect(merged[0]).toMatchObject({ nameEn: 'Circuits', teacher: '王老師', tags: '永續能源', desc: '介紹電路', text: '電阻與電容' });
    expect(merged[1]).toMatchObject({ code: '11420BBB 200200', pdfUrl: '', text: '', tags: '永續' });
  });

  it('TAG 與簡述的內容也搜得到', () => {
    expect(search(prepare(merged), '永續').results.map(r => r.code)).toEqual(['11420AAA 100100', '11420BBB 200200']);
    expect(search(prepare(merged), '介紹電路').results[0].hits[0].snippets[0].map(s => s.text).join('')).toContain('介紹電路');
  });
});

describe('匯入簡述／TAG', () => {
  let dataDir: string;
  beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), 'nss-brief-')); });
  const header = ['科號', '課名', '英文課名', '學分', '教師', '語言', 'TAG', '簡述'];
  const xlsx = (rows: string[][]) => makeXlsx([header, ...rows]);
  const list = async () => JSON.parse(await readFile(semestersFile(dataDir), 'utf8')) as SemesterInfo[];
  const URL_X = 'https://school.example/11420_brief.xlsx';

  it('從網址匯入：依內容認出是 Excel，存成 briefs-<學期>.json，學期清單記下筆數與來源；門數是課綱與簡述的聯集', async () => {
    const page = '<td>科號&nbsp;Course Number：11420AAA 100100</td><tr><td>課程大綱&nbsp;Syllabus：</td></tr><tr><td>內容</td></tr></table>';
    await importSemester({ url: 'https://school.example/txt.htm', dataDir, fetchImpl: (async () => new Response(page)) as unknown as typeof fetch });
    const bytes = xlsx([['11420AAA 100100', '課', '', '3', '王', '中', '<TAG:>甲', '<DESC:>乙'], ['11420BBB 200200', '只有簡述', '', '3', '李', '中', '<TAG:>丙', '']]);
    const r = await importAny({ url: URL_X, dataDir, fetchImpl: (async () => new Response(bytes as Uint8Array<ArrayBuffer>)) as unknown as typeof fetch });
    expect(r.kind).toBe('briefs');
    const f = JSON.parse(await readFile(briefFile(dataDir, '11420'), 'utf8')) as BriefFile;
    expect(f.source).toBe(URL_X);
    expect(f.briefs.map(b => [b.code, b.tags, b.desc])).toEqual([['11420AAA 100100', '甲', '乙'], ['11420BBB 200200', '丙', '']]);
    expect((await list())[0]).toMatchObject({ id: '11420', count: 2, textDocs: 1, briefs: 2, briefSource: URL_X });
  });

  it('從本機檔案匯入：來源記成 file:檔名；學期還沒有課綱也可以', async () => {
    const file = path.join(dataDir, '11410_brief.xlsx');
    await writeFile(file, xlsx([['11410AAA 100100', '課', '', '3', '王', '中', '<TAG:>甲', '']]));
    await importAny({ url: file, dataDir });
    expect((await list())[0]).toMatchObject({ id: '11410', count: 1, pdf: 0, textDocs: 0, briefs: 1, briefSource: 'file:11410_brief.xlsx' });
  });

  it('內容沒變時不重寫（更新時間不變）；之後再匯入課綱，簡述的筆數仍保留在學期清單', async () => {
    const bytes = xlsx([['11420AAA 100100', '課', '', '3', '王', '中', '<TAG:>甲', '']]);
    const fetchImpl = (async () => new Response(bytes as Uint8Array<ArrayBuffer>)) as unknown as typeof fetch;
    await importAny({ url: URL_X, dataDir, fetchImpl, now: () => new Date('2026-01-01T00:00:00Z') });
    const r = await importAny({ url: URL_X, dataDir, fetchImpl, now: () => new Date('2026-02-01T00:00:00Z') });
    expect(r.kind === 'briefs' && r.result.unchanged).toBe(true);
    expect((JSON.parse(await readFile(briefFile(dataDir, '11420'), 'utf8')) as BriefFile).updatedAt).toBe('2026-01-01T00:00:00.000Z');

    const page = '<td>科號&nbsp;Course Number：11420CCC 300300</td><tr><td>課程大綱&nbsp;Syllabus：</td></tr><tr><td>x</td></tr></table>';
    await importSemester({ url: 'https://school.example/txt.htm', dataDir, fetchImpl: (async () => new Response(page)) as unknown as typeof fetch });
    expect((await list())[0]).toMatchObject({ count: 2, textDocs: 1, briefs: 1, briefSource: URL_X });
  });

  it('本機檔案不是 Excel 時報錯', async () => {
    const file = path.join(dataDir, 'x.htm');
    await writeFile(file, '<html></html>');
    await expect(importAny({ url: file, dataDir })).rejects.toThrow('Excel');
  });
});
