
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanAria() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        const workbench = conn.find(c => c.title.includes('Antigravity') || c.title.includes('ubuntu'));
        if (workbench) {
            const res = await workbench.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('.statusbar-item')).map(i => i.getAttribute('aria-label') || '')`,
                returnByValue: true 
            });
            const labels = res.result?.value || [];
            console.log("Found ARIA labels:", labels.filter(l => l.includes('%') || l.includes('Credit')).join('\n'));
        }
    } catch (e) { console.error(e); }
    process.exit(0);
}
scanAria();
