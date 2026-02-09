---
description: 當用戶輸入「修復系統」或「/fix」時，執行 Antigravity 手機端的全自動修復流程。
---

// turbo-all

1. **執行診斷**：執行 `.agent/skills/antigravity_phone_fix/diagnose.ps1` 檢查當前狀態。
2. **自動校準**：
    - 檢查 `server.js` 是否包含 `/slots` 與 `/debug` 路由。
    - 檢查 `server.js` 是否使用強化版的容器偵測邏輯 (`findChatContainer`) 與發送偵測邏輯 (`findEditor`, `findSubmitBtn`)。
    - 檢查 `public/js/app_multi.js` 是否包含強力顯色 CSS 與「開門見山」載入邏輯。
3. **強制更新**：如果上述任何一項缺失，立即從 `antigravity_phone_fix` 技能中提取標準代碼進行覆蓋。
4. **重置行程**：強制清理 Port 3004 上的 Node 行程。
5. **重啟服務**：在背景重新啟動伺服器。
6. **最終驗證**：回報修復結果並請用戶查看手機。
