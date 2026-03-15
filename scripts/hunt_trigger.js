
import { getOrConnectParams } from '../core/cdp_manager.js';

async function huntStatusBar() {
    const port = 9001;
    const conns = await getOrConnectParams(port, true);
    const workbench = conns.find(c => c.title.includes('Antigravity') || c.title.includes('yian-v1'));
    if (!workbench) { console.log("Workbench not found"); return; }
    
    const script = `(() => {
        const els = Array.from(document.querySelectorAll('*')).filter(el => {
            const aria = el.getAttribute('aria-label') || '';
            const text = el.innerText || '';
            return aria.includes('Antigravity') || text.includes('Antigravity') || aria.includes('Settings') || text.includes('Settings');
        });
        return els.map(el => ({
            tag: el.tagName,
            text: el.innerText.substring(0, 50),
            aria: el.getAttribute('aria-label'),
            visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
        }));
    })()`;
    
    // Try without contextId first
    const res = await workbench.call("Runtime.evaluate", { expression: script, returnByValue: true }).catch(e => ({ error: e.message }));
    console.log("Results (No Context):", JSON.stringify(res.result?.value, null, 2));
    
    process.exit(0);
}
huntStatusBar();
