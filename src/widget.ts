// 嵌入學校 CMS 的課綱搜尋小工具。CMS 頁面上只需要：
//   <div id="nthu-syllabus-search"></div>
//   <script src="https://<帳號>.github.io/nthu-syllabus-search/widget.js" defer></script>
//
// 以 Shadow DOM 隔離樣式：CMS 的 CSS 不會弄亂這裡，這裡的 CSS 也不會影響 CMS。
// 課綱文字來自外部，一律以 textContent 放進畫面，不用 innerHTML。
// 介面可切換繁體中文（預設）與英文，選擇記在 localStorage；CMS 也可用 data-lang="en" 指定預設語言。
import { prepare, search, withBriefs, type BriefLike, type Doc, type Indexed, type Result, type Segment } from './search.ts';
import type { SemesterInfo } from './build-index.ts';
import { CSS } from './widget-style.ts';
import { semesterLabelEn } from './semester.ts';
import { MESSAGES, isLang, loadLang, saveLang, type Lang, type Messages } from './i18n.ts';

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

function brief(r: Result, t: Messages) {
  const parts: HTMLElement[] = [];
  if (r.tags) parts.push(h('p', { class: 'tags' }, h('span', { class: 'label' }, 'TAG'), r.tags));
  if (r.desc) {
    const p = h('p', { class: 'desc' }, h('span', { class: 'label' }, t.desc), r.desc);
    parts.push(p);
    if (r.desc.length > DESC_FOLD) {
      p.classList.add('folded');
      const toggle = h('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false' }, t.expandDesc);
      toggle.addEventListener('click', () => {
        const open = p.classList.toggle('folded') === false;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? t.collapseDesc : t.expandDesc;
      });
      parts.push(toggle);
    }
  }
  return parts.length ? h('div', { class: 'brief' }, ...parts) : null;
}

/** fullText：文字檔課綱的全文（沒有 PDF 可開，改在卡片內展開） */
function card(r: Result, t: Messages, lang: Lang, fullText?: string) {
  // 英文模式以英文課名為主、中文課名為輔；沒有英文課名時只顯示中文
  const en = lang === 'en' && r.nameEn ? r.nameEn : '';
  const title = h('h3', en ? { lang: 'en' } : { lang: 'zh-Hant' }, en || r.name || r.code);
  const alt = en && r.name ? h('p', { class: 'alt-name', lang: 'zh-Hant' }, r.name) : null;
  const meta = h('p', { class: 'meta' }, h('span', { class: 'mono pre' }, r.code), r.teacher ? h('span', {}, r.teacher) : null, r.time ? h('span', { class: 'mono' }, r.time) : null);
  const link = r.pdfUrl
    ? h('a', { class: 'pdf', href: r.pdfUrl, target: '_blank', rel: 'noopener noreferrer' }, t.openPdf, icon(ICON_EXT))
    : h('span', { class: 'kind' }, fullText ? t.textSyllabus : t.noSyllabus);
  const hits = r.hits.filter(x => x.count > 0).map(x => {
    const group = h('div', { class: 'hit' }, h('span', { class: 'chip' }, t.hitCount(x.keyword, x.count)));
    if (x.snippets[0]) group.append(snippet(x.snippets[0]));
    if (x.snippets.length > 1) {
      group.append(h('details', {}, h('summary', {}, t.moreSnippets(x.snippets.length - 1)), ...x.snippets.slice(1).map(snippet)));
    }
    return group;
  });
  return h('li', {}, h('article', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, title, alt, meta), link),
    brief(r, t),
    h('div', { class: 'hits' }, ...hits),
    fullText ? h('details', { class: 'full' }, h('summary', {}, t.fullText), h('div', { class: 'fulltext' }, fullText)) : null));
}

export type MountOptions = { base?: string; lang?: Lang };

/**
 * 語言的優先順序：使用者按過切換鈕記下的選擇 > 呼叫端指定（data-lang 屬性或 options.lang）> 繁體中文。
 * 第二個參數也可直接傳 base 網址（舊用法）。
 */
