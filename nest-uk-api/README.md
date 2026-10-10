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

## 水浸代理（api/flood.js）— 新增

瀏覽器直接查英國環境署（EA）的水浸風險服務，有時會因 CORS 或網絡被擋而顯示 "Failed to fetch"。`api/flood.js` 改由 Vercel 後端去查，網頁會先用它，失敗才退回瀏覽器直接查。

1. 把 `api/flood.js` 放進 repo 的 `api/` 資料夾（和 `buses.js` 並排），Vercel 會自動重新部署。不需要新的環境變數（沿用 `ALLOWED_ORIGINS`）。
2. 測試：開 `https://<專案>.vercel.app/api/flood?lat=51.2362&lng=-0.5704&debug=1`
   - 成功：`{"ok":true,"band":"low",...}`（band 為 null 代表該點不在洪水風險區內，是正常結果）
   - 失敗：回 502，內容會列出每個來源的 HTTP 狀態和回應片段。把這段貼給開發者，就能知道是服務改了網址、被封鎖還是逾時。
3. 若 EA 服務網址日後改了，可在 Vercel 設定 `FLOOD_QUERY_URL`（ArcGIS 圖層的 `/query` 網址），重新部署即可，不用改程式。
4. 結果會在 Vercel 邊緣快取 1 天，所以同一地點不會重複打 EA。

網頁的「巴士」和「水浸」共用同一個 `NEST_BUS_API` 設定（程式會自動換成 `/api/flood`），不用另外設定。
