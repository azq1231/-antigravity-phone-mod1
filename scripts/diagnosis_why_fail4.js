
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanDeep() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    const CHECK_SCRIPT = `(async () => {
        const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
        const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
        const busyEl = cancel || stopBtn;
        if (!false && busyEl && !!busyEl.offsetParent && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

        const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')].filter(el => !!el.offsetParent);
        if (editors.length === 0) return { ok: false, error: "no_editor" };
        
        const editor = editors[editors.length - 1];
        editor.focus();
        editor.innerHTML = '<p dir="ltr"><br></p>';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
    })()`;
    
    for (const cdp of cdpList) {
        console.log(`Checking Target: ${cdp.title}`);
        
        let contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        for (const ctxId of contexts) {
            try {
                const params = { expression: CHECK_SCRIPT, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                console.log(`  Ctx ${ctxId}:`, JSON.stringify(res, null, 2));
            } catch (e) {
                console.log(`  Ctx ${ctxId}: Exception`, e.message);
            }
        }
    }
    process.exit(0);
}

scanDeep();
