
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scan() {
    try {
        const conn = await getOrConnectParams(9001, true);
        const workbench = conn.find(c => c.title.includes('Antigravity') || c.title.includes('ubuntu'));
        if (workbench) {
            const res = await workbench.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.includes('%') && el.innerText.length < 100).map(el => el.innerText.trim())`,
                returnByValue: true
            });
            console.log("Found percentages:", res.result?.value);
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
scan();
