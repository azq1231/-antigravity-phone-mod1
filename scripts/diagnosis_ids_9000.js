
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    console.log(`[DIAGNOSIS] Examining ${conns.length} targets on Port 9000...`);

    const SCRIPT = `(() => {
        try {
            const body = document.body;
            if (!body) return { error: 'No body' };
            
            // Check for Chat containers
            const ids = ['conversation', 'chat', 'cascade'];
            const foundIds = ids.filter(id => !!document.getElementById(id) || !!document.querySelector('#' + id));
            
            return {
                title: document.title,
                url: window.location.href,
                foundIds: foundIds,
                bodyLen: document.body.innerHTML.length,
                hasMain: !!document.querySelector('main, [role="main"]')
            };
        } catch (e) { return { error: e.toString() }; }
    })()`;

    for (const conn of conns) {
        console.log(`\nTarget: ${conn.title}`);
        for (const ctx of (conn.contexts || [{id:undefined}])) {
            try {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                console.log(`  Context ${ctx.id}:`, JSON.stringify(res.result?.value || res, null, 2));
            } catch (e) {
                console.log(`  Context ${ctx.id}: Evaluation Failed - ${e.message}`);
            }
        }
    }
    process.exit(0);
}

diagnose();
