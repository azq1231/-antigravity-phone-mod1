
import { getOrConnectParams } from '../core/cdp_manager.js';

async function searchHiddenQuota() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port);
        const cdpList = Array.isArray(conn) ? conn : [conn];

        const SCRIPT = `(() => {
            const out = [];
            // Search for "Refreshes in" in ALL elements, including hidden ones
            document.querySelectorAll('*').forEach(el => {
                const text = (el.innerText || "").trim();
                if (text.includes('Refreshes in')) {
                    out.push("FOUND: [" + text.replace(/\\n/g, ' ') + "] VISIBLE: " + (el.offsetParent !== null));
                }
            });
            return out.join('\\n');
        })()`;

        for (const cdp of cdpList) {
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value) {
                    console.log(`Port ${port} Context ${ctx.id}:`);
                    console.log(res.result.value);
                }
            }
        }
    } catch (e) { console.error(e); }
}

searchHiddenQuota();
