
import { getOrConnectParams } from '../core/cdp_manager.js';

async function testImageInjection() {
    console.log('[TEST] Connecting to Port 9000...');
    const conn = await getOrConnectParams(9000);
    if (!conn) {
        console.error('[TEST] Failed to connect to Port 9000');
        return;
    }

    // A tiny 1x1 red pixel base64 image
    const base64Image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const INJECT_SCRIPT = `(() => {
        const els = Array.from(document.querySelectorAll('div[contenteditable], textarea, input[type="text"]'));
        return els.map(el => ({
            tag: el.tagName,
            id: el.id,
            class: el.className,
            lexical: el.getAttribute('data-lexical-editor'),
            offsetParent: el.offsetParent !== null // Check visibility
        }));
    })()`;

    console.log('[TEST] Scanning for editors...');
    for (const cdp of conn) {
        // Handle both single connection object and array of CDPs
        const target = cdp.contexts ? cdp : (Array.isArray(conn) ? conn[0] : conn);
        const contexts = target.contexts || [];

        if (contexts.length === 0) console.log('[TEST] No contexts found!');

        for (const ctx of contexts) {
            console.log(`[TEST] Context ${ctx.id} scan:`);
            try {
                const res = await target.call("Runtime.evaluate", {
                    expression: INJECT_SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });

                if (res.result.value) {
                    console.log(JSON.stringify(res.result.value, null, 2));
                }
            } catch (e) {
                console.error('[TEST] Scan failed:', e);
            }
        }
    }
    process.exit(0);
}

testImageInjection();
