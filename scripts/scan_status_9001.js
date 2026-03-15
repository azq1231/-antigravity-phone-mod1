
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanStatus() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        const workbench = conn.find(c => c.title.includes('Antigravity') || c.title.includes('ubuntu'));
        if (workbench) {
            console.log(`Checking Workbench: ${workbench.title}`);
            const res = await workbench.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('.statusbar-item')).map(i => ({ text: i.innerText.trim(), aria: i.getAttribute('aria-label') }))`,
                returnByValue: true 
            });
            console.log(JSON.stringify(res.result?.value, null, 2));
        } else {
            console.log("No workbench found for 9001");
        }
    } catch (e) { console.error(e); }
    process.exit(0);
}
scanStatus();
