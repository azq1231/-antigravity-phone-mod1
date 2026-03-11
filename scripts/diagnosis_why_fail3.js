
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanDeep() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    
    for (const cdp of cdpList) {
        console.log(`Checking Target: ${cdp.title}`);
        
        let contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        for (const ctxId of contexts) {
            const SCRIPT = `(() => {
                const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
                return editors.map(el => ({
                    offsetParent: !!el.offsetParent,
                    offsetWidth: el.offsetWidth,
                    offsetHeight: el.offsetHeight,
                    computedDisplay: window.getComputedStyle(el).display,
                    innerText: el.innerText
                }));
            })()`;
            
            try {
                const params = { expression: SCRIPT, returnByValue: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                if (res.result && res.result.value && res.result.value.length > 0) {
                    console.log(`  Ctx ${ctxId}:`, res.result.value);
                }
            } catch (e) { }
        }
    }
    process.exit(0);
}

scanDeep();
