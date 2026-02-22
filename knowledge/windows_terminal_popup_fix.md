# 故障回顧：Windows 環境下 API 調用導致終端機視窗彈出

## 1. 現象描述

用戶點擊前端 UI（Slot Manager）時，電腦桌面上會瞬間跳出 **4 個** 終端機（CMD/PowerShell）視窗並隨即關閉，導致系統操作感極差且有不穩定的錯覺。

## 2. 診斷誤區 (Retrospective Failures)

* **初期誤判**：將用戶描述的「視窗」誤認為是網頁前端的 **Modal (彈窗)**。
* **過度假設**：假設是因為 JavaScript 事件綁定重複、標題 MutationObserver 衝突，或 CSS 動畫重播導致的 UI 閃動。
* **診斷受限**：由於診斷工具 `browser_subagent` 只能看到瀏覽器內部的 DOM 狀態，無法看到操作系統層面的「視窗跳動」，導致一直無法重現用戶看到的現象。

## 3. 根因分析 (Root Cause)

* **觸發源**：前端點擊標題會呼叫 `/slots` API。
* **邏輯鏈**：`/slots` -> `findAllInstances()` -> 迴圈 4 個 Port -> `isPortInUse(port)`。
* **致命細節**：在 `core/utils.js` 中，`isPortInUse` 使用了 Node.js 的 `child_process.exec()` 來執行 `netstat` 命令。
* **環境特性**：在 Windows 系統中，`exec()` 默認會創建一個 Shell (cmd.exe) 來執行命令。雖然它很快就關閉了，但在某些環境下（如桌面直接運行或特定的 Node 配置）會導致明顯的視窗閃現。

## 4. 解決方案 (Fix)

* **策略方案**：廢棄外部指令依賴，改用 Node.js 原生 API。
* **具體做法**：使用 `net.createServer().listen(port)` 的方式來偵測 Port 是否被佔用。
  * 能成功監聽：Port 為空（非佔用）。
  * 拋出 `EADDRINUSE`：Port 被佔用。
* **優點**：完全在 Node 進程內完成，**零視窗彈出**，且效能比執行外部命令快 10 倍以上。

## 5. 預防措施 (Future Prevention)

* **跨環境意識**：在 Windows 上開發時，嚴禁在 API 常規路徑中頻繁使用 `exec`。若必須使用，應考慮 `spawn` 的背景參數或第三方函式庫。
* **名詞對齊**：未來若用戶提到「視窗彈出」，必須優先詢問是「瀏覽器彈窗」還是「操作系統視窗」。
