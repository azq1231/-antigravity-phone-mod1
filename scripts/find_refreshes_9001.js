
import { getOrConnectParams } from '../core/cdp_manager.js';

async function findRefreshes() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        for (const c of conn) {
            const res = await c.call("Runtime.evaluate", { 
                expression: `document.body.innerText.includes('Refreshes in')`,
                returnByValue: true
            });
            if (res.result.value) {
                console.log(`FOUND IN TARGET: "${c.title}"`);
                const text = await c.call("Runtime.evaluate", { expression: `document.body.innerText`, returnByValue: true });
                console.log(text.result.value.substring(0, 500));
            }
        }
    } catch (e) {}
    process.exit(0);
}

findRefreshes();
