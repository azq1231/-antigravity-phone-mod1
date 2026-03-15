
import { getOrConnectParams } from '../core/cdp_manager.js';

async function searchAntigravity() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        for (const c of conn) {
            const res = await c.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.includes('Antigravity')).map(el => ({ tag: el.tagName, text: el.innerText, class: el.className }))`,
                returnByValue: true
            });
            if (res.result.value && res.result.value.length > 0) {
                console.log(`Target: "${c.title}"`);
                console.log(JSON.stringify(res.result.value.slice(0, 5), null, 2));
            }
        }
    } catch (e) {}
    process.exit(0);
}

searchAntigravity();
