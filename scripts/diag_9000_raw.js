import { getOrConnectParams } from '../core/cdp_manager.js';

async function diag9000Usage() {
    try {
        const conn = await getOrConnectParams(9000, true);
        const w = conn.find(c => c.title && !/Launchpad|Monitor/i.test(c.title));
        if (!w) {
            console.log("No valid target found for 9000");
            process.exit(1);
        }
        console.log("Using Target:", w.title);
        const res = await w.call('Runtime.evaluate', {
            expression: `(() => {
                const items = Array.from(document.querySelectorAll('.statusbar-item'));
                return items.map(i => ({
                    t: i.innerText,
                    aria: i.getAttribute('aria-label') || '',
                    html: i.outerHTML.substring(0, 100)
                }));
            })()`,
            returnByValue: true
        });
        console.log(JSON.stringify(res.result.value, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
diag9000Usage();
