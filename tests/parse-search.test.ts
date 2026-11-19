import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodeHtml, parseSyllabusIndex } from '../src/parse.ts';
import { compactText, findHits, parseKeywords, prepare, search, type Doc } from '../src/search.ts';
import { semesterLabel, semesterOf } from '../src/semester.ts';

const PAGE_URL = 'https://curricul.site.nthu.edu.tw/var/file/208/1208/img/4645/11510all_syllabus_pdf.htm';

describe('課綱總表解析', () => {
  const bytes = new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures/syllabus-index-big5.htm')));

  it('沒有宣告編碼的 Big5 頁面能正確解碼', () => {
    const html = decodeHtml(bytes);
    expect(html).toContain('環境微生物學');
    expect(html).not.toContain('�');
  });

  it('UTF-8 頁面照 UTF-8 解碼', () => {
    expect(decodeHtml(new TextEncoder().encode('<p>課綱</p>'))).toBe('<p>課綱</p>');
  });

  it('解析出每門課的科號、課名、教師、時間與 PDF 絕對網址（依 <base href> 解析、空格編碼）', () => {
    const entries = parseSyllabusIndex(decodeHtml(bytes), PAGE_URL);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      code: '11510AES 450100', name: '環境微生物學', nameEn: 'Environmental Microbiology',
      teacher: '李清福', time: 'W2W3W4',
      pdfUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/output/6_6.1_6.1.12/11510AES%20450100.pdf',
    });
  });

  it('科號內連續的補位空格要原樣保留', () => {
    const html = `<td>科號&nbsp;Course Number：11510FL  404701</td><td>中文名稱&nbsp;Course Title：高級日語一</td>
      <a href='/x/11510FL  404701.pdf'>Syllabus</a>`;
    expect(parseSyllabusIndex(html, 'https://a.example/list.htm')[0].code).toBe('11510FL  404701');
  });

  it('同一科號重複出現只取第一筆；沒有 PDF 連結的課略過', () => {
    const block = (code: string, link: string) => `<td>科號&nbsp;Course Number：${code}</td>${link}`;
    const html = block('A', "<a href='a.pdf'>x</a>") + block('A', "<a href='a2.pdf'>x</a>") + block('B', '');
    const entries = parseSyllabusIndex(html, 'https://a.example/dir/list.htm');
    expect(entries.map(e => [e.code, e.pdfUrl])).toEqual([['A', 'https://a.example/dir/a.pdf']]);
  });

  it('別種格式的頁面：抓出所有 PDF 連結，以檔名當科號', () => {
    const html = '<a href="files/EE%20101.pdf">EE</a> <a href="https://b.example/c.PDF?v=2">C</a> <a href="x.doc">no</a>';
    const entries = parseSyllabusIndex(html, 'https://a.example/list.htm');
    expect(entries.map(e => e.code)).toEqual(['EE 101', 'c']);
    expect(entries[0].pdfUrl).toBe('https://a.example/files/EE%20101.pdf');
  });
});

