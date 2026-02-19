# 模型選擇失效與自動化診斷 (2026-02-19)

## 📌 問題描述

在 Antigravity 手機端 UI 中，部分 Claude 模型（特別是 Sonnet 系列）無法透過自動化腳本選中。雖然 Gemini 系列與部分 Claude Opus 正常，但 Sonnet 4.5/4.6 等選項點擊無反應。

## 🔍 根因分析 (Root Cause)

1. **DOM 拆分 (Element Fragmentation)**：部分模型名稱在 HTML 裡不是單一字串，而是被拆分成多個 `<span>`標籤（例如 `<span>Claude</span> <span>Sonnet</span>`）。舊邏輯搜尋 `innerText` 匹配單一標籤時，若標籤太碎則無法找到完整匹配。
2. **特異性不足**：多個選項共享部分關鍵字（如多個 Sonnet 版本）。若只匹配第一個包含關鍵字的標籤，可能點擊到錯誤的非目標元素。
3. **原始碼識別干擾**：當 VS Code 編輯器正開著 `automation.js` 時，腳本搜尋「包含 Claude 字樣的可見標籤」會誤搜尋到「顯示在編輯器裡的原始碼」，導致點擊到代碼編輯器而非真正的模型按鈕。

## 🛠 解決方案

1. **容器關鍵字匹配演算法**：
    * 從目標模型名稱（如 "Claude Sonnet 4.6 (Thinking)"）提取核心關鍵字陣列 `["Sonnet", "4.6"]`。
    * 在 DOM 中搜尋同時包含 **所有** 關鍵字且 **textContent 長度最短** 的元素（通常是最終選項標籤）。
2. **代碼排除過濾器 (Source Code Exclusion)**：
    * 在搜尋過濾器中明確排除長度過長（>150字）或包含 `export async function`, `allEls.filter` 等特徵的標籤。
    * 排除 CSS 類名包含 `monaco` 或 `editor` 的元素。
3. **向上追蹤點擊目標**：
    * 找到目標文字標籤後，若其父元素標籤具備 `cursor: pointer`，優先點擊父容器以確保觸發 UI 事件。

## 🧰 診斷工具

為了以後快速定位類似問題，保留以下腳本：
* `scripts/scan_model_menu.js`: 自動遍歷並輸出下拉選單中所有項目的精確 HTML 結構與 textContent。
* `scripts/test_model_selection.js`: 獨立測試選單定位邏輯，並回傳擬點擊目標的 Metadata（Tag, Class, Role）。

## ⚠️ 注意事項

- 未來若 UI 架構變動（如改用 Shadow DOM），需更新 `Runtime.evaluate` 中的搜尋範圍。
* 始終確保關鍵字提取邏輯已過濾掉 `(Thinking)` 等輔助性標記。
