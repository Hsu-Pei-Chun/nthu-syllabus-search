// 學期代碼：科號前 5 碼，例如 11420 = 114 學年度第 2 學期

export function semesterLabel(id: string): string {
  const m = /^(\d{3})(\d{2})$/.exec(id);
  if (!m) return id;
  const term = { '10': '第 1 學期', '20': '第 2 學期', '30': '暑期' }[m[2]] ?? `第 ${m[2]} 期`;
  return `${Number(m[1])} 學年度${term}`;
}

/** 總表上的科號理應都屬同一學期；取最多數的前 5 碼，避免個別異常科號影響判斷 */
export function semesterOf(codes: string[]): string {
  const count = new Map<string, number>();
  for (const c of codes) {
    const id = c.slice(0, 5);
    if (/^\d{5}$/.test(id)) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error('無法從科號判斷學期（科號前 5 碼應為學年度＋學期，例如 11420）');
  return best[0];
}
