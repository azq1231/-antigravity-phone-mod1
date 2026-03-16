
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    const conn = conns.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || conns[0];
    
    const SCRIPT = `(() => {
        const els = Array.from(document.querySelectorAll('[data-tooltip-id="new-conversation-tooltip"]'));
        return els.map(el => ({
            tag: el.tagName,
            visible: el.offsetHeight > 0,
            rect: el.getBoundingClientRect(),
            parentHTML: el.parentElement?.outerHTML.substring(0, 200)
        }));
    })()`;

    const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

diagnose();
