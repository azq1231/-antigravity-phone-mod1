
import { getOrConnectParams } from '../core/cdp_manager.js';
import { injectImage } from '../core/automation.js';
import fs from 'fs';

async function runE2ETestWithScreenshot() {
    const port = 9001;
    console.log(`--- 🚀 Starting Visual E2E Test on Port ${port} ---`);

    try {
        const conn = await getOrConnectParams(port);
        const cdp = Array.isArray(conn) ? conn[0] : conn;

        if (!cdp) {
            console.error('❌ Failed to connect to port ' + port);
            return;
        }

        // 1. 執行影像 + 文字發送
        const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const testText = "Visual E2E Test " + new Date().toLocaleTimeString();

        console.log(`[Test] Injecting...`);
        const result = await injectImage(conn, testImage, testText);
        console.log(`[Test] Result:`, JSON.stringify(result, null, 2));

        // 2. 等待並截圖
        console.log('[Test] Waiting 5s for UI to update...');
        await new Promise(r => setTimeout(r, 5000));

        const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
        const screenshotPath = `scripts/test_result_port_${port}.png`;
        fs.writeFileSync(screenshotPath, Buffer.from(data, 'base64'));
        console.log(`✅ Screenshot saved to: ${screenshotPath}`);

        // 3. 檢查編輯器內容
        const editorRes = await cdp.call("Runtime.evaluate", {
            expression: `document.querySelector('[data-lexical-editor="true"]').innerText`,
            returnByValue: true
        });
        console.log(`[Debug] Editor text: "${editorRes.result.value}"`);

    } catch (e) {
        console.error('❌ Exception:', e);
    }
    process.exit(0);
}

runE2ETestWithScreenshot();
