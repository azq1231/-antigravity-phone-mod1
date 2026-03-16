
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    const conn = conns.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || conns[0];
    
    const SCRIPT = `(() => {
        const results = [];
        const all = document.querySelectorAll('button, a, [role="button"], div, span');
        all.forEach((el, idx) => {
            const text = (el.innerText || "").trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || "").toLowerCase();
            const tip = (el.getAttribute('data-tooltip-id') || "").toLowerCase();
            const hasPlus = el.querySelector('svg.lucide-plus') || el.classList.contains('lucide-plus');
            
            if (text.includes('chat') || aria.includes('chat') || tip.includes('chat') || hasPlus) {
                if (el.offsetHeight > 0) {
                    results.push({
                        idx,
                        tag: el.tagName,
                        text: text.substring(0, 30),
                        aria,
                        tip,
                        hasPlus: !!hasPlus,
                        classes: el.className,
                        parent: el.parentElement?.className || "none"
                    });
                }
            }
        });
        return results;
    })()`;

    const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

diagnose();
