import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseDialogDetailed() {
    process.stdout.write('--- DIAGNOSING DIALOG CONTENT ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning: ${conn.title}\n`);

            const SCRIPT = `(async () => {
                const results = [];
                // 1. 尋找帶有百分比的元素
                const elements = Array.from(document.querySelectorAll('*'));
                const label = elements.find(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                });

                if (label) {
                    label.click(); // 嘗試開啟彈窗
                    await new Promise(r => setTimeout(r, 1000));
                    
                    // 2. 獲取彈窗內的所有 TR 或具備表格特徵的行
                    const allNodes = Array.from(document.querySelectorAll('*'));
                    const dialogItems = allNodes.filter(el => {
                        const t = (el.innerText || "").trim();
                        // 恢復時間的特徵：h, m, (
                        return el.offsetParent !== null && (t.includes('h ') || t.includes('% →') || (t.includes(':') && t.includes('(')));
                    }).map(el => ({
                        text: el.innerText.trim(),
                        cls: el.className,
                        html: el.outerHTML.substring(0, 50)
                    }));
                    
                    return { found: true, items: dialogItems };
                }
                return { found: false };
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res?.result?.value?.found) {
                    process.stdout.write(`  [SUCCESS] Found dialog content in Context ${ctx.id}\n`);
                    res.result.value.items.forEach(item => {
                        if (item.text.length < 100) {
                            process.stdout.write(`    - ${item.text} (${item.cls})\n`);
                        }
                    });
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

diagnoseDialogDetailed();
