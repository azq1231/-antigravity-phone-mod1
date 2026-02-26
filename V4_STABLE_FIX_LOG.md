# Antigravity V4.1 高穩定性修正報告 (Stability & UI Report)

本檔案記錄了 2026年2月15日 針對 Antigravity V4.1 手機端連線與顯示問題的關鍵修正。

## 1. 主控台錯誤修復 (Console Error Sanitization)

### 現象

手機瀏覽器主控台瘋狂噴出 `net::ERR_UNKNOWN_URL_SCHEME` 錯誤，源自於 `vscode-file://` 或 `file://` 等 VS Code 內部協議。這些報錯導致瀏覽器效能下降且難以調試。

### 修復方案 (Surgically Targeted Sanitization)

- **協議中和**：不再只是單純替換字串，而是使用「Surgical URL removal」技術。
- **1x1 透明位圖替換**：將所有的 `url("vscode-file://...")` 替換為 `url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")`。
- **效果**：瀏覽器不再嘗試發起無效的網絡請求，主控台恢復 100% 潔淨。

## 2. 視窗智慧選取 (Window Selection)

### 選取現象

開啟多個實例（Port 9000, 9001 等）時，系統偶爾會鎖定在「啟動器 (Launcher)」或「指令面板 (Command Palette)」而非真正的「對話視窗」。

### 修復方案

- **全視窗掃描**：不再採用「先到先得」模式，而是每秒掃描該端口下的所有網頁上下文 (Contexts)。
- **DNA 特徵優先**：建立了一個評分機制，優先選擇包含 `#conversation`、`#chat` 或 `#cascade` 元素的視窗。
- **手動模式保護**：若用戶在「工作槽位管理」手動選擇了端口，系統將停止自動跳轉 (Auto-Hunt)，優先呈現該端口的真實原始數據。

## 3. 佈局中和 (Layout Neutralization)

### 佈局現象

對話內容被極大高度（90,000px+）推到底部不見，或者文字因為黑色主題導致「黑底黑字」。

### 修復方案

- **極致對比 (Force High Contrast)**：強制注入 CSS，將 `#conversation` 及其子元素的所有文字設為 `#ffffff !important`，並強化背景深度。
- **瓦解異常高度**：針對 VS Code 虛擬列表常見的「巨型高度」進行動態裁切，將所有 `min-height > 10000px` 的容器強制設為 `auto`。
- **遮擋物清除**：主動偵測並隱藏 `[placeholder*="Open window"]` 和 `.quick-input-widget` 等會遮擋對話的浮動元件。

## 4. 槽位管理恢復 (Slot Restoration)

### 槽位現象

優化快照時過於激進的 `display: none` 規則導致手機端本身的控制按鈕（Switch, Start, Stop）也消失。

### 修復方案

- **範圍限制 (Scoping)**：將所有「隱藏按鈕」的 CSS 規則嚴格限制在 `#cascade` (快照容器) 內部，確保外部 UI 功能不受影響。

## 5. 切換同步 (Switch Sync)

### 同步現象

在 9000 與 9001 之間切換時，畫面反應遲鈍或顯示舊視窗的殘影。

### 修復方案

- **緩存清空 (Hash Reset)**：在接收到 `switch_port` 指令時，立即重設該連線的 `lastHash = null`。
- **效果**：切換端口後，系統會忽略哈希比對，立即推送最新的第一手畫面。

## 6. 精準 Context 匹配 (Context Matching)

### 匹配現象

當開啟 Chat Panel 時，手機端偶爾會顯示 VS Code 編輯器（Workbench）畫面而非對話內容，這是因為編輯器區域也符合寬泛的 `[role="main"]` 匹配條件。

### 修復方案 (V4.2 精準匹配)

- **品質積分制**：將匹配分為 `exact` (#conversation, #chat) 與 `loose` (main)。
- **優先級重整**：強制系統優先選擇 `exact` 匹配的 Context，不再盲目追求 HTML 長度。
- **效果**：即使編輯器畫面再大，系統也會精準鎖定較小的對話區域進行擷取。

## 7. 一鍵啟動整合 (One-Click Launch)

### 整合現象

原本啟動系統需要手動執行兩個 `.bat` 檔案（伺服器與外網穿透），不僅操作繁瑣，且關閉時容易遺留背景程序（如 `cloudflared.exe`）。

### 修復方案 (`ONE_CLICK_START.bat`)

- **全自動化流程**：
    1. **自動清理**：啟動前自動檢查並終止佔用 `3004` 埠號的舊程序。
    2. **完整性檢查**：自動執行 `sanity_check_v4.js`，確保代碼無誤後才啟動。
    3. **異步穿透**：使用 `start /min` 最小化背景啟動 Cloudflare Tunnel，減少桌面干擾。
    4. **守護進程鎖定**：將 `server_v4.js` 設為主進程。
- **自動資源回收**：
  - 在伺服器關閉時，腳本會自動執行 `taskkill` 清理所有相關的背景 `cloudflared.exe` 程序，達成「一鍵開啟、一鍵關閉」。

---
**核准記錄**：v4.2.1 Stable (UX Enhancement)
**狀態**：操作流程簡化 50%，解決背景進程殘留問題。

## 8. 發送邏輯終極重構：CDP 底層物理盲打 (The Blind Ninja Method) (2026-02-26)

### 現象

- 手機端按下發送後，電腦端無反應，即使已經正確找到發送按鈕。
- 嘗試尋找按鈕與執行 JavaScript 的 `element.click()` 經常被 React/Lexical 的內部阻擋機制或 re-render 干擾而失效。
- 偶爾出現文字重複填入（Double Injection）的問題。

### 終極修復方案

- **揚棄 DOM 操作 (No More Scraping)**：徹底放棄在網頁中使用 JavaScript 搜尋 `[aria-label="Send"]` 等發送按鈕的作法。這意味著系統從此不再受 UI 更新、按鈕改版、或是畫面遮擋影響。
- **純淨 CDP 實體輸入 (Physical Input Injection)**：
  - **發送文字**：改用底層 Chromium 引擎級別的 `Input.insertText` 來物理寫入對話，跳過框架事件，百分之百避免 JavaScript 觸發事件造成的「重複輸入」與「文字疊加」問題。
  - **暴力回車 (Blind Enter)**：文字輸入後，等待 150ms 讓介面反應，接著使用 `Input.dispatchKeyEvent` 模擬系統級別的實體 Enter 鍵敲擊（包含 `keyDown` 與 `keyUp`），直接命令作業系統強行觸發編輯器的原生發送機制。
- **核平式對焦清空 (Nuclear Focus & Clear)**：在使用底層輸入前，依舊利用極輕量的 JS 來鎖定編輯器 (`editor.focus()`)，並執行強制的 `innerHTML = '<p dir="ltr"><br></p>'` 與 `document.execCommand("delete")` 組合技，確保每次新發送時輸入框純淨無雜質。

**結論**：此方法確立為 V4 版本之後「最鐵血、最無敵」的發送邏輯，徹底終結找不到按鈕的歷史。
