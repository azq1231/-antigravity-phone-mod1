# Antigravity Phone Connect - 多設備獨立連線模式說明書

## 1. 功能簡介 (Feature Overview)
本專案已升級至 **V2 多路獨立連線架構**。相對於舊版的「全域廣播」模式，新架構允許不同的設備（手機、平板、電腦瀏覽器）在連接同一個伺服器時，**各自查看不同的 Antigravity 實例 (Port)** 而不互相干擾。

### 核心優點：
- **獨立控制**：手機 A 看 Port 9000，手機 B 看 Port 9001，兩者畫面互不跳轉。
- **智能監控**：伺服器會自動偵測「目前有人在看哪些 Port」，沒人看的 Port 就不會進行後端截圖，節省系統資源。
- **無縫切換**：直接在手機 UI 的 "Instance" 按鈕切換，秒級反應。

---

## 2. 使用方法 (How to Use)

### 第一步：啟動伺服器
請在終端機執行新的 V2 伺服器腳本：
```powershell
node server_multi.js
```
*(註：舊的 `server.js` 仍可運作，但僅支援全域同步模式)*

### 第二步：開啟多個頁面
您可以在多支手機或多個瀏覽器分頁中開啟連線網址（例如 `http://192.168.x.x:3000`）。

### 第三步：各自切換頻道
1. 點擊頂部工具列的 **[Port 9000]** 按鈕。
2. 在彈出的選單中選擇您想導向的 Port（例如 `Port 9001`）。
3. 此時**只有當前這個設備**會切換畫面，其他連線中的設備將保持原樣。

---

## 3. 技術架構說明 (Technical Architecture)

- **入口檔案**：`index.html` (目前設定為引用 `js/app_multi.js`)
- **後端引擎**：`server_multi.js`
    - 使用 `Map` 管理連線狀態。
    - WebSocket 握手時會為每個 Socket 註記 `viewingPort`。
- **前端邏輯**：`js/app_multi.js`
    - 透過 WebSocket 傳送 `switch_port` 指令。
    - 接收後端主動推送到該頻道的 `snapshot_update`。

---

## 4. 如何恢復舊版模式 (Rollback)
如果您希望回到「一台手機改 Port，全世界都同步」的舊模式：
1. 修改 `public/index.html`，將底部的腳本引用改回：
   `<script src="js/app.js"></script>`
2. 停止當前伺服器，改執行：
   `node server.js`

---

## 5. 常見問題 (FAQ)
**Q: 如果選了 Port 9001 卻沒畫面？**
A: 請確認您已經啟動了該 Port 的 Antigravity 實例（例如使用 `launch_instance_9001.bat`）。

**Q: 我切換了 Port，但按鈕顯示沒變？**
A: 請確認伺服器輸出 Log。新版 `app_multi.js` 已修正此問題，若仍發生請嘗試重新整理網頁。

---
*最後更新日期：2026-01-29*
