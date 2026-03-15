
import { getOrConnectParams } from '../core/cdp_manager.js';

async function findPercentages() {
    const port = 9001;
    try {
        const cdpList = await getOrConnectParams(port);
        for (const cdp of cdpList) {
            console.log(`Checking target: ${cdp.title}`);
            const SCRIPT = `(() => {
                const els = Array.from(document.querySelectorAll('*')).filter(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 50;
                });
                return els.map(el => ({ text: el.innerText, tag: el.tagName, className: el.className }));
            })()`;
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.length > 0) {
                    console.log(`  Context ${ctx.id}:`, JSON.stringify(res.result.value, null, 2));
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

findPercentages();
