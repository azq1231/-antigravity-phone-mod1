
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    console.log('--- 🧪 Advanced Image Injection Diagnosis ---');
    const conn = await getOrConnectParams(9001);
    const cdp = Array.isArray(conn) ? conn[0] : conn;

    if (!cdp) {
        console.error('Failed to connect to browser on port 9001');
        return;
    }

    // 使用一個極小的 Base64 圖片進行測試，排除數據大小干擾
    const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const SCRIPT = `(async () => {
        const results = [];
        const check = (tag) => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            results.push({
                step: tag,
                hasEditor: !!editor,
                imgCount: document.querySelectorAll('img').length,
                chips: document.querySelectorAll('[class*="chip"], [class*="Image"]').length,
                selection: !!window.getSelection()?.anchorNode
            });
        };

        try {
            const target = document.querySelector('[data-lexical-editor="true"]');
            if (!target) return { error: "No editor" };

            target.focus();
            check('After Focus');

            // 擬造文件
            const parts = "${testImage}".split(',');
            const byteString = atob(parts[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: 'image/png' });
            const file = new File([blob], "diag.png", { type: 'image/png' });

            const dt = new DataTransfer();
            dt.items.add(file);
            Object.defineProperty(dt, 'files', { value: [file], writable: false });

            // 執行注入
            target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
            check('Immediately after Paste');

            await new Promise(r => setTimeout(r, 1000));
            check('1s after Paste');

            return { success: true, timeline: results };
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

diagnose();
