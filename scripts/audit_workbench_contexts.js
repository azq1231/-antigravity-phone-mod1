
import { getOrConnectParams } from '../core/cdp_manager.js';

async function auditWorkbench() {
    const port = 9001;
    const conns = await getOrConnectParams(port, true);
    const workbench = conns.find(c => c.title.includes('Antigravity') || c.title.includes('yian-v1'));
    if (!workbench) { console.log("Workbench not found"); return; }
    
    console.log("Analyzing contexts for:", workbench.title);
    for (const ctx of workbench.contexts) {
        try {
            const res = await workbench.call("Runtime.evaluate", { 
                expression: `Array.from(document.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label'))`,
                returnByValue: true,
                contextId: ctx.id
            });
            console.log(`Context ${ctx.id} labels:`, res.result?.value?.filter(l => l && l.includes('Antigravity')));
        } catch (e) {
            console.log(`Context ${ctx.id} failed:`, e.message);
        }
    }
}
auditWorkbench();
