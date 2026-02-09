# 間歇性訊息發送失敗分析報告

## 🔍 問題描述

訊息發送功能**有時正常,有時失敗**,屬於間歇性問題。

## 📊 已知的間歇性失敗原因

### 1. ⏰ **Antigravity 正在生成回應 (busy)**

**發生機率**: 高 ⭐⭐⭐⭐⭐

**原因**:

```javascript
// server.js 第 327-328 行
const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };
```

當 Antigravity 正在生成回應時,會顯示「取消」按鈕,此時無法發送新訊息。

**症狀**:

- 發送按鈕顯示 "AI 思考中...(X/25)"
- 前端會自動重試最多 25 次
- 每次重試間隔 2-6 秒

**解決方案**:

- ✅ 已實作自動重試機制 (app_multi.js 第 794-799 行)
- 等待當前回應完成後會自動發送

---

### 2. 🎯 **編輯器元素未找到 (editor_not_found)**

**發生機率**: 中 ⭐⭐⭐

**原因**:

```javascript
// server.js 第 330-333 行
const editors = [...document.querySelectorAll('#cascade [data-lexical-editor="true"][contenteditable="true"][role="textbox"]')]
    .filter(el => el.offsetParent !== null);
const editor = editors.at(-1);
if (!editor) return { ok:false, error:"editor_not_found" };
```

可能的觸發情境:

1. **Antigravity 介面剛載入,DOM 還未完全渲染**
2. **Antigravity 切換到其他頁面** (例如設定頁、檔案瀏覽器)
3. **編輯器被隱藏或移除** (例如開啟 modal)

**症狀**:

- 發送失敗,但不會自動重試
- 前端會觸發 `loadSnapshot()` 重新載入介面

**解決方案**:

- 確保 Antigravity 停留在對話頁面
- 如果失敗,重新整理 Antigravity

---

### 3. 🔌 **CDP 執行上下文遺失 (no_context)**

**發生機率**: 低 ⭐⭐

**原因**:

```javascript
// server.js 第 364-377 行
for (const ctx of cdp.contexts) {
    try {
        const result = await cdp.call("Runtime.evaluate", {...});
        if (result.result && result.result.value) {
            return result.result.value;
        }
    } catch (e) { }
}
return { ok: false, reason: "no_context" };
```

可能的觸發情境:

1. **Antigravity 重新載入頁面**
2. **CDP WebSocket 連線中斷**
3. **執行上下文被清除** (例如頁面導航)

**症狀**:

- 所有上下文都無法執行 JavaScript
- 需要重新連線 CDP

**解決方案**:

- 重新啟動伺服器或 Antigravity

---

### 4. ⏱️ **CDP 呼叫逾時 (30 秒)**

**發生機率**: 低 ⭐

**原因**:

```javascript
// server.js 第 160 行
const CDP_CALL_TIMEOUT = 30000; // 30 seconds timeout
```

如果 CDP 呼叫超過 30 秒沒有回應,會逾時失敗。

**可能觸發情境**:

- Antigravity 凍結或無回應
- 系統資源不足

---

### 5. 🌐 **網路連線問題 (Tailscale)**

**發生機率**: 中 ⭐⭐⭐

**Tailscale 特有問題**:

1. **連線延遲**: Tailscale 路由可能間歇性變慢
2. **封包遺失**: 網路品質不穩定
3. **連線切換**: 在 Wi-Fi 和 4G 之間切換時

**症狀**:

- 請求逾時
- 連線錯誤
- 長時間無回應

**診斷方法**:

```powershell
# 測試 Tailscale 連線品質
ping <tailscale_ip> -n 20
```

---

## 🛠️ 建議的改進方案

### 方案 1: 增強錯誤回報 (立即可行)

在前端顯示更詳細的錯誤訊息:

```javascript
// app_multi.js 修改建議
if (data?.reason === "busy") {
    console.log('[SEND] Antigravity 忙碌中,自動重試...');
} else if (data?.error === "editor_not_found") {
    console.error('[SEND] 找不到編輯器!請確認 Antigravity 在對話頁面');
    alert('⚠️ 找不到輸入框,請確認 Antigravity 介面正常');
} else if (data?.reason === "no_context") {
    console.error('[SEND] CDP 上下文遺失!');
    alert('❌ 連線異常,請重新整理頁面');
}
```

### 方案 2: 增加編輯器檢測重試 (建議實作)

當 `editor_not_found` 時,也應該自動重試:

```javascript
// server.js 修改建議
const shouldRetry = (
    data?.reason === "busy" || 
    data?.error === "editor_not_found" ||  // 新增
    data?.reason === "no_context"           // 新增
) && retryCount < 25;
```

### 方案 3: 增加健康檢查端點

定期檢查 CDP 連線狀態:

```javascript
// 新增 /health 端點
app.get('/health', (req, res) => {
    res.json({
        cdp_connected: !!cdpConnection,
        contexts_count: cdpConnection?.contexts?.length || 0,
        last_snapshot: lastSnapshot ? 'OK' : 'None'
    });
});
```

---

## 📝 診斷步驟 (下次失敗時執行)

1. **立即檢查瀏覽器控制台** (F12 → Console)
   - 記錄錯誤訊息
   - 查看 Network 標籤的 `/send` 請求狀態

2. **檢查伺服器日誌**

   ```powershell
   Get-Content server.log -Tail 50 | Select-String "error|send|CDP"
   ```

3. **測試 CDP 連線**

   ```powershell
   curl http://127.0.0.1:9000/json/list
   ```

4. **檢查 Antigravity 狀態**
   - 是否在對話頁面?
   - 是否正在生成回應?
   - 輸入框是否可見?

5. **測試後端 API**

   ```powershell
   $body = @{message="測試"} | ConvertTo-Json
   Invoke-WebRequest -Uri "http://localhost:3004/send?port=9000" -Method POST -Body $body -ContentType "application/json"
   ```

---

## 🎯 最可能的原因 (根據您的情況)

基於您使用 **Tailscale** 和問題是**間歇性**的,最可能的原因是:

1. **Antigravity 正在生成回應** (busy) - 60%
2. **Tailscale 網路延遲/不穩定** - 25%
3. **編輯器元素未找到** (介面切換) - 10%
4. **其他** - 5%

---

## ✅ 下次失敗時請提供

1. 瀏覽器控制台的錯誤訊息 (截圖或文字)
2. 發送按鈕的狀態 (載入中?錯誤?無反應?)
3. Antigravity 當時的狀態 (正在生成?在哪個頁面?)
4. 是否透過 Tailscale 連線
5. 網路環境 (Wi-Fi? 4G?)

這樣我就能精準定位問題!
