
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseQuota() {
    const port = 9000;
    const cdpList = await getOrConnectParams(port);
    const SCRIPT = `(() => {
        const items = Array.from(document.querySelectorAll('.statusbar-item')).map(el => ({
            text: el.innerText,
            aria: el.getAttribute('aria-label')
        }));
        const results = items.filter(i => /Pro|Flash|Claude|%/.test(i.text + i.aria));
        return results;
    })()`;

    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
        if (res.result?.value?.length > 0) {
            console.log(`--- PORT ${port} CDP: ${cdp.title} ---`);
            console.log(JSON.stringify(res.result.value, null, 2));
        }
    }
}

diagnoseQuota().then(() => process.exit(0));
