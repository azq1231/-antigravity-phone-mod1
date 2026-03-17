
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpMonitor() {
    const port = 9000;
    const cdpList = await getOrConnectParams(port);
    const SCRIPT = `(() => {
        return {
            title: document.title,
            text: document.body.innerText.substring(0, 5000),
            html: document.body.innerHTML.substring(0, 1000)
        };
    })()`;

    for (const cdp of cdpList) {
        console.log(`--- CDP: ${cdp.title} ---`);
        const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
        console.log(res.result?.value?.text?.substring(0, 1000));
    }
}

dumpMonitor().then(() => process.exit(0));
