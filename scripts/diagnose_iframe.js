import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseIframe() {
    process.stdout.write('--- DIAGNOSING INSIDE IFRAME ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            // 嘗試找到所有包含 index.html 的 iframe target
            const SCRIPT = `(() => {
                const results = [];
                // 1. 抓取所有元素，包含按鈕和文字
                const all = Array.from(document.querySelectorAll('*'));
                
                // 2. 搜尋帶有百分比的文字
                const percents = all.filter(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 20 && el.offsetParent !== null;
                }).map(el => ({
                    text: el.innerText.trim(),
                    tag: el.tagName,
                    cls: el.className,
                    html: el.outerHTML.substring(0, 100)
                }));

                // 3. 搜尋像是模型名稱的文字
                const models = all.filter(el => {
                    const t = (el.innerText || "").trim();
                    return (t.includes('Gemini') || t.includes('Claude') || t.includes('GP')) && t.length < 50;
                }).map(el => el.innerText.trim());

                return { percents, models, title: document.title, url: window.location.href };
            })()`;

            // 遍歷所有可能包含 UI 的 Context
            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const params = { expression: SCRIPT, returnByValue: true };
                if (ctx.id !== undefined) params.contextId = ctx.id;

                const res = await conn.call("Runtime.evaluate", params);
                const val = res?.result?.value;
                if (val && (val.percents.length > 0 || val.models.length > 0)) {
                    process.stdout.write(`  [Context ${ctx.id || 'default'}] URL: ${val.url}\n`);
                    process.stdout.write(`  Percents: ${JSON.stringify(val.percents)}\n`);
                    process.stdout.write(`  Models: ${val.models.join(', ')}\n`);
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

diagnoseIframe();
