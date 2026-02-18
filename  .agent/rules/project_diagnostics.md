# 📱 Antigravity Phone Chat 專案開發規範 (Project Specific Rules)

本文件定義了此專案特有的開發與偵錯行為準則，補充並強化 Global Rules。

## 🚨 核心行為：環境優先診斷 (Environment-First Diagnostics)

本專案運行於複雜的 Electron (VS Code) 載體中，存在多個 CDP Targets 與 Execution Contexts。**嚴禁在未確認「現場狀態」前修改核心自動化邏輯。**

### 1. 診斷強制執行流程

當用戶回報「看不見畫面」、「點擊沒反應」或「Snapshot 錯誤」時：

1. **禁止動作**：嚴禁立即修改 `core/automation.js` 或 `core/cdp_manager.js`。
2. **強制動作**：必須先執行 `scripts/diagnose_cdp.js`（或撰寫等價的診斷腳本）。
3. **分析指標**：必須在日誌中列出：
   - 發現了幾個 Page 類型的 Target。
   - 哪一個 Target 的 Context 包含 `#conversation` 或 `lexical` 元素。
   - 目前系統選取的 `matchQuality` 是什麼等級（Exact, Loose, 或 Fallback）。

### 2. 視窗選取優先級 (Target Selection)

在修改連線邏輯時，必須遵守以下優先級（由高至低）：

1. **Exact 匹配**：包含關鍵對話 ID (`#conversation`, `#chat`, `#cascade`) 的 Context。
2. **URL 匹配**：包含 `cascade-panel.html` 的 Context。
3. **Loose 匹配**：一般的 `main` 或 `role="main"` 區域。
4. **最後手段**：`body` 或 HTML 長度優先。
*注意：永遠不要只依賴 HTML 長度，因為 VS Code Workbench 的 HTML 通常比對話區域大 20 倍以上。*

### 3. 多重實例管理

- 專案支援多個 Slot (Port 9000~9003)。
- 偵錯時必須確認用戶目前正在操作的埠號，避免「在 A 埠改 B 埠的問題」。

### 4. 交付前的「回頭驗證」

在宣告 Bug 修復後，必須再次執行診斷腳本，確認 `foundTarget` 與 `matchQuality` 為預期的 `exact` 狀態，並輸出快照摘要。

---
*本規則由 Antigravity 於 2026-02-18 根據 Target 誤判事件結案後建立，具備最高修復指導效力。*
