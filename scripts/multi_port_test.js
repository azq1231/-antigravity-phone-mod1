
import { getOrConnectParams, findAllInstances } from '../core/cdp_manager.js';
import { injectImage } from '../core/automation.js';

async function multiPortTest() {
    console.log('--- 🧪 Multi-Port Automated Send Verification ---');
    const instances = await findAllInstances();
    const ports = instances.map(inst => inst.port);

    if (ports.length === 0) {
        console.error('❌ No active Antigravity instances found.');
        return;
    }

    console.log(`Found ports: ${ports.join(', ')}`);

    for (const port of ports) {
        console.log(`\n[Testing Port ${port}]`);
        try {
            const conn = await getOrConnectParams(port);

            // 1. Get initial count
            const cdp = Array.isArray(conn) ? conn[0] : conn;
            const getCount = async () => {
                const res = await cdp.call("Runtime.evaluate", {
                    expression: `document.querySelectorAll('[class*="ChatMessage"], [class*="message-row"]').length`,
                    returnByValue: true
                });
                return res.result.value || 0;
            };

            const initial = await getCount();

            // 2. Inject
            const testImg = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
            const testMsg = `Final Multi-Port Verification (Port ${port}) @ ${new Date().toLocaleTimeString()}`;

            const result = await injectImage(conn, testImg, testMsg);
            console.log(`  - Injection: ${result.ok ? '✅' : '❌'} (${result.method})`);

            // 3. Wait and check
            await new Promise(r => setTimeout(r, 4000));
            const final = await getCount();

            if (final > initial) {
                console.log(`  - Result: ✅ SUCCESS (Message sent)`);
            } else {
                // Secondary check: if editor is empty, it probably sent but DOM didn't update fast enough
                const editorText = await cdp.call("Runtime.evaluate", {
                    expression: `document.querySelector('[data-lexical-editor="true"]').innerText`,
                    returnByValue: true
                });
                if (editorText.result.value.trim() === "") {
                    console.log(`  - Result: ⚠️ UNCERTAIN (Editor empty, likely sent)`);
                } else {
                    console.error(`  - Result: ❌ FAILURE (Text still in editor: "${editorText.result.value}")`);
                }
            }
        } catch (e) {
            console.error(`  - Error: ${e.message}`);
        }
    }
    process.exit(0);
}

multiPortTest();
