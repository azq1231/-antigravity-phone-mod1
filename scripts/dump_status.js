
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpStatus() {
    const port = 9000;
    const cdpList = await getOrConnectParams(port);
    const SCRIPT = `(() => {
        return Array.from(document.querySelectorAll('.statusbar-item')).map(el => ({
            text: el.innerText,
            aria: el.getAttribute('aria-label')
        })).filter(item => {
            const t = (item.text || "") + (item.aria || "");
            return /Pro|Flash|Claude|%|Quota|配額/i.test(t);
        });
    })()`;

    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
        const data = res.result?.value;
        if (data && data.length > 0) {
            console.log(`--- CDP: ${cdp.title} ---`);
            data.forEach(d => console.log(`TEXT: [${d.text}] ARIA: [${d.aria}]`));
        }
    }
}

dumpStatus().then(() => process.exit(0));
