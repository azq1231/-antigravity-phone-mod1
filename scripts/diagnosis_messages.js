
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpMessages() {
    const port = 9001;
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;
    
    const SCRIPT = `(() => {
        // Try various selectors for messages
        const selectors = [
            '[class*="ChatMessage"]',
            '[class*="message-row"]',
            '[data-testid*="message"]',
            '.bubble',
            'main div[class*="overflow"] > div > div'
        ];
        
        const results = {};
        selectors.forEach(s => {
            const els = document.querySelectorAll(s);
            results[s] = {
                count: els.length,
                samples: Array.from(els).slice(0, 2).map(el => ({
                    text: el.innerText.substring(0, 30),
                    classes: el.className
                }))
            };
        });
        return results;
    })()`;
    
    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

dumpMessages();
