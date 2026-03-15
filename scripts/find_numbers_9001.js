
import { getOrConnectParams } from '../core/cdp_manager.js';

async function findNumbers() {
    const port = 9001;
    try {
        const cdpList = await getOrConnectParams(port);
        for (const cdp of cdpList) {
            const SCRIPT = `(() => {
                const text = document.body.innerText;
                const matches = text.match(/(\\d+)\\s*\\/\\s*(\\d+)/g);
                return matches || "None";
            })()`;
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value && res.result.value !== "None") {
                    console.log(`Target ${cdp.title}:`, res.result.value);
                }
            }
        }
    } catch (e) { console.error(e); }
}

findNumbers();
