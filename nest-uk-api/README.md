# Nest UK 實時巴士代理（Vercel）

用途：瀏覽器不能直接讀 BODS（要 API key、沒有 CORS），所以由這個小函數代為查詢，把 SIRI-VM XML 轉成 JSON，並在 Vercel 邊緣快取 10 秒（多人同時看也只打 BODS 一次）。**API key 只放在 Vercel，絕不要寫進 HTML。**

## 步驟

1. 到 https://data.bus-data.dft.gov.uk/ 免費註冊 → 登入後在 Account Settings 取得 **API key**。
2. 把整個 `nest-uk-api` 資料夾放上 GitHub（新 repo），或安裝 Vercel CLI 後在資料夾內執行 `vercel`。
3. Vercel → Import 該 repo（Framework 選 Other，無需 build）。
4. Project → Settings → Environment Variables 新增：
   - `BODS_API_KEY` = 你的 key
   - `ALLOWED_ORIGINS` = `https://billionkmstudio.github.io`（多個用逗號分隔；本機測試可加 `http://localhost:8000`）
5. Redeploy。打開 `https://<專案>.vercel.app/api/buses?bbox=-0.61,51.21,-0.53,51.26`，應見到 `{"ts":…,"count":…,"vehicles":[…]}`。
6. 打開 `nest-uk.html`，把頂部的 `window.NEST_BUS_API = ''` 改成 `'https://<專案>.vercel.app/api/buses'`，上傳 GitHub Pages。
7. 網頁 → 交通 tab，地圖會出現「實時巴士」圖層，巴士約每 15 秒更新並平滑移動。

## 注意

- 只涵蓋**英格蘭**；部分營辦商沒有提供即時資料，所以有些路線看不到車。
- 回傳錯誤碼：400 參數錯、500 沒設 key、502 BODS 出錯、504 BODS 逾時（網頁會顯示原因）。
- 免費額度：Vercel Hobby 足夠個人網站；BODS 有速率限制，快取已降低請求。
- 本機測試：`node test.js`（用模擬資料）。
