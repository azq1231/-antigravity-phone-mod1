
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanEditors() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    
    for (const cdp of cdpList) {
        console.log(`Checking Target: ${cdp.title}`);
        const SCRIPT = `(() => {
            const allEditors = Array.from(document.querySelectorAll('[data-lexical-editor="true"]'));
            return allEditors.map(e => ({
                html: e.outerHTML.substring(0, 50),
                offsetParent: !!e.offsetParent,
                offsetWidth: e.offsetWidth,
                offsetHeight: e.offsetHeight,
                contentEditable: e.contentEditable,
                visible: e.offsetWidth > 0
            }));
        })()`;
        
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            if (res.result.value && res.result.value.length > 0) {
                console.log(`  FOUND ${res.result.value.length} editors:`, JSON.stringify(res.result.value, null, 2));
            } else {
                console.log(`  No editors found in this target.`);
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }
    process.exit(0);
}

scanEditors();
