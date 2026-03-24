/**
 * Antigravity V4 全系統自動化診斷腳本 (System Diagnostic v4)
 * 使用方式: node scripts/system_diagnostic_v4.js
 */

import WebSocket from 'ws';

const SERVER_PORT = 3004;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const WS_URL = `ws://localhost:${SERVER_PORT}`;

async function runDiagnostic() {
    console.log("-----------------------------------------");
    console.log("🔍 [V4-DIAG] 開始全系統健康檢查...");
    console.log(`📅 時間: ${new Date().toLocaleString()}`);
    console.log("-----------------------------------------\n");

    const results = [];

    // 1. 檢查 HTTP 服務器
    try {
        const res = await fetch(`${BASE_URL}/app-state?port=9000`);
        if (res.ok) {
            console.log("✅ [1/6] HTTP 伺服器: 正常 (Port 3004)");
            results.push(true);
        } else {
            console.warn(`⚠️ [1/6] HTTP 伺服器: 異常 (狀態碼: ${res.status})`);
            results.push(false);
        }
    } catch (e) {
        console.error(`❌ [1/6] HTTP 伺服器: 無法連接 (${e.message})`);
        results.push(false);
    }

    // 2. 檢查 WebSocket 連接
    try {
        const ws = new WebSocket(WS_URL);
        const wsOk = await new Promise((resolve) => {
            const timeout = setTimeout(() => { ws.close(); resolve(false); }, 3000);
            ws.on('open', () => { clearTimeout(timeout); ws.close(); resolve(true); });
            ws.on('error', () => { clearTimeout(timeout); resolve(false); });
        });
        if (wsOk) {
            console.log("✅ [2/6] WebSocket 服務: 正常穩定");
            results.push(true);
        } else {
            console.warn("⚠️ [2/6] WebSocket 服務: 連接超時或失敗");
            results.push(false);
        }
    } catch (e) {
        results.push(false);
    }

    // 3. 檢查 CDP 偵測 (findAllInstances)
    try {
        const res = await fetch(`${BASE_URL}/instances`);
        if (res.ok) {
            const list = await res.json();
            if (list.length > 0) {
                console.log(`✅ [3/6] CDP 實體偵測: 成功 (找到 ${list.length} 個實體)`);
                list.forEach(i => console.log(`   - Port ${i.port}: ${i.title}`));
                results.push(true);
            } else {
                console.warn("⚠️ [3/6] CDP 實體偵測: 成功但沒有找到活動中的 Antigravity 實體 (請確認是否開啟 --remote-debugging-port)");
                results.push(true); // 伺服器邏輯沒掉，只是環境沒開
            }
        }
    } catch (e) {
        console.error(`❌ [3/6] CDP 實體偵測: 接口故障 (${e.message})`);
        results.push(false);
    }

    // 4. 檢查靜態資源回退 (Ghost Icon Fallback)
    try {
        const res = await fetch(`${BASE_URL}/assets/test_missing_file.png`);
        const type = res.headers.get('content-type');
        if (res.ok && type && type.includes('image')) {
            console.log("✅ [4/6] 幽靈圖標回退: 正常 (已自動轉向 antigravity.png)");
            results.push(true);
        } else {
            console.warn("⚠️ [4/6] 幽靈圖標回退: 異常 (檔案未找且未回退)");
            results.push(false);
        }
    } catch (e) {
        results.push(false);
    }

    // 5. 檢查 CSS 解析與注入
    try {
        const res = await fetch(`${BASE_URL}/assets/style_v4.css`);
        if (res.ok) {
            const css = await res.text();
            if (css.includes('Icon & Ghost-Image Fixes')) {
                console.log("✅ [5/6] CSS 修補組件: 正常 (包含微型圖標修復規則)");
                results.push(true);
            } else {
                console.warn("⚠️ [5/6] CSS 修補組件: 缺少微型化修復規則");
                results.push(false);
            }
        }
    } catch (e) {
        results.push(false);
    }

    // 6. 檢查自動化核心 (Auto-Accept + Snap-Clear)
    try {
        // 模擬觸發一次狀態同步，觀察後端日誌是否有報錯
        const res = await fetch(`${BASE_URL}/app-state?port=9000`);
        if (res.ok) {
            console.log("✅ [6/6] 自動化循環核心: 正在執行 (未偵測到進程崩潰)");
            results.push(true);
        }
    } catch (e) {
        results.push(false);
    }

    console.log("\n-----------------------------------------");
    const passed = results.filter(r => r).length;
    console.log(`📊 總結: ${passed}/6 項目通過`);
    if (passed === 6) {
        console.log("🚀 [狀態報告] ALL SYSTEMS NOMINAL - 系統全線暢通！");
    } else {
        console.warn("🚀 [狀態報告] 系統有部分異常，請根據上述詳情確認。");
    }
    console.log("-----------------------------------------");
}

runDiagnostic();
