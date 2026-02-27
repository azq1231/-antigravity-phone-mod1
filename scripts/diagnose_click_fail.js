import { getOrConnectParams } from '../core/cdp_manager.js';
import { openUsageDialog } from '../core/automation.js';

async function diagnoseClick() {
    process.stdout.write('--- DIAGNOSING CLICK LOGIC ---\n');
    const port = 9000;
    try {
        const conn = await getOrConnectParams(port);
        process.stdout.write(`Found ${conn.length} CDP connections.\n`);

        const result = await openUsageDialog(conn);
        process.stdout.write(`Result: ${JSON.stringify(result, null, 2)}\n`);

        if (result.success) {
            process.stdout.write(`Click succeeded! Waiting for dialog...\n`);
            await new Promise(r => setTimeout(r, 2000));

            // Check if dialog is visible now
            const checkScript = `(() => {
                const all = Array.from(document.querySelectorAll('*'));
                const dialog = all.find(el => el.innerText.includes('重置') && el.offsetParent !== null);
                return dialog ? { found: true, text: dialog.innerText.substring(0, 50) } : { found: false };
            })()`;

            for (const c of conn) {
                for (const ctx of c.contexts) {
                    const res = await c.call("Runtime.evaluate", { expression: checkScript, returnByValue: true, contextId: ctx.id });
                    if (res?.result?.value?.found) {
                        process.stdout.write(`[Context ${ctx.id}] Dialog IS visible: ${res.result.value.text}\n`);
                    }
                }
            }
        } else {
            process.stdout.write(`Click failed to find target.\n`);
        }
    } catch (e) {
        process.stdout.write(`Error: ${e.message}\n`);
    }
}

diagnoseClick();
