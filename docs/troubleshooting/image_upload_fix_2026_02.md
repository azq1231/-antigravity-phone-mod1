# 圖片上傳修復紀錄 (2026-02-11)

## 1. 問題描述 (Problem Description)

Antigravity 手機端聊天介面無法上傳圖片。雖然前端顯示上傳成功，但圖片未能正確注入到目標編輯器（VS Code Webview / Lexical Editor）中，或者傳送按鈕未能被觸發。

## 2. 症狀 (Symptoms)

- 使用者選擇圖片後，介面無反應或圖片未出現。
- 後端自動化日誌顯示 `execCommand failed: TypeError: Failed to execute 'execCommand' on 'Document': This document requires 'TrustedHTML' assignment.`。
- `Paste` 事件觸發後，編輯器內容無變化（`img` 標籤未增加）。
- 傳送按鈕（尤其是僅有圖示的按鈕）未能被腳本識別，導致最後只能退回使用 `Enter` 鍵模擬。

## 3. 診斷過程 (Diagnosis Steps)

1. **環境確認**：VS Code 的 Webview 運行在 Electron 環境中，具有嚴格的 `Trusted Types` 安全策略，禁止將未經處理的 HTML 字串直接賦值給 `innerHTML` 或透過 `execCommand('insertHTML')` 插入。
2. **上下文隔離**：透過 CDP (Chrome DevTools Protocol) 發現頁面存在多個執行上下文（Execution Contexts），必須在正確的上下文（通常是包含 `Lexical` 編輯器的那個）中執行腳本。
3. **事件無效**：單純觸發 `paste` 事件有時因 DataTransfer 物件缺少 `files` 屬性（由瀏覽器安全限制導致）而被編輯器忽略。

## 4. 解決方案 (Solution)

### A. 繞過 Trusted Types 限制

放棄使用 `document.execCommand('insertHTML')`，改用標準 DOM API 創建元素並插入。這能避開字串過濾器的檢查。

```javascript
// 舊方法 (失敗):
// document.execCommand('insertHTML', false, `<img src="${base64Data}">`);

// 新方法 (成功):
const img = document.createElement('img');
img.src = base64Data;
// ...設定樣式...
target.appendChild(img); // 或使用 Range API 插入游標處
```

### B. 強化 DataTransfer 物件

在建構 `DataTransfer` 時，手動定義 `files` 屬性，以滿足某些框架（如 React/Lexical）對檔案拖放的檢查機制。

```javascript
const dt = new DataTransfer();
dt.items.add(file);
try {
    Object.defineProperty(dt, 'files', { value: [file], writable: false });
} catch(e) {}
```

### C. 多重上下文遍歷

修改 `automation.js` 中的 `injectImage` 函數，使其遍歷所有 CDP 上下文，直到找到有效的編輯器並成功注入圖片。

### D. 優化傳送按鈕偵測

更新按鈕選擇器，加入對常見圖示庫（如 `lucide`）的支援，不只依賴文字標籤。

```javascript
// 支援 svg.lucide-arrow-right, svg.lucide-send 等
return /send|submit|發送|送出/i.test(txt) || b.querySelector('svg[class*="send"], ...');
```

## 5. 未來維護指引 (Future Reference)

若圖片上傳功能再次失效，請依序檢查：

1. **Trusted Types**：檢查目標應用是否啟用了更嚴格的 CSP 策略。如果是，確保所有 DOM 操作都使用 `createElement`/`appendChild`。
2. **編輯器架構**：确認目標是否更換了編輯器框架（如從 Lexical 換成 Monaco 或 Quill）。若是，需更新 `selector`（目前鎖定 `[data-lexical-editor="true"]`）。
3. **按鈕選擇器**：若介面改版，需更新 `findSend` 函數中的選擇器列表。
4. **上下文變更**：Electron 版本更新可能改變 Webview 的上下文結構，需透過 `diagnose_selectors.js` 重新確認。

## 6. 相關檔案

- `core/automation.js`: 核心自動化邏輯（注入、截圖、傳送）。
- `server_v4.js`: 後端伺服器，負責協調 CDP 連線。
