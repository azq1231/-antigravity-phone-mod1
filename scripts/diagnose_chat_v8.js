
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    const conn = conns.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || conns[0];
    
    const SCRIPT = `(() => {
        const results = [];
        const target = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (target) {
            results.push({
                found: 'tooltip',
                tag: target.tagName,
                html: target.outerHTML,
                parent: target.parentElement?.outerHTML.substring(0, 500)
            });
        }
        
        const allWithPlus = Array.from(document.querySelectorAll('*')).filter(el => el.innerHTML.includes('lucide-plus') && el.offsetHeight > 0 && el.tagName !== 'SVG');
        allWithPlus.forEach(el => {
            results.push({
                found: 'plus-content',
                tag: el.tagName,
                text: el.innerText.substring(0, 50),
                aria: el.getAttribute('aria-label'),
                classes: el.className
            });
        });
        
        return results;
    })()`;

    const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

diagnose();
