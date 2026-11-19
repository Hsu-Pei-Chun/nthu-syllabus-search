// 嵌入學校 CMS 的課綱搜尋小工具。CMS 頁面上只需要：
//   <div id="nthu-syllabus-search"></div>
//   <script src="https://<帳號>.github.io/nthu-syllabus-search/widget.js" defer></script>
//
// 以 Shadow DOM 隔離樣式：CMS 的 CSS 不會弄亂這裡，這裡的 CSS 也不會影響 CMS。
// 課綱文字來自外部，一律以 textContent 放進畫面，不用 innerHTML。
import { prepare, search, withBriefs, type BriefLike, type Doc, type Indexed, type Result, type Segment } from './search.ts';
import type { SemesterInfo } from './build-index.ts';
import { CSS } from './widget-style.ts';

const PAGE = 50;

// defer 的一般 script 執行時 currentScript 仍可取得；資料檔與 widget.js 放在同一處
const scriptSrc = (document.currentScript as HTMLScriptElement | null)?.src || location.href;

type El = HTMLElement;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}
const ICON_SEARCH = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="m21 21-5.2-5.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg>';
const ICON_EXT = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>';
function icon(svg: string) { const s = h('span', { class: 'icon' }); s.innerHTML = svg; return s; } // 固定的圖示字串，非外部資料

function snippet(segs: Segment[]) {
  return h('p', { class: 'snippet' }, ...segs.map(s => (s.hit ? h('mark', {}, s.text) : document.createTextNode(s.text))));
}

const DESC_FOLD = 110; // 簡述超過這個字數時先收合成三行，可展開

function brief(r: Result) {
  const parts: HTMLElement[] = [];
  if (r.tags) parts.push(h('p', { class: 'tags' }, h('span', { class: 'label' }, 'TAG'), r.tags));
  if (r.desc) {
    const p = h('p', { class: 'desc' }, h('span', { class: 'label' }, '簡述'), r.desc);
    parts.push(p);
    if (r.desc.length > DESC_FOLD) {
      p.classList.add('folded');
      const toggle = h('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false' }, '展開簡述');
      toggle.addEventListener('click', () => {
        const open = p.classList.toggle('folded') === false;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? '收合簡述' : '展開簡述';
      });
      parts.push(toggle);
    }
  }
  return parts.length ? h('div', { class: 'brief' }, ...parts) : null;
}

/** fullText：文字檔課綱的全文（沒有 PDF 可開，改在卡片內展開） */
function card(r: Result, fullText?: string) {
  const meta = h('p', { class: 'meta' }, h('span', { class: 'mono pre' }, r.code), r.teacher ? h('span', {}, r.teacher) : null, r.time ? h('span', { class: 'mono' }, r.time) : null);
  const link = r.pdfUrl
    ? h('a', { class: 'pdf', href: r.pdfUrl, target: '_blank', rel: 'noopener noreferrer' }, '開啟 PDF', icon(ICON_EXT))
    : h('span', { class: 'kind' }, fullText ? '文字檔課綱' : '尚無課綱');
  const hits = r.hits.filter(x => x.count > 0).map(x => {
    const group = h('div', { class: 'hit' }, h('span', { class: 'chip' }, `${x.keyword} · ${x.count} 處`));
    if (x.snippets[0]) group.append(snippet(x.snippets[0]));
    if (x.snippets.length > 1) {
      group.append(h('details', {}, h('summary', {}, `再顯示 ${x.snippets.length - 1} 段`), ...x.snippets.slice(1).map(snippet)));
    }
    return group;
  });
  return h('li', {}, h('article', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, h('h3', {}, r.name || r.code), meta), link),
    brief(r),
    h('div', { class: 'hits' }, ...hits),
    fullText ? h('details', { class: 'full' }, h('summary', {}, '查看完整課綱'), h('div', { class: 'fulltext' }, fullText)) : null));
}

