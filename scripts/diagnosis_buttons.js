
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpButtons() {
    const port = 9001;
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;
    
    const SCRIPT = `(() => {
        const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
            text: btn.innerText,
            aria: btn.getAttribute('aria-label'),
            tip: btn.getAttribute('data-tooltip-id'),
            classes: btn.className,
            html: btn.outerHTML,
            visible: btn.offsetParent !== null
        }));
        return buttons.filter(b => b.visible && (b.aria?.toLowerCase().includes('send') || b.tip?.toLowerCase().includes('send') || b.text.includes('發送')));
    })()`;
    
    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

dumpButtons();
