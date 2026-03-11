
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanDeep() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    
    for (const cdp of cdpList) {
        console.log(`Checking Target: ${cdp.title}`);
        
        let contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        for (const ctxId of contexts) {
            const SCRIPT = `(() => {
                const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
                const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
                const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
                return {
                    cancel: !!cancel,
                    stopBtn: !!stopBtn,
                    editors: editors.length
                };
            })()`;
            
            try {
                const params = { expression: SCRIPT, returnByValue: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                if (res.result && res.result.value) {
                    console.log(`  Ctx ${ctxId}:`, res.result.value);
                } else {
                    console.log(`  Ctx ${ctxId}: Error or Empty`, res);
                }
            } catch (e) {
                console.log(`  Ctx ${ctxId}: Exception`, e.message);
            }
        }
    }
    process.exit(0);
}

scanDeep();
