
import { getOrConnectParams } from '../core/cdp_manager.js';
import { injectImage } from '../core/automation.js';

async function runE2ETest() {
    const port = 9001; // 測試常用的 9001 端口
    console.log(`--- 🚀 Starting Full E2E Image+Text Send Test on Port ${port} ---`);

    try {
        const conn = await getOrConnectParams(port);
        const cdp = Array.isArray(conn) ? conn[0] : conn;

        if (!cdp) {
            console.error('❌ Failed to connect to port ' + port);
            process.exit(1);
        }

        // 1. 紀錄發送前的訊息數量
        const getMsgCount = async () => {
            const res = await cdp.call("Runtime.evaluate", {
                expression: `document.querySelectorAll('[class*="ChatMessage"], [class*="message-row"]').length`,
                returnByValue: true
            });
            return res.result.value || 0;
        };

        const initialCount = await getMsgCount();
        console.log(`[Test] Initial message count: ${initialCount}`);

        // 2. 執行影像 + 文字發送 (使用一小段透明 PNG)
        const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const testText = "E2E Speed Test " + new Date().toLocaleTimeString();

        console.log(`[Test] Sending Image and Text: "${testText}"...`);
        const startTime = Date.now();
        const result = await injectImage(conn, testImage, testText);
        const duration = Date.now() - startTime;

        console.log(`[Test] Injection result:`, JSON.stringify(result, null, 2));
        console.log(`[Test] Total Time Spent: ${(duration / 1000).toFixed(2)}s`);

        // 3. 等待實體發送完成 (Lexical 解析與網絡請求時間)
        console.log('[Test] Waiting for chat history update...');
        await new Promise(r => setTimeout(r, 3000));

        // 4. 驗證結果
        const finalCount = await getMsgCount();
        console.log(`[Test] Final message count: ${finalCount}`);

        if (finalCount > initialCount) {
            console.log('✅ SUCCESS: Message count increased. Send confirmed.');
        } else {
            console.error('❌ FAILURE: Message count did not increase within timeout.');
            // 進階檢查：是否還留在編輯器裡？
            const editorRes = await cdp.call("Runtime.evaluate", {
                expression: `document.querySelector('[data-lexical-editor="true"]').innerText`,
                returnByValue: true
            });
            console.log(`[Debug] Editor current text: "${editorRes.result.value}"`);
        }

    } catch (e) {
        console.error('❌ E2E Test Exception:', e);
    }

    process.exit(0);
}

runE2ETest();
