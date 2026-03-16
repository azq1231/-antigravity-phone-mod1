
import { getOrConnectParams } from '../core/cdp_manager.js';

async function verify() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    
    console.log(`[VERIFY] Comparing Contexts on Port ${port}...`);
    for (const conn of conns) {
        for (const ctx of (conn.contexts || [])) {
            try {
                const res = await conn.call("Runtime.evaluate", {
                    expression: `({
                        hasConv: !!document.getElementById('conversation'),
                        focused: document.hasFocus(),
                        visibility: document.visibilityState,
                        len: document.getElementById('conversation')?.innerHTML.length || 0
                    })`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result?.value?.hasConv) {
                    console.log(`Ctx ${ctx.id} | Len: ${res.result.value.len} | Focus: ${res.result.value.focused} | Vis: ${res.result.value.visibility}`);
                }
            } catch (e) {}
        }
    }
}
verify();
