// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, vi } from 'vitest';

(window as unknown as { __NSS_NO_AUTOMOUNT__: boolean }).__NSS_NO_AUTOMOUNT__ = true;
const { mount } = await import('../src/widget.ts');

const BASE = 'https://cdn.example/nss/';
const semesters = [
  { id: '11420', label: '114 學年度第 2 學期', url: 'u2', updatedAt: '2026-11-15T00:00:00Z', count: 2, noText: 0, failed: 0, failures: [] },
  { id: '11410', label: '114 學年度第 1 學期', url: 'u1', updatedAt: '2026-08-01T00:00:00Z', count: 1, noText: 0, failed: 0, failures: [] },
];
const doc = (code: string, name: string, text: string) => ({ code, name, nameEn: '', teacher: '王老師', time: 'M3M4', pdfUrl: `https://pdf.example/${code}.pdf`, text });
const files: Record<string, unknown> = {
  'data/semesters.json': semesters,
  'data/syllabi-11420.json': { docs: [
    // 命中處彼此相距超過前後文長度，才會各自成為一段片段
    doc('11420AAA 100100', '人工智慧導論', Array(5).fill('AI 應用').join('，' + '其他課程內容'.repeat(10) + '，')),
    doc('11420BBB 200200', '<img src=x onerror="window.__xss=1">', '本課提到 AI 一次'),
    { ...doc('11420CCC 300300', '文字檔的課', '一、課程說明\n永續發展<b>概論</b>'), pdfUrl: '' },
  ] },
  'data/syllabi-11410.json': { docs: [doc('11410CCC 300300', '上學期的課', 'AI')] },
};

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (u: URL | string) => {
    const key = String(u).replace(BASE, '');
    return key in files ? new Response(JSON.stringify(files[key])) : new Response('', { status: 404 });
  }));
});

async function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  const w = mount(host, BASE);
  await w.ready;
  return { ...w, $: (s: string) => w.root.querySelector(s) as HTMLElement, $$: (s: string) => [...w.root.querySelectorAll(s)] as HTMLElement[] };
}

describe('嵌入小工具', () => {
  it('以 Shadow DOM 掛載，學期選單列出各學期（新學期在前），預設顯示資料筆數與更新日期', async () => {
    const w = await setup();
    expect(w.root).toBeInstanceOf(ShadowRoot);
    expect(w.$$('option').map(o => o.textContent)).toEqual(['114 學年度第 2 學期（2 門）', '114 學年度第 1 學期（1 門）']);
    expect(w.$('.status').textContent).toContain('資料更新：2026-11-15');
  });

  it('搜尋後列出結果卡片：課名、科號、PDF 連結、命中標籤與 <mark>', async () => {
    const w = await setup();
    await w.search('AI');
    expect(w.$('.status').textContent).toBe('114 學年度第 2 學期：共 2 門課程符合');
    const first = w.$$('article')[0];
    expect(first.querySelector('h3')!.textContent).toBe('人工智慧導論');
    expect(first.querySelector('.chip')!.textContent).toBe('AI · 5 處');
    expect(first.querySelector('mark')!.textContent).toBe('AI');
    expect(first.querySelector('a.pdf')!.getAttribute('href')).toBe('https://pdf.example/11420AAA 100100.pdf');
    expect(first.querySelector('a.pdf')!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(first.querySelector('summary')!.textContent).toBe('再顯示 2 段');
  });

  it('課綱內容一律當純文字顯示，不會被當成 HTML 執行', async () => {
    const w = await setup();
    await w.search('AI');
    const second = w.$$('article')[1];
    expect(second.querySelector('h3')!.textContent).toBe('<img src=x onerror="window.__xss=1">');
    expect(second.querySelector('img')).toBeNull();
  });

  it('文字檔課綱沒有 PDF：顯示「文字檔課綱」，可展開完整課綱（純文字、保留換行）', async () => {
    const w = await setup();
    await w.search('永續');
    const card = w.$$('article')[0];
    expect(card.querySelector('h3')!.textContent).toBe('文字檔的課');
    expect(card.querySelector('a.pdf')).toBeNull();
    expect(card.querySelector('.kind')!.textContent).toBe('文字檔課綱');
    expect(card.querySelector('details.full summary')!.textContent).toBe('查看完整課綱');
    expect(card.querySelector('.fulltext')!.textContent).toBe('一、課程說明\n永續發展<b>概論</b>');
    expect(card.querySelector('.fulltext b')).toBeNull();
  });

  it('PDF 課綱的卡片不附全文', async () => {
    const w = await setup();
    await w.search('AI');
    expect(w.$$('article')[0].querySelector('.fulltext')).toBeNull();
  });

  it('切換學期只載入該學期的資料檔', async () => {
    const w = await setup();
    const sel = w.$('select') as HTMLSelectElement;
    sel.value = '11410';
    await w.search('AI');
    expect(w.$$('article h3').map(e => e.textContent)).toEqual(['上學期的課']);
  });

  it('資料檔載入失敗時顯示錯誤訊息', async () => {
    files['data/semesters.json'] = [{ ...semesters[0], id: '99999' }];
    const w = await setup();
    expect(w.$('.status').textContent).toContain('載入失敗');
    files['data/semesters.json'] = semesters;
  });
});
