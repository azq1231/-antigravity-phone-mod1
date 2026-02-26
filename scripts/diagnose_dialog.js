import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseDialog() {
    process.stdout.write('--- DIAGNOSING INSIDE DIALOG IFRAME ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            const SCRIPT = `(() => {
                const results = [];
                // 1. 抓取所有元素
                const all = Array.from(document.querySelectorAll('*'));
                
                // 2. 獲取所有文字節點
                const rows = all.filter(el => {
                    const t = (el.innerText || "").trim();
                    // 包含 100.00% 或恢復時間特徵
                    return (t.includes('%') && el.offsetParent !== null) || t.includes('恢復') || t.includes('Pro');
                }).map(el => ({
                    text: el.innerText.trim(),
                    tag: el.tagName,
                    cls: el.className,
                    html: el.outerHTML.substring(0, 100)
                }));

                return { rows, url: window.location.href };
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                const val = res?.result?.value;
                if (val && val.rows.length > 5) { // 超過 5 個項目比較可能是報表
                    process.stdout.write(`  [Context ${ctx.id}] URL: ${val.url}\n`);
                    val.rows.forEach(r => {
                        if (r.text.length < 100) {
                            process.stdout.write(`    > ${r.text}\n`);
                        }
                    });
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

diagnoseDialog();
