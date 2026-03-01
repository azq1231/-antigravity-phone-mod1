import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseHTML() {
    try {
        const conn = await getOrConnectParams(9001);
        if (!conn) {
            console.log("Port offline");
            process.exit(0);
        }
        for (const cdp of conn) {
            for (const ctx of cdp.contexts) {
                const SCRIPT = `(() => {
                    const exactTarget = document.querySelector('#conversation') || document.querySelector('#chat') || document.querySelector('#cascade');
                    const looseTarget = document.querySelector('main') || document.querySelector('[role="main"]');
                    const target = exactTarget || looseTarget;
                    
                    if (!target) return null;
                    
                    const codeBlocks = Array.from(target.querySelectorAll('code, pre, .monaco-editor')).length;
                    const html = target.outerHTML;
                    const hasIframe = html.includes('<iframe') || html.includes('<webview');
                    const hasMessages = html.includes('message') || html.includes('chat-row');
                    
                    return { id: ctx.id, htmlLength: html.length, codeBlocks, hasIframe, hasMessages, isExact: !!exactTarget };
                })()`;
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id }).catch(() => ({}));
                if (res.result?.value) console.log(res.result.value);
            }
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
diagnoseHTML();
