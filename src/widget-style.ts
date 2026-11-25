// 小工具樣式（只作用在 Shadow DOM 內）。色彩取自清大官網：清華紫 #721F6E。
export const CSS = `
:host {
  --primary: #721F6E; --primary-hover: #44033F; --link: #7E537B;
  --bg: #F6F4F6; --surface: #FFFFFF; --fg: #222222; --muted: #555555; --border: #CFC8CF;
  --mark: #FEF9C3; --radius: 8px;
  display: block;
}
*, *::before, *::after { box-sizing: border-box; }
/* Shadow DOM 擋得住 CMS 的選擇器，擋不住繼承：CMS 設在外層的 color、font、text-transform 等
   仍會傳到 host。這裡先 all: initial 切斷所有繼承，再設定自己的字型與顏色 */
.wrap {
  all: initial; display: flex; flex-direction: column; gap: 16px;
  color: var(--fg); font-size: 16px; line-height: 1.5; text-align: left;
  font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif;
}
.lang-bar { display: flex; justify-content: flex-end; margin-bottom: -8px; }
.lang-toggle { display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--primary); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: background-color .15s, border-color .15s; }
.lang-toggle:hover { background: var(--bg); border-color: var(--primary); }
.lang-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.panel { display: flex; flex-direction: column; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field.sem { flex: 1 1 250px; }
.field.grow { flex: 999 1 320px; }
label { font-size: 14px; font-weight: 600; }
.search-line { display: flex; gap: 8px; }
.input-wrap { position: relative; flex: 1; min-width: 0; }
.input-wrap .icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.input { display: block; width: 100%; min-height: 44px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: inherit; font: inherit; padding: 0 12px; transition: border-color .15s, box-shadow .15s; }
.input.with-icon { padding-left: 36px; }
.input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgb(114 31 110 / .25); }
.hint { margin: 0; font-size: 14px; color: var(--muted); }
.icon { display: inline-flex; width: 18px; height: 18px; flex-shrink: 0; }
.icon svg { width: 100%; height: 100%; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 16px; border: 0; border-radius: var(--radius); background: var(--primary); color: #fff; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background-color .15s; }
.btn:hover { background: var(--primary-hover); }
.btn.secondary { background: var(--surface); color: var(--fg); border: 1px solid var(--border); font-weight: 500; }
.btn.secondary:hover { background: var(--bg); }
.btn:focus-visible, .pdf:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.status { margin: 0; font-weight: 600; }
.results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px; }
.card-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
.card-title { min-width: 0; flex: 1 1 260px; }
h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.alt-name { margin: 2px 0 0; font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.note[hidden] { display: none; }
.meta { margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 14px; color: var(--muted); }
.mono { font-family: ui-monospace, Consolas, monospace; }
.pre { white-space: pre-wrap; }
.pdf { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--link); font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap; }
.pdf:hover { border-color: var(--link); background: var(--bg); }
.pdf .icon { width: 16px; height: 16px; }
.kind { display: inline-flex; align-items: center; min-height: 32px; padding: 0 10px; border-radius: 999px; background: var(--bg); color: var(--muted); font-size: 13px; white-space: nowrap; }
.full { margin-top: 8px; border-top: 1px solid var(--border); }
.fulltext { white-space: pre-line; overflow-wrap: anywhere; font-size: 14px; line-height: 1.7; color: var(--fg); background: var(--bg); border-radius: var(--radius); padding: 12px 14px; max-height: 480px; overflow-y: auto; }
.brief { margin-top: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.tags, .desc { margin: 0; font-size: 14px; line-height: 1.6; color: var(--fg); overflow-wrap: anywhere; }
.tags { color: var(--muted); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.desc.folded { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.label { display: inline-block; margin-right: 8px; padding: 0 6px; border-radius: 4px; background: var(--bg); color: var(--muted); font-size: 12px; font-weight: 600; line-height: 20px; vertical-align: 1px; }
.linkish { min-height: 32px; padding: 0; border: 0; background: none; color: var(--link); font: inherit; font-size: 14px; cursor: pointer; }
.linkish:hover { text-decoration: underline; }
.linkish:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.hits { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
.hit { display: flex; flex-direction: column; gap: 6px; }
.chip { align-self: flex-start; border-radius: 999px; background: rgb(114 31 110 / .1); color: var(--primary); font-size: 12px; font-weight: 600; padding: 2px 10px; }
.snippet { margin: 0; border-radius: var(--radius); background: var(--bg); color: var(--muted); font-size: 14px; line-height: 1.6; padding: 8px 12px; overflow-wrap: anywhere; }
mark { background: var(--mark); color: var(--fg); font-weight: 500; border-radius: 2px; padding: 0 2px; }
details { display: flex; flex-direction: column; gap: 6px; }
details > .snippet + .snippet, details > summary + .snippet { margin-top: 6px; }
summary { display: inline-flex; align-items: center; min-height: 44px; cursor: pointer; color: var(--link); font-size: 14px; }
summary:hover { text-decoration: underline; }
.more { align-self: center; }
.more[hidden] { display: none; }
@media (max-width: 480px) {
  .panel { padding: 16px; }
  .card { padding: 14px 16px; }
  .pdf { width: 100%; justify-content: center; }
  .search-line { flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
