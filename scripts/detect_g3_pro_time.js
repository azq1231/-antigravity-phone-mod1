import { getOrConnectParams } from '../core/cdp_manager.js';

async function detectG3ProTime() {
    process.stdout.write('--- DETECTING G3 PRO RESTORATION TIME (v2) ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            const SCRIPT = `(async () => {
                // 1. 尋找百分比標籤並點擊
                const allElements = Array.from(document.querySelectorAll('*'));
                const label = allElements.find(el => {
                    const t = (el.innerText || el.textContent || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                });

                if (!label) return { error: 'Usage label not found' };
                
                label.click();
                await new Promise(r => setTimeout(r, 2000)); // 拉長時間確保渲染

                // 2. 在彈窗中搜尋
                const visibleText = Array.from(document.querySelectorAll('*'))
                                    .filter(el => el.offsetParent !== null && (el.classList.contains('info-row') || el.tagName === 'DIV'))
                                    .map(el => el.innerText.trim())
                                    .filter(t => t.length > 0);
                
                return { 
                    rows: visibleText.slice(0, 100),
                    foundCount: visibleText.length
                };
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", {
                    expression: SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });

                const val = res?.result?.value;
                if (val && !val.error) {
                    process.stdout.write(`  [Context ${ctx.id}] Results:\n`);
                    const g3Row = val.rows.find(t => t.toLowerCase().includes('g3') && t.toLowerCase().includes('pro'));
                    const resetRow = val.rows.find(t => t.includes('重置') || t.includes('恢復'));
                    const timeRow = val.rows.find(t => t.includes('h ') && t.includes('m'));

                    process.stdout.write(`    > G3 Pro Label: ${g3Row || 'Not Found'}\n`);
                    process.stdout.write(`    > Reset Info: ${resetRow || 'Not Found'}\n`);
                    process.stdout.write(`    > Time Match: ${timeRow || 'Not Found'}\n`);

                    // 列出前 20 行以便觀察結構
                    process.stdout.write(`    > Content Samples:\n`);
                    val.rows.slice(0, 20).forEach(r => process.stdout.write(`      | ${r}\n`));
                    return;
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

detectG3ProTime();
