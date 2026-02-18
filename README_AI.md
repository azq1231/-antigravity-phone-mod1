# Antigravity Phone Chat - AI 開發指引

## 🛠 專案架構

- **核心**: Node server (server_v4.js) 透過 CDP 連接 Antigravity (VS Code)。
- **通訊**: 手機端透過 WebSocket (Port 3004) 接收快照與發送指令。
- **機制**: 採用快照 (Snapshot) 擷取方式，將桌面端 UI 轉譯至手機端。

## ⚠️ 開發重要規範 (Critical)

在開始進行任何 Bug 修復或功能開發前，**請務必閱讀並遵循以下規則**：

- **專案專屬偵錯規範**: `.agent/rules/project_diagnostics.md`
- **全局行為準則**: 請參考系統中的 Global Rules。

## 🔍 診斷工具

- `scripts/diagnose_cdp.js`: 用於解決視窗抓取不到、Context 偏移等問題。

---
*讀取完此文件後，若要處理顯示/連線問題，請優先執行一次診斷。*
