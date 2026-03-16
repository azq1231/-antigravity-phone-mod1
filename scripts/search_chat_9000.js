
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    
    const SCRIPT = `(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const hasId = (id) => !!document.getElementById(id);
        const chatKeywords = ['conversation', 'chat', 'cascade', 'message', 'input'];
        const found = all.filter(el => {
            const id = el.id || '';
            const cls = el.className || '';
            return chatKeywords.some(k => id.toLowerCase().includes(k) || (typeof cls === 'string' && cls.toLowerCase().includes(k)));
        });
        
        return {
            title: document.title,
            count: found.length,
            ids: found.slice(0, 10).map(el => el.id)
        };
    })()`;

    for (const conn of conns) {
        for (const ctx of (conn.contexts || [{id:undefined}])) {
            try {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.count > 0) {
                    console.log(`Target: ${conn.title} [Ctx ${ctx.id}]`);
                    console.log(`  Found ${res.result.value.count} chat-like elements.`);
                    console.log(`  IDs: ${res.result.value.ids.filter(id => id).join(', ')}`);
                }
            } catch (e) {}
        }
    }
    process.exit(0);
}

diagnose();
