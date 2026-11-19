# 清大課綱搜尋（nthu-syllabus-search）

搜尋校方公告的全部課程大綱（PDF 與文字檔）及課程簡述、TAG，找出包含指定關鍵字的課程。以一支 script 嵌入學校 CMS 頁面，不需要伺服器或資料庫。

## 運作方式

```
GitHub Actions（新學期手動觸發；每週一自動更新）
  讀課綱總表（PDF 總表＋文字檔總表）→ 只下載有變動的 PDF、文字檔直接取用 → data/syllabi-<學期>.json
          │ 提交回 repo（保留歷年資料）並發布
          ▼
GitHub Pages：widget.js ＋ data/
          │ 跨網域讀取（GitHub Pages 允許）
          ▼
學校 CMS 頁面：<div> ＋ <script>
```

- 搜尋在使用者的瀏覽器中進行，不會連到校方網站，也不會讀 PDF。
- 每學期一個資料檔（約 10MB，傳輸壓縮後約 4MB），學生只下載選到的學期，之後由瀏覽器快取。
- PDF 課綱的「開啟 PDF」連回校方原檔；文字檔課綱沒有檔案可開，卡片上可直接展開「查看完整課綱」。

## 嵌入學校 CMS

在 CMS 頁面的 HTML 原始碼貼上（網址換成實際的 GitHub Pages 網址）：

```html
<div id="nthu-syllabus-search"></div>
<script src="https://hsu-pei-chun.github.io/nthu-syllabus-search/widget.js" defer></script>
```

小工具以 Shadow DOM 隔離樣式，CMS 的版型不會影響它，它也不會影響 CMS。

## 新學期匯入

每學期有三個來源，都要匯入（同一學期會合併；順序不拘，也可以分次執行）：

| 來源 | 在課務組網站的位置 | 格式 |
|---|---|---|
| PDF 總表 | 「課程大綱」表格的「PDF檔」欄 | 網頁 |
| 文字檔總表 | 「課程大綱」表格的「文字檔」欄 | 網頁 |
| 簡述／TAG | 「各類資料提供--所系專用」頁（需登入）的「TAG / SDGS / 簡述」表格 | Excel |

老師上傳課綱時可選 PDF 或文字，所以課綱分在兩個總表；簡述／TAG 是另一份 Excel，載入時依科號併進課綱，只有簡述、沒有課綱的課也搜得到（卡片標示「尚無課綱」）。
簡述／TAG 的頁面要登入，但 Excel 檔本身是公開網址：登入後在連結上按右鍵「複製連結網址」即可。

1. 到 GitHub repo 的 **Actions → 更新課綱並發布 → Run workflow**
2. 貼上新學期的三個網址，中間用空白隔開，按 **Run workflow**
3. 約 10 分鐘後完成，搜尋頁的學期選單會出現新學期（舊學期資料保留）

學期中不用動：每週一凌晨會自動重新整理最新學期的所有來源，只下載老師有修改的 PDF。

> 公開 repo 若 60 天沒有任何活動，GitHub 會暫停排程；屆時到 Actions 頁面按 **Enable workflow** 即可，或手動執行一次。

## 本機指令

```bash
npm ci
npx tsx src/build-index.ts <網址或檔案> [<網址或檔案>…]   # 匯入或更新（PDF／文字檔總表網址、簡述 Excel 網址或本機 .xlsx）
npx tsx src/build-index.ts --refresh-latest  # 重新整理最新學期
npm test                                      # 測試
npm run build                                 # 產生 site/（widget.js、data/、示範頁）
```

> 不要移除 `pdfjs-dist`：`unpdf` 偵測到它才會使用完整的中文字碼對照表（CMap），否則部分課綱的中文抽不出來。

> 這台開發機的 npm 11.6 會把 lockfile 裡其他平台的套件刪掉，導致 Linux 上的 `npm ci` 失敗；安裝套件請用 `npx -y npm@10.9.4 install`。

## 資料格式

- `data/semesters.json`：學期清單（新到舊），含該學期的總表網址（sources）、筆數（PDF／文字檔）、讀不到文字與失敗的筆數、更新時間
- `data/briefs-<學期>.json`：該學期的簡述／TAG，每門課一行（科號、課名、英文課名、教師、授課語言、TAG、簡述）；本機上傳的檔案來源記為 `file:檔名`，排程不會重新下載
- `data/syllabi-<學期>.json`：該學期每門課一行，含科號、課名、英文課名、教師、時間、PDF 網址（文字檔課綱為空）、全文、來源總表（source），以及增量更新用的 ETag／Last-Modified

## 搜尋規則

- 多個關鍵字以逗號、頓號或換行分隔，符合任一個就列出，依命中次數排序
- 忽略 PDF 文字中的斷行、空白、全形半形與大小寫
- 英數關鍵字（AI、ESG、IoT…）只比對完整單字，避免 AI 命中 detail、maintain
- 清大課綱範本有「採用下列何項 AI 使用規則」欄位，因此搜尋「AI」幾乎每門課都會符合；要找教 AI 的課，建議用「人工智慧」「機器學習」等詞