export function mount(host: El, opts: string | MountOptions = {}) {
  const o: MountOptions = typeof opts === 'string' ? { base: opts } : opts;
  const base = o.base ?? new URL('.', scriptSrc).href;
  const attrLang = host.getAttribute('data-lang');
  let lang: Lang = loadLang() ?? o.lang ?? (isLang(attrLang) ? attrLang : 'zh');
  let t = MESSAGES[lang];

  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();
  root.append(h('style', {}, CSS));

  const uid = Math.random().toString(36).slice(2, 8);
  const select = h('select', { id: `sem-${uid}`, class: 'input' });
  const input = h('input', { id: `q-${uid}`, class: 'input with-icon', type: 'search', autocomplete: 'off', enterkeyhint: 'search' });
  const buttonText = h('span', {});
  const button = h('button', { type: 'submit', class: 'btn' }, icon(ICON_SEARCH), buttonText);
  const status = h('p', { class: 'status', role: 'status' });
  const list = h('ul', { class: 'results' });
  const more = h('button', { type: 'button', class: 'btn secondary more', hidden: '' });
  const semLabel = h('label', { for: select.id });
  const kwLabel = h('label', { for: input.id });
  const hint = h('p', { class: 'hint' });
  const note = h('p', { class: 'hint note' });
  const langBtn = h('button', { type: 'button', class: 'lang-toggle' });

  const form = h('form', { class: 'panel', role: 'search' },
    h('div', { class: 'row' },
      h('div', { class: 'field sem' }, semLabel, select),
      h('div', { class: 'field grow' }, kwLabel,
        h('div', { class: 'search-line' }, h('div', { class: 'input-wrap' }, icon(ICON_SEARCH), input), button))),
    hint, note);
  const wrap = h('div', { class: 'wrap' }, h('div', { class: 'lang-bar' }, langBtn), form, status, list, more);
  root.append(wrap);

  let semesters: SemesterInfo[] = [];
  const cache = new Map<string, Promise<Indexed[]>>();
  let byCode = new Map<string, Doc>();
  let results: Result[] = [];
  let shown = 0;
  let run = 0;
  // 狀態列的內容記成函式，切換語言時可以用新語言重畫
  let statusMsg: (t: Messages) => string = x => x.loadingList;
  const setStatus = (f: (t: Messages) => string) => { statusMsg = f; status.textContent = f(t); };

  const semName = (s: SemesterInfo) => (lang === 'en' ? semesterLabelEn(s.id) : s.label);
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  function renderOptions() {
    const value = select.value;
    select.replaceChildren(...semesters.map(s => h('option', { value: s.id }, t.semesterOption(semName(s), s.count))));
    if (semesters.some(s => s.id === value)) select.value = value; else if (semesters.length) select.selectedIndex = 0;
  }

  function renderChrome() {
    wrap.setAttribute('lang', t.htmlLang);
    langBtn.textContent = t.switchTo;
    langBtn.setAttribute('lang', lang === 'en' ? 'zh-Hant' : 'en');
    langBtn.setAttribute('aria-label', t.switchLabel);
    semLabel.textContent = t.semester;
    kwLabel.textContent = t.keyword;
    input.placeholder = t.placeholder;
    buttonText.textContent = t.search;
    hint.textContent = t.hint;
    note.textContent = t.dataNote;
    note.hidden = !t.dataNote;
    renderOptions();
    status.textContent = statusMsg(t);
  }

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

  const cardOf = (r: Result) => card(r, t, lang, r.pdfUrl ? undefined : byCode.get(r.code)?.text);

  function updateMore() {
    const left = results.length - shown;
    more.hidden = left <= 0;
    more.textContent = t.more(left);
  }

  function renderMore() {
    const next = results.slice(shown, shown + PAGE);
    list.append(...next.map(cardOf));
    shown += next.length;
    updateMore();
  }

  async function doSearch() {
    const id = select.value;
    const q = input.value;
    const mine = ++run;
    const sem = semesters.find(s => s.id === id);
    if (!sem) return;
    if (!cache.has(id)) setStatus(x => x.loadingSemester(lang === 'en' ? semesterLabelEn(sem.id) : sem.label));
    let index: Indexed[];
    try { index = await loadSemester(sem); } catch (e) {
      if (mine === run) setStatus(x => x.semesterFailed(errText(e)));
      return;
    }
    if (mine !== run) return; // 使用者已經改了條件
    byCode = new Map(index.map(x => [x.doc.code, x.doc]));
    const r = search(index, q);
    results = r.results; shown = 0; list.replaceChildren();
    const updated = sem.updatedAt.slice(0, 10);
    const label = () => semName(sem);
    if (r.keywords.length === 0) {
      setStatus(x => x.idle(label(), sem.count, updated));
      more.hidden = true;
      return;
    }
    const n = results.length;
    setStatus(x => (n ? x.found(label(), n) : x.none(label())));
    renderMore();
  }

  function setLang(next: Lang) {
    if (next === lang) return;
    lang = next; t = MESSAGES[lang];
    saveLang(lang);
    renderChrome();
    // 保留目前已展開的筆數，以新語言重畫結果
    list.replaceChildren(...results.slice(0, shown).map(cardOf));
    updateMore();
    host.dispatchEvent(new CustomEvent('nss-langchange', { detail: { lang }, bubbles: true }));
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 250); });
  form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); doSearch(); });
  select.addEventListener('change', doSearch);
  more.addEventListener('click', renderMore);
  langBtn.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));

  renderChrome();
  setStatus(x => x.loadingList);
  const ready = fetch(new URL('data/semesters.json', base))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<SemesterInfo[]>; })
    .then(list => {
      semesters = list;
      if (!list.length) { setStatus(x => x.noData); return; }
      renderOptions();
      return doSearch();
    })
    .catch(e => { setStatus(x => x.listFailed(errText(e))); });
  return {
    root, ready,
    search: (q: string) => { input.value = q; return doSearch(); },
    setLang,
    get lang() { return lang; },
  };
}

function autoMount() {
  document.querySelectorAll<El>('#nthu-syllabus-search, [data-nthu-syllabus-search]').forEach(el => mount(el));
}
if (typeof window !== 'undefined' && !(window as { __NSS_NO_AUTOMOUNT__?: boolean }).__NSS_NO_AUTOMOUNT__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
  else autoMount();
}
