
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpUI() {
    console.log("--- [Diagnostic] Dumping UI Text ---");
    try {
        const port = 9000;
        const conn = await getOrConnectParams(port);
        for (const cdp of conn) {
            console.log(`Window: ${cdp.title}`);
            const res = await cdp.call("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
            console.log("TEXT_START >>>");
            console.log(res.result.value);
            console.log("<<< TEXT_END");
        }
    } catch (e) {
        console.error("Dump error:", e);
    }
}

dumpUI();
