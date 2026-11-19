// 課程簡述＋TAG（課務組「TAG / SDGS / 簡述」的 Excel，每學期一個檔）。
// 欄位名稱與順序各學期不同（例：11420「TAG、簡述」，11510「課程簡述、關鍵字」），所以依標題列找欄位。
// 內容帶有前綴 <TAG:>／<DESC:>、HTML 跳脫（&lt;x&gt;）與 Excel 控制字元，這裡一併清掉。
// 內容過長時 Excel 會溢出到最後一欄之後的無標題欄位，接回最後一個有標題的欄位。

export type Brief = { code: string; name: string; nameEn: string; teacher: string; lang: string; tags: string; desc: string };

const COLUMNS: Record<keyof Brief, RegExp> = {
  code: /^科號$/,
  name: /^(中文)?課名$/,
  nameEn: /^英文課名$/,
  teacher: /^教師$/,
  lang: /^語言$/,
  tags: /^(TAG|關鍵字)$/i,
  desc: /^(課程)?簡述$/,
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function cleanBriefText(s: string): string {
  return s
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<(TAG|DESC):>/gi, '')
    .replace(/<\/?x>/gi, '') // 校方系統把 description、object 這類字插入 <x>，防止被當成 HTML
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBriefRows(rows: string[][]): Brief[] {
  const headerAt = rows.findIndex(r => r?.some(c => COLUMNS.code.test((c ?? '').trim())));
  if (headerAt < 0) throw new Error('Excel 裡找不到「科號」欄，這不是簡述／TAG 檔');
  const header = rows[headerAt].map(c => (c ?? '').trim());
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, re]) => [k, header.findIndex(h => re.test(h))])) as Record<keyof Brief, number>;
  if (col.tags < 0 && col.desc < 0) throw new Error('Excel 裡找不到「TAG／關鍵字」或「簡述」欄');
  const lastNamed = header.reduce((last, h, i) => (h ? i : last), -1);
  const lastKey = (Object.keys(col) as (keyof Brief)[]).find(k => col[k] === lastNamed);

  const seen = new Set<string>();
  const out: Brief[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    if (!row) continue;
    const code = (row[col.code] ?? '').replace(/ /g, ' ').trimEnd(); // 科號內的補位空格要保留
    if (!/^\d{5}[A-Z]/i.test(code) || seen.has(code)) continue; // 學期碼＋系所代碼；缺系所代碼的壞資料略過
    seen.add(code);
    const get = (k: keyof Brief) => (col[k] >= 0 ? row[col[k]] ?? '' : '');
    const b: Brief = { code, name: '', nameEn: '', teacher: '', lang: '', tags: '', desc: '' };
    for (const k of ['name', 'nameEn', 'teacher', 'lang', 'tags', 'desc'] as const) {
      let v = get(k);
      if (k === lastKey) v = [v, ...row.slice(lastNamed + 1)].filter(Boolean).join(', ');
      b[k] = cleanBriefText(v);
    }
    out.push(b);
  }
  return out;
}
