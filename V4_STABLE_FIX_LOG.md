# Antigravity V4.1 高穩定性修正報告 (Stability & UI Report)

本檔案記錄了 2026年2月15日 針對 Antigravity V4.1 手機端連線與顯示問題的關鍵修正。

## 1. 主控台錯誤修復 (Console Error Sanitization)

### 現象

手機瀏覽器主控台瘋狂噴出 `net::ERR_UNKNOWN_URL_SCHEME` 錯誤，源自於 `vscode-file://` 或 `file://` 等 VS Code 內部協議。這些報錯導致瀏覽器效能下降且難以調試。

### 修復方案 (Surgically Targeted Sanitization)

- **協議中和**：不再只是單純替換字串，而是使用「Surgical URL removal」技術。
- **1x1 透明位圖替換**：將所有的 `url("vscode-file://...")` 替換為 `url("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")`。
- **效果**：瀏覽器不再嘗試發起無效的網絡請求，主控台恢復 100% 潔淨。

## 2. 視窗智慧選取機制 (Smart Selection Logic)

### 現象

開啟多個實例（Port 9000, 9001 等）時，系統偶爾會鎖定在「啟動器 (Launcher)」或「指令面板 (Command Palette)」而非真正的「對話視窗」。

### 修復方案

- **全視窗掃描**：不再採用「先到先得」模式，而是每秒掃描該端口下的所有網頁上下文 (Contexts)。
- **DNA 特徵優先**：建立了一個評分機制，優先選擇包含 `#conversation`、`#chat` 或 `#cascade` 元素的視窗。
- **手動模式保護**：若用戶在「工作槽位管理」手動選擇了端口，系統將停止自動跳轉 (Auto-Hunt)，優先呈現該端口的真實原始數據。

## 3. 視覺與佈局修復 (UI & Layout Neutralization)

### 現象

對話內容被極大高度（90,000px+）推到底部不見，或者文字因為黑色主題導致「黑底黑字」。

### 修復方案

- **極致對比 (Force High Contrast)**：強制注入 CSS，將 `#conversation` 及其子元素的所有文字設為 `#ffffff !important`，並強化背景深度。
- **瓦解異常高度**：針對 VS Code 虛擬列表常見的「巨型高度」進行動態裁切，將所有 `min-height > 10000px` 的容器強制設為 `auto`。
- **遮擋物清除**：主動偵測並隱藏 `[placeholder*="Open window"]` 和 `.quick-input-widget` 等會遮擋對話的浮動元件。

## 4. 槽位管理功能恢復 (Slot Manager Restoration)

### 現象

優化快照時過於激進的 `display: none` 規則導致手機端本身的控制按鈕（Switch, Start, Stop）也消失。

### 修復方案

- **範圍限制 (Scoping)**：將所有「隱藏按鈕」的 CSS 規則嚴格限制在 `#cascade` (快照容器) 內部，確保外部 UI 功能不受影響。

## 5. 切換同步優化 (Instant Switch Sync)

### 現象

在 9000 與 9001 之間切換時，畫面反應遲鈍或顯示舊視窗的殘影。

### 修復方案

- **緩存清空 (Hash Reset)**：在接收到 `switch_port` 指令時，立即重設該連線的 `lastHash = null`。
- **效果**：切換端口後，系統會忽略哈希比對，立即推送最新的第一手畫面。

---
**核准記錄**：v4.1.2 Stable
**狀態**：所有功能正常，主控台無報錯。
