
import { getOrConnectParams } from '../core/cdp_manager.js';

async function testInjection() {
    const port = 9001;
    console.log('--- 🧪 Small Image Injection Test ---');
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;

    if (!cdp) {
        console.log('No connection on 9001');
        return;
    }

    // A tiny 1x1 red PNG
    const base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const text = "TEST_TEXT";

    const SCRIPT = `(async () => {
        const target = document.querySelector('[data-lexical-editor="true"]');
        if (!target) return "No Editor";
        
        target.focus();
        
        const parts = "\${base64}".split(',');
        const byteString = atob(parts[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: 'image/png' });
        const file = new File([blob], "test.png", { type: 'image/png' });

        const dt = new DataTransfer();
        dt.items.add(file);
        Object.defineProperty(dt, 'files', { value: [file], writable: false });

        console.log('Dispatching test paste...');
        target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
        
        return "Dispatched";
    })()`;

    try {
        const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, awaitPromise: true });
        console.log('Result:', res.result);

        await new Promise(r => setTimeout(r, 2000));

        const check = await cdp.call("Runtime.evaluate", {
            expression: '({img: document.querySelectorAll("img").length, html: document.querySelector("[data-lexical-editor=\\\"true\\\"]").innerHTML})',
            returnByValue: true
        });
        console.log('Check:', check.result.value);
    } catch (e) {
        console.log('Error:', e.message);
    }
    process.exit(0);
}

testInjection();
