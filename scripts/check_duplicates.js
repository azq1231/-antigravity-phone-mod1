
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    
    for (const conn of conns) {
        for (const ctx of (conn.contexts || [{id:undefined}])) {
            try {
                const res = await conn.call("Runtime.evaluate", {
                    expression: `({
                        hasConv: !!document.getElementById('conversation'),
                        len: document.getElementById('conversation')?.innerHTML.length || 0,
                        visible: document.getElementById('conversation')?.offsetHeight > 0
                    })`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result?.value?.hasConv) {
                    console.log(`Port ${port} | Target: ${conn.title.substring(0,20)} | Ctx: ${ctx.id} | Len: ${res.result.value.len} | Visible: ${res.result.value.visible}`);
                }
            } catch (e) {}
        }
    }
    process.exit(0);
}
diagnose();
