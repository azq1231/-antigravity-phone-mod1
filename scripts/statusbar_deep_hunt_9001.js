
import { getOrConnectParams } from '../core/cdp_manager.js';

async function deepHuntStatusBar() {
    const port = 9001;
    console.log(`--- [Status Bar Deep Hunt] Port ${port} ---`);
    try {
        const conn = await getOrConnectParams(port, true);
        for (const cdp of conn) {
            console.log(`Target: ${cdp.title}`);
            const SCRIPT = `(() => {
                const results = [];
                // 尋找所有帶有 aria-label 的元素
                const allAria = document.querySelectorAll('[aria-label]');
                allAria.forEach(el => {
                    const aria = el.getAttribute('aria-label');
                    if (aria.includes('%') || aria.includes('usage') || aria.includes('quota')) {
                        results.push({
                            tag: el.tagName,
                            aria: aria,
                            text: el.innerText,
                            visible: el.offsetParent !== null
                        });
                    }
                });
                
                // 尋找所有 statusbar 相關的類名
                const allStatus = document.querySelectorAll('[class*="statusbar"]');
                allStatus.forEach(el => {
                    results.push({
                        tag: el.tagName,
                        class: el.className,
                        text: el.innerText.substring(0, 50),
                        aria: el.getAttribute('aria-label')
                    });
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

deepHuntStatusBar();
