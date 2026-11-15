import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractPdfText } from '../src/build-index.ts';

// 校方實際課綱（114 上 GEC 131301）：中文字型需要 pdfjs-dist 附帶的 CMap 才能轉成文字。
// 沒裝 pdfjs-dist 時 unpdf 改用內建精簡版，這份只抽得到英文（約 1859 字），中文整段消失。
describe('PDF 文字抽取', () => {
  it('需要 CMap 的中文字型也抽得到中文', async () => {
    const bytes = new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures/cjk-cmap-syllabus.pdf')));
    const { pages, text } = await extractPdfText(bytes);
    expect(pages).toBe(5);
    expect(text).toContain('生成式人工智慧倫理聲明');
    expect(text.length).toBeGreaterThan(3000);
  }, 30000);
});
