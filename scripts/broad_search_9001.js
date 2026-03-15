
import { getOrConnectParams } from '../core/cdp_manager.js';

async function broadSearch() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        for (const c of conn) {
            const res = await c.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('div, span, a')).filter(el => (el.innerText||'').includes('Antigravity')).map(el => ({ tag: el.tagName, text: el.innerText.substring(0, 30), class: el.className, aria: el.getAttribute('aria-label') }))`,
                returnByValue: true
            });
            if (res.result.value && res.result.value.length > 0) {
                console.log(`Target: "${c.title}"`);
                console.log(JSON.stringify(res.result.value, null, 2));
            }
        }
    } catch (e) {}
    process.exit(0);
}

broadSearch();
