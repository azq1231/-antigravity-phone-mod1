import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseLabel() {
    process.stdout.write('--- HUNTING FOR % LABEL ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning: ${conn.title}\n`);

            const SCRIPT = `(() => {
                const results = [];
                // 1. 抓取所有元素
                const all = Array.from(document.querySelectorAll('*'));
                
                // 2. 搜尋包含百分比的簡單標籤
                const match = all.filter(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                }).map(el => ({
                    text: el.innerText.trim(),
                    tag: el.tagName,
                    cls: el.className,
                    html: el.outerHTML.substring(0, 100)
                }));

                return match;
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res?.result?.value && res.result.value.length > 0) {
                    process.stdout.write(`  [Context ${ctx.id}] URL: ${conn.url}\n`);
                    res.result.value.forEach(m => {
                        process.stdout.write(`    - TEXT: [${m.text}] TAG: ${m.tag} CLS: ${m.cls}\n`);
                        process.stdout.write(`      HTML: ${m.html}\n`);
                    });
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

diagnoseLabel();
