# 待解決問題 (Pending Issues)

這份文件記錄了系統中已發現但尚未修復的問題、根本原因分析以及預定的解決方案。

---

## 📅 2026-03-05: Port 9001 模型顯示誤判 (Claude vs Gemini)

### 🔴 問題現象 (The Symptom)

在 Port 9001 實例中，明明選擇的是 `Gemini 3 Flash`，但手機端 UI 卻顯示為 `Claude`。此現象非全域發生，通常侷限於 Port 9001 或特定的排列佈局。

### 🔍 根本原因 (Root Cause)

經過對 `core/automation.js` 的 `getAppState` 函數分析，發現當前的「模型名稱掃描機制」存在漏洞：

1. **精確偵測失效**：在 Port 9001 中，由於視窗寬度或 UI 摺疊，系統未能從標準工具欄 (`.flex.items-center.gap-0-5`) 抓取到正確的模型標籤。
2. **全局掃描干擾 (Sidebar Interference)**：
    * 系統自動進入「全局備援搜尋」模式，掃描頁面中所有包含 `Claude` 或 `Gemini` 字樣的元素。
    * **禁區漏缺**：目前的 `isForbidden` 函數僅排除了編輯器 (`.monaco-editor`)、終端機、通知區等，但**未排除側邊欄 (`.part.sidebar`)**。
    * **側邊欄內容**：若側邊欄的歷史對話標題中包含 "Claude"（例如：`Claude vs Gemini 分析`），掃描器會誤將其判定為目前的活動模型並回報給手機端。

### 🛠️ 預定修復方案 (Proposed Solution)

1. **擴展禁區 (Forbidden Zones)**：修改 `core/automation.js` 中的 `isForbidden` 函數，將側邊欄相關類名（如 `.part.sidebar`, `.composite.sidebar`）納入禁區，防止其內容干擾狀態偵測。
2. **強化工具欄選取**：研究在不同佈局下更穩定的模型名稱定位器（例如透過特定的 ARIA 標籤）。

---
