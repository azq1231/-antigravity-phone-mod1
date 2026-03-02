
import { getOrConnectParams } from '../core/cdp_manager.js';

async function verify() {
    const ports = [9000, 9001, 9002, 9003];
    console.log('--- 🛡️ Editor Content Verification (ESM) ---');

    for (const port of ports) {
        try {
            const conn = await getOrConnectParams(port);
            // cdp_manager may return an array for multiple contexts or a single object
            const cdp = Array.isArray(conn) ? conn[0] : conn;

            if (!cdp) {
                console.log(`Port \${port}: No connection`);
                continue;
            }

            const SCRIPT = `(() => {
                const editor = document.querySelector('[data-lexical-editor="true"]');
                if (!editor) return "No Editor";
                return {
                    text: editor.innerText.substring(0, 50),
                    imgCount: editor.querySelectorAll('img').length,
                    chips: editor.querySelectorAll('[class*="chip"], [class*="Image"]').length,
                    html: editor.innerHTML.substring(0, 100)
                };
            })()`;

            const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            console.log(`Port \${port}:`, res.result.value);
        } catch (e) {
            console.log(`Port \${port}: Error - \${e.message}`);
        }
    }
    process.exit(0);
}

verify();
