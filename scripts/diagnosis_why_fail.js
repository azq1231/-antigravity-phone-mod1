
import { getOrConnectParams } from '../core/cdp_manager.js';

async function scanDeep() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    
    for (const cdp of cdpList) {
        console.log(`\nChecking Target: ${cdp.title}`);
        const SCRIPT = `(() => {
            const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
            const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
            const busyEl = cancel || stopBtn;
            
            const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
            const visibleEditors = editors.filter(el => !!el.offsetParent);
            
            return {
                cancelExists: !!cancel,
                stopBtnExists: !!stopBtn,
                busyElExists: !!busyEl,
                busyElOffset: busyEl ? !!busyEl.offsetParent : null,
                busyElHeight: busyEl ? busyEl.offsetHeight : null,
                totalEditors: editors.length,
                visibleEditors: visibleEditors.length
            };
        })()`;
        
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            console.log(res.result.value);
        } catch (e) { }
    }
    process.exit(0);
}

scanDeep();
