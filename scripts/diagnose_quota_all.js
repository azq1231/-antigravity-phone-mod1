
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseQuota() {
    console.log('--- Quota Diagnosis ---');
    const ports = [9000, 9001, 9002];
    for (const port of ports) {
        console.log(`\nChecking Port ${port}...`);
        try {
            const conn = await getOrConnectParams(port);
            const cdpList = Array.isArray(conn) ? conn : [conn];

            const SCRIPT = `(() => {
                const labels = Array.from(document.querySelectorAll('.statusbar-item-label, .statusbar-item a, .statusbar-item span, .statusbar-item')).filter(el => {
                    return el.innerText.includes('%') && el.offsetParent !== null;
                });
                
                return labels.map(l => {
                    let el = l;
                    while(el && !el.classList?.contains('statusbar-item')) {
                        if (el.parentElement) el = el.parentElement;
                        else break;
                    }
                    return {
                        text: l.innerText,
                        aria: el ? (el.getAttribute('aria-label') || el.querySelector('[aria-label]')?.getAttribute('aria-label') || "") : "N/A"
                    };
                });
            })()`;

            let found = false;
            for (const cdp of cdpList) {
                for (const ctx of cdp.contexts) {
                    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                    if (res.result?.value && res.result.value.length > 0) {
                        console.log(`Found ${res.result.value.length} potential items:`);
                        res.result.value.forEach((item, i) => {
                            console.log(`[${i}] Text: "${item.text}"`);
                            console.log(`    Aria: "${item.aria.substring(0, 200)}..."`);
                        });
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (!found) console.log("No usage labels found.");

        } catch (e) {
            console.error(`Error on port ${port}:`, e.message);
        }
    }
}

diagnoseQuota();
