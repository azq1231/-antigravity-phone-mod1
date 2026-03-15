
import { getOrConnectParams } from '../core/cdp_manager.js';

async function deepSearchRefreshes() {
    const port = 9001;
    console.log(`--- [Deep Search: Refreshes in] Port ${port} ---`);
    try {
        const conn = await getOrConnectParams(port, true);
        for (const cdp of conn) {
            console.log(`Target: ${cdp.title}`);
            const SCRIPT = `(() => {
                const results = [];
                // 1. Check body text
                if (document.body.innerText.includes('Refreshes in')) {
                    results.push({ type: 'body', text: 'FOUND' });
                }
                
                // 2. Check all elements and their computed styles / visibility
                const all = document.querySelectorAll('*');
                all.forEach(el => {
                    const t = el.innerText || "";
                    if (t.includes('Refreshes in')) {
                        results.push({
                            tag: el.tagName,
                            id: el.id,
                            class: el.className,
                            visible: el.offsetParent !== null,
                            display: window.getComputedStyle(el).display,
                            text: t.substring(0, 50)
                        });
                    }
                });

                // 3. Try finding by aria-label
                const arias = document.querySelectorAll('[aria-label*="Refreshes in"]');
                arias.forEach(el => {
                    results.push({ type: 'aria', label: el.getAttribute('aria-label') });
                });

                return results;
            })()`;
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.length > 0) {
                    console.log(`  Context ${ctx.id} Results:`, JSON.stringify(res.result.value, null, 2));
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

deepSearchRefreshes();
