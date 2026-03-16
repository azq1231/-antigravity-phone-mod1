
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function deepScan() {
    const instances = await findAllInstances();
    for (const inst of instances) {
        console.log(`\n=== Port ${inst.port} ===`);
        for (const target of inst.targets) {
            try {
                const conn = await connectCDP(target.url);
                for (const ctx of (conn.contexts || [{id:undefined}])) {
                    const res = await conn.call("Runtime.evaluate", {
                        expression: `Array.from(document.querySelectorAll('*[id]')).map(el => el.id).slice(0, 100)`,
                        returnByValue: true,
                        contextId: ctx.id
                    });
                    const ids = res.result?.value || [];
                    if (ids.length > 0) {
                        console.log(`Target: ${target.title.substring(0, 20)} [Ctx ${ctx.id}] IDs: ${ids.filter(id => id.length < 30).slice(0, 10).join(', ')}`);
                    }
                }
                conn.close();
            } catch (e) {}
        }
    }
    process.exit(0);
}
deepScan();