export function mount(host: El, base = new URL('.', scriptSrc).href) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();
  root.append(h('style', {}, CSS));

  const uid = Math.random().toString(36).slice(2, 8);
  const select = h('select', { id: `sem-${uid}`, class: 'input' });
  const input = h('input', { id: `q-${uid}`, class: 'input with-icon', type: 'search', placeholder: '例：人工智慧、永續、機器學習', autocomplete: 'off', enterkeyhint: 'search' });
  const button = h('button', { type: 'submit', class: 'btn' }, icon(ICON_SEARCH), '搜尋');
  const status = h('p', { class: 'status', role: 'status' });
  const list = h('ul', { class: 'results' });
  const more = h('button', { type: 'button', class: 'btn secondary more', hidden: '' });

  const form = h('form', { class: 'panel', role: 'search' },
    h('div', { class: 'row' },
      h('div', { class: 'field sem' }, h('label', { for: select.id }, '學期'), select),
      h('div', { class: 'field grow' }, h('label', { for: input.id }, '關鍵字'),
        h('div', { class: 'search-line' }, h('div', { class: 'input-wrap' }, icon(ICON_SEARCH), input), button))),
    h('p', { class: 'hint' }, '搜尋課綱（PDF、文字檔）與課程簡述、TAG。多個關鍵字用逗號或頓號分隔，符合任一個就會列出；不分大小寫、會忽略斷行與空白。英文縮寫（如 AI）只比對完整單字。'));
  root.append(h('div', { class: 'wrap' }, form, status, list, more));

  let semesters: SemesterInfo[] = [];
  const cache = new Map<string, Promise<Indexed[]>>();
  let byCode = new Map<string, Doc>();
  let results: Result[] = [];
  let shown = 0;
  let run = 0;

  const getJson = <T,>(file: string): Promise<T> => fetch(new URL(`data/${file}`, base))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<T>; });

  const loadSemester = (sem: SemesterInfo) => {
    const id = sem.id;
    if (!cache.has(id)) {
      // 只有簡述、還沒有課綱的學期不會有課綱檔
      const hasSyllabi = sem.pdf === undefined || sem.pdf + (sem.textDocs ?? 0) > 0;
      const p = Promise.all([
        hasSyllabi ? getJson<{ docs: Doc[] }>(`syllabi-${id}.json`).then(f => f.docs) : Promise.resolve([] as Doc[]),
        sem.briefs ? getJson<{ briefs: BriefLike[] }>(`briefs-${id}.json`).then(f => f.briefs) : Promise.resolve([] as BriefLike[]),
      ]).then(([docs, briefs]) => prepare(withBriefs(docs, briefs)));
      p.catch(() => cache.delete(id)); // 失敗時下次可重試
      cache.set(id, p);
    }
    return cache.get(id)!;
  };

  function renderMore() {
    const next = results.slice(shown, shown + PAGE);
    list.append(...next.map(r => card(r, r.pdfUrl ? undefined : byCode.get(r.code)?.text)));
    shown += next.length;
    const left = results.length - shown;
    more.hidden = left <= 0;
    more.textContent = `顯示更多（還有 ${left} 門）`;
  }

  async function doSearch() {
    const id = select.value;
    const q = input.value;
    const mine = ++run;
    const sem = semesters.find(s => s.id === id);
    if (!sem) return;
    if (!cache.has(id)) status.textContent = `載入${sem.label}課綱資料中…`;
    let index: Indexed[];
    try { index = await loadSemester(sem); } catch (e) {
      if (mine === run) status.textContent = `課綱資料載入失敗（${e instanceof Error ? e.message : e}），請稍後再試。`;
      return;
    }
    if (mine !== run) return; // 使用者已經改了條件
    byCode = new Map(index.map(x => [x.doc.code, x.doc]));
    const r = search(index, q);
    results = r.results; shown = 0; list.replaceChildren();
    const updated = sem.updatedAt.slice(0, 10);
    if (r.keywords.length === 0) {
      status.textContent = `${sem.label}：共 ${sem.count} 份課綱（資料更新：${updated}）。輸入關鍵字開始搜尋。`;
      more.hidden = true;
      return;
    }
    status.textContent = results.length ? `${sem.label}：共 ${results.length} 門課程符合` : `${sem.label}：沒有課綱包含這些關鍵字。`;
    renderMore();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 250); });
  form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); doSearch(); });
  select.addEventListener('change', doSearch);
  more.addEventListener('click', renderMore);

  status.textContent = '載入學期清單中…';
  const ready = fetch(new URL('data/semesters.json', base))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<SemesterInfo[]>; })
    .then(list => {
      semesters = list;
      if (!list.length) { status.textContent = '目前還沒有課綱資料。'; return; }
      select.replaceChildren(...list.map(s => h('option', { value: s.id }, `${s.label}（${s.count} 門）`)));
      return doSearch();
    })
    .catch(e => { status.textContent = `學期清單載入失敗（${e instanceof Error ? e.message : e}），請稍後再試。`; });
  return { root, ready, search: (q: string) => { input.value = q; return doSearch(); } };
}

function autoMount() {
  document.querySelectorAll<El>('#nthu-syllabus-search, [data-nthu-syllabus-search]').forEach(el => mount(el));
}
if (typeof window !== 'undefined' && !(window as { __NSS_NO_AUTOMOUNT__?: boolean }).__NSS_NO_AUTOMOUNT__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
  else autoMount();
}
