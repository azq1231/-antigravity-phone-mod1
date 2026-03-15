
import { getOrConnectParams } from '../core/cdp_manager.js';

async function listAllElsWithPercent() {
    const port = 9001;
    console.log(`--- [Status Bar Hunt] Port ${port} ---`);
    try {
        const conn = await getOrConnectParams(port, true);
        for (const cdp of conn) {
            console.log(`Target: ${cdp.title}`);
            const SCRIPT = `(() => {
                const results = [];
                // 尋找底部狀態列可能的元素
                const items = document.querySelectorAll('.statusbar-item, [role="button"], a, span');
                items.forEach(el => {
                    const text = el.innerText || "";
                    if (text.includes('%') || text.includes('|') || text.includes('Gemini') || text.includes('Claude') || text.includes('Fast')) {
                        results.push({
                            tag: el.tagName,
                            class: el.className,
                            text: text.substring(0, 100).replace(/\\n/g, ' '),
                            aria: el.getAttribute('aria-label'),
                            rect: el.getBoundingClientRect()
                        });
                    }
                });
                return results;
            })()`;
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.length > 0) {
                    console.log(`  Context ${ctx.id} interesting elements:`, JSON.stringify(res.result.value, null, 2));
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

listAllElsWithPercent();
