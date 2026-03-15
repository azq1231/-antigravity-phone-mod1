
import { getOrConnectParams } from '../core/cdp_manager.js';

async function findNumbers() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        const settings = conn.find(c => c.title === 'Settings');
        if (settings) {
            const res = await settings.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('*')).filter(el => el.innerText && el.innerText.match(/\\d/)).map(el => ({ tag: el.tagName, text: el.innerText.substring(0, 50) }))`,
                returnByValue: true
            });
            console.log("Elements with numbers:", JSON.stringify(res.result.value, null, 2));
        }
    } catch (e) {}
    process.exit(0);
}

findNumbers();
