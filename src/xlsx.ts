// 讀 .xlsx 第一個工作表成為字串表格（只取儲存格的值，不管格式、公式）。
// 校方的簡述／TAG 是一般 Excel 檔：解壓後讀 sharedStrings.xml 與工作表 XML 即可，不必引入大型試算表套件。
import { strFromU8, unzipSync } from 'fflate';

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlText(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] ?? m;
  }).replace(/_x([\da-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))); // Excel 的控制字元跳脫
}

/** <si>／<is> 內所有 <t> 串起來（多段格式文字），但不含注音／拼音標註 <rPh> */
function richText(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)]
    .map(m => xmlText(m[1] ?? '')).join('');
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function isXlsx(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b; // ZIP 檔頭 "PK"
}

export function readFirstSheet(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, { filter: f => f.name.startsWith('xl/') && /\.(xml|rels)$/.test(f.name) && !f.name.includes('/externalLinks/') });
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  // 依 workbook.xml 的第一個工作表與其關聯找到檔案；找不到就用 sheet1.xml
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(text('xl/workbook.xml'))?.[1];
  if (rid) {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(text('xl/_rels/workbook.xml.rels'))?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(text('xl/_rels/workbook.xml.rels'))?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new Error('Excel 檔裡找不到工作表');

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => richText(m[1]));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (v !== undefined) value = xmlText(v);
      row[col] = value;
    }
    rows[r] = Array.from(row, c => c ?? '');
  }
  return Array.from(rows, r => r ?? []);
}