describe('文字檔課綱總表', () => {
  const html = decodeHtml(new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures/syllabus-index-text-big5.htm'))));
  const entries = parseSyllabusIndex(html, 'https://curricul.site.nthu.edu.tw/var/file/208/1208/img/4645/11420_all_syllabus_txt.htm');

  it('每門課取出課程資料與大綱全文，沒有 PDF 網址', () => {
    expect(entries.map(e => e.code)).toEqual(['11420AES 470100', '11420AES 510000', '11420AES 510100', '11420AES 511100']);
    expect(entries[0]).toMatchObject({ name: '環境科學與工程', nameEn: 'Environmental Science and Engineering', teacher: '吳劍侯', time: 'R7R8R9', pdfUrl: '' });
    expect(entries[2].text).toContain('由教授與學生擬定研究題目');
  });

  it('全文保留換行、去掉校方插入的 <x> 標籤，不含下一門課的資料', () => {
    const t = entries[0].text!;
    expect(t.startsWith('一、課程說明(Course Description)\nThe objectives of this course')).toBe(true);
    expect(t).toContain('Masten, S. J. and Davis, M. L.');
    expect(t).not.toMatch(/<|Course Number|專題演講/);
    expect(t).not.toMatch(/\n{3}/);
  });

  it('PDF 總表的「觀看上傳之檔案」仍判斷為 PDF 課綱', () => {
    const pdf = parseSyllabusIndex(decodeHtml(new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures/syllabus-index-big5.htm')))), PAGE_URL);
    expect(pdf.every(e => e.pdfUrl && e.text === undefined)).toBe(true);
  });

  it('文字課綱裡老師自己放的 PDF 連結不會讓它被當成 PDF 課綱', () => {
    const block = `<td>科號&nbsp;Course Number：11420EE  100100</td><tr><td>課程大綱&nbsp;Syllabus：</td></tr>
      <tr><td>參考資料 <a href="https://x.example/ref.pdf">講義</a><br>第二行</td></tr></table></div><div>footer</div>`;
    expect(parseSyllabusIndex(block, 'https://a.example/')[0]).toMatchObject({ pdfUrl: '', text: '參考資料 講義\n第二行' });
  });
});

describe('學期', () => {
  it('從科號前 5 碼判斷學期（取最多數）並產生中文名稱', () => {
    expect(semesterOf(['11420AES 520500', '11420CS  101000', 'X'])).toBe('11420');
    expect(semesterLabel('11420')).toBe('114 學年度第 2 學期');
    expect(semesterLabel('11410')).toBe('114 學年度第 1 學期');
    expect(semesterLabel('11430')).toBe('114 學年度暑期');
    expect(() => semesterOf(['EE 101'])).toThrow();
  });
});

describe('關鍵字比對', () => {
  it('以逗號、頓號、換行分隔多個關鍵字，去除重複與空白', () => {
    expect(parseKeywords(' 人工智慧、AI ,ai，\n 永續 ')).toEqual(['人工智慧', 'AI', '永續']);
    expect(parseKeywords('  ')).toEqual([]);
  });

  it('忽略 PDF 文字中的斷行、空白、全形與大小寫', () => {
    const text = '本課程介紹人工\n智慧與 Ｍachine  Learning，人 工 智 慧 的應用。';
    expect(findHits(text, '人工智慧').count).toBe(2);
    expect(findHits(text, 'machine learning').count).toBe(1);
    expect(compactText('Ｍachine  Learning')).toBe('machinelearning');
  });

  it('英數關鍵字只比對完整單字：AI 不會命中 detail、maintain；緊鄰中文仍算命中', () => {
    const text = 'Course detail: maintain email. 本課介紹 AI 應用、AI倫理與生成式AI，以及 OpenAI 的 API。';
    expect(findHits(text, 'AI').count).toBe(3);
    expect(findHits('Internet of Things (IoT) 與 idiot', 'IoT').count).toBe(1);
  });

  it('片段標出命中文字並帶前後文', () => {
    const { snippets } = findHits('前文'.repeat(30) + '永續發展' + '後文'.repeat(30), '永續');
    expect(snippets).toHaveLength(1);
    expect(snippets[0][1]).toEqual({ text: '永續', hit: true });
    expect(snippets[0][0].text.startsWith('…')).toBe(true);
    expect(snippets[0][2].text.endsWith('…')).toBe(true);
  });

  it('正規表示式特殊字元會被跳脫', () => {
    expect(findHits('使用 C++ 與 C#', 'c++').count).toBe(1);
  });
});

describe('搜尋', () => {
  const doc = (code: string, text: string, extra: Partial<Doc> = {}): Doc => ({
    code, name: `課程${code}`, nameEn: '', teacher: '王老師', time: 'M1', pdfUrl: `https://a.example/${code}.pdf`, text, ...extra,
  });
  const index = prepare([
    doc('A', '介紹機器學習。'),
    doc('B', '機器 學習、機器學習，以及永續。'),
    doc('C', '與本次無關', { teacher: '李清福' }),
    doc('D', 'Please maintain the course detail.'),
    doc('E', '本課介紹 AI 應用。'),
  ]);

  it('符合任一關鍵字，依命中次數排序；課名與教師也能搜', () => {
    const r = search(index, '機器學習、永續');
    expect(r.results.map(x => x.code)).toEqual(['B', 'A']);
    expect(r.results[0].total).toBe(3);
    expect(r.results[0].hits.map(h => h.count)).toEqual([2, 1]);
    expect(search(index, '李清福').results.map(x => x.code)).toEqual(['C']);
    expect(search(index, '').results).toEqual([]);
  });

  it('子字串初篩後以完整單字過濾：只出現在單字中間的不列出', () => {
    expect(search(index, 'AI').results.map(x => x.code)).toEqual(['E']);
  });

  it('結果不含全文（只帶片段），避免畫面拿到整份文字', () => {
    expect(search(index, '永續').results[0]).not.toHaveProperty('text');
  });
});
