---
name: antigravity_phone_fix
description: 專門修復 Antigravity 手機端連線、發送失敗、UI 顏色模糊及工作槽位管理的整合技能。
---

# 📱 Antigravity Phone Fix Skill

當手機端出現「發送沒反應」、「文字看不清」、「Waiting for snapshot 很久」、「工作槽位載入失敗」時，請執行此技能。

## 🔍 診斷標準 (Diagnostic Protocol)

### 1. 網路連線診斷

- **路徑**: 訪問 `http://<IP>:3004/debug`。
- **指標**:
  - 伺服器狀態燈號是否為綠色。
  - 控制台是否存在 CORS 或 Network Error。

### 2. 容器與發送器檢測

- **發送失敗回傳**: `editor_not_found`
  - 代表目前的 `findEditor` 選擇器失效。
- **顯示空白**: `No active chat found`
  - 代表 `findChatContainer` 找不到對話流容器。

---

## 🛠️ 修復標準 (Remediation Standards)

### 1. 智慧偵測標準 (Smart Selectors)

禁止使用單一 ID 路徑，必須遵循以下優先順序進行尋找：

- **編輯器**: `Lexical` ➔ `[contenteditable="true"]` ➔ `textarea`。
- **容器**: `[id*="cascade"][class*="overflow"]` ➔ `main` ➔ `.overflow-y-auto`。
- **發送鍵**: `Icon (lucide-send/arrow-right)` ➔ `Aria-label` ➔ `模擬 Enter`。

### 2. 強力顯色標準 (CSS Force Contrast)

為了對抗 Antigravity 頻繁的樣式變動，必須對手機端注入 CSS：

- **作用域**: 使用 `#chatContent *` 或 `#ag-snapshot-content *`。
- **規則**:
  - `color: #f8fafc !important` (強制亮白)。
  - `background-color: transparent !important` (強制透明背景)。
  - `text-shadow` 增加可視度。

### 3. 初始化同步標準

- **行為**: `DOMContentLoaded` 觸發後，必須「立即」執行 `fetchAppState().then(loadSnapshot)`。
- **禁忌**: 不可單純依賴 `setInterval` 進行第一次載入。

---

## 📜 常用修復代碼段 (Code Snippets)

### 伺服器端抓取邏輯 (Capture Logic)

使用此邏輯替代原本的 `getElementById('cascade')`：

```javascript
const findChatContainer = () => {
    const cascade = document.getElementById('cascade');
    if (cascade) return cascade;
    const cascadeLike = document.querySelector('div[id*="cascade"][class*="overflow"]');
    if (cascadeLike) return cascadeLike;
    return document.body;
};
```

### 前端強力 CSS 注入

```javascript
'* { color: #f8fafc !important; background-color: transparent !important; }'
```

---

## 🚀 執行流程

1. **讀取** 此 `SKILL.md`。
2. **執行** `/debug` 進行自動診斷。
3. **檢查** `server.js` 的路由完整性（補回 `/slots`）。
4. **套用** `templates/` 下的強化腳本。
5. **重啟** 伺服器。
