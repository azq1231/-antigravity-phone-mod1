import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseDialogFull() {
    process.stdout.write('--- DIAGNOSING DIALOG FULL ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning: ${conn.title}\n`);

            const SCRIPT = `(async () => {
                const results = [];
                // 1. 尋找百分比標籤
                const label = Array.from(document.querySelectorAll('*')).find(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                });

                if (label) {
                    label.click();
                    await new Promise(r => setTimeout(r, 1000));
                    
                    // 2. 獲取彈窗結構 (包含模型名稱)
                    const items = Array.from(document.querySelectorAll('.info-row, [class*="row"]'))
                        .filter(el => el.offsetParent !== null && el.innerText.trim().length > 0)
                        .map(el => el.innerText.trim().replace(/\\n/g, ' | '));
                    
                    return { found: true, items: items.slice(0, 50) };
                }
                return { found: false };
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res?.result?.value?.found) {
                    process.stdout.write(`[Context ${ctx.id}] Items:\n`);
                    res.result.value.items.forEach(i => process.stdout.write(`  - ${i}\n`));
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

diagnoseDialogFull();
