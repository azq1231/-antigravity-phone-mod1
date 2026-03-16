
import { getOrConnectParams } from '../core/cdp_manager.js';

const CAPTURE_SCRIPT = `(() => {
    try {
        const body = document.body;
        if (!body) return { error: 'No body' };
        
        const isChatContainer = (el) => el && (el.id === 'conversation' || el.id === 'chat' || el.id === 'cascade');
        const isVisible = (el) => el && el.offsetHeight > 0;
        
        const exactTarget = [
            document.querySelector('#conversation'),
            document.querySelector('#chat'),
            document.querySelector('#cascade')
        ].find(el => el && (el.offsetHeight > 0 || isChatContainer(el)));

        const looseTarget = [
            document.querySelector('main'),
            document.querySelector('[role="main"]')
        ].find(isVisible);
        
        const target = exactTarget || looseTarget;
        const root = target || body;
        
        return {
            html: root.outerHTML.substring(0, 100),
            matchQuality: exactTarget ? 'exact' : (looseTarget ? 'loose' : 'fallback'),
            title: document.title
        };
    } catch (e) { return { error: e.toString() }; }
})()`;

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    console.log(`[DIAGNOSIS] Running capture script on ${conns.length} targets...`);

    for (const conn of conns) {
        console.log(`\nTarget: ${conn.title}`);
        for (const ctx of (conn.contexts || [{id:undefined}])) {
            try {
                const res = await conn.call("Runtime.evaluate", { expression: CAPTURE_SCRIPT, returnByValue: true, contextId: ctx.id });
                console.log(`  Context ${ctx.id}:`, JSON.stringify(res.result?.value || res, null, 2));
            } catch (e) {
                console.log(`  Context ${ctx.id}: Failed - ${e.message}`);
            }
        }
    }
    process.exit(0);
}

diagnose();
