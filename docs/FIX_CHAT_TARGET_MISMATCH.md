# 修復記錄：Chat Panel 視窗抓取誤判 (Target Mismatch Fix)

這份文件記錄了 2026 年 2 月 18 日解決「手機端看不到對話畫面，只看得到 VS Code 編輯器」問題的技術細節。

## 1. 問題描述 (Issue)

- **現象**：用戶在電腦上開啟了 Antigravity Chat Panel，但手機端始終呈現 VS Code 的工作區（檔案樹、程式碼編輯器），而非對話內容。
- **診斷結果**：CDP (Chrome DevTools Protocol) 檢測到多個 Target 視窗與多個 Execution Context。

## 2. 根因分析 (Root Cause)

原本的 `captureSnapshot` 邏輯存在以下缺陷：

1. **寬泛的選取器條件**：原本同時支援 `#conversation` (精確) 與 `[role="main"]` (寬泛)。
2. **對手間諜問題**：VS Code 的 Workbench 本身就包含一個 `[role="main"]` 的容器（編輯器區域）。
3. **長度優先誤導**：舊排序算法在雙方都「找到目標」的情況下，優先選擇 HTML 字元數最多的。
   - **Workbench HTML**: ~225KB (勝出)
   - **Chat Panel HTML**: ~10KB
   - 結果：系統一直選擇 225KB 的編輯器畫面，蓋過了真正的對話框。

## 3. 修復方案 (Solution)

引入了 **「匹配品質積分制 (Match Quality Scoring)」**：

### A. 分層匹配策略

在 `core/automation.js` 中將匹配品質分為三級：

- **Exact (3分)**：`#conversation`, `#chat`, `#cascade` (專屬對話器命名號)。
- **Loose (1分)**：`main`, `[role="main"]` (通用區域)。
- **Fallback (0分)**：`body` (兜底)。

### B. 排序優先級更迭

修改 `candidates.sort` 邏輯如下：

1. **優先比對 `matchQuality`**：只要有任何 Context 命中 `Exact` 系列，即便它只有 1KB，也會百分之百排在命中 `Loose` 系列的 200KB Context 前面。
2. **次要比對 HTML 長度**：僅當匹配品質相同時，才比對長度。

## 4. 驗證結果

- 執行 `scripts/diagnose_cdp.js` 確認 Chat Panel 正確回傳 `matchQuality: "exact"`。
- 手機端成功繞過 VS Code Workbench，穩定顯現對話內容。

## 5. 後續參考

若未來再次出現「畫面牛頭不對馬嘴」的情況：

1. 檢查 `core/automation.js` 中的 `exactTarget` 選取器是否需隨 Antigravity 更新而調整。
2. 執行 `node scripts/diagnose_cdp.js` 觀察哪些 Context 命中了什麼等級。
