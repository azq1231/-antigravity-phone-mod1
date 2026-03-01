import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseHTML2() {
    const conn = await getOrConnectParams(9001);
    for (const cdp of conn) {
        for (const ctx of cdp.contexts) {
            const SCRIPT = `(() => {
                const target = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
                if (!target) return 'No target';
                return {
                    id: ${ctx.id || 0},
                    len: target.outerHTML.length,
                    hasIframe: target.outerHTML.includes('<iframe'),
                    hasWebview: target.outerHTML.includes('<webview')
                };
            })()`;
            const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id }).catch(e => ({ error: e.message }));
            console.log("Ctx", ctx.id, res.result?.value || res);
        }
    }
    process.exit(0);
}
diagnoseHTML2();
