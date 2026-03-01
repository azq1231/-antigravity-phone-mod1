import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose9001Targets() {
    try {
        const conn = await getOrConnectParams(9001);
        if (!conn) {
            console.log("Port 9001 offline");
            process.exit(0);
        }

        for (const cdp of conn) {
            for (const ctx of cdp.contexts) {
                const SCRIPT = `(() => {
                    const exactTarget = document.querySelector('#conversation') || 
                                 document.querySelector('#chat') || 
                                 document.querySelector('#cascade');
                    const looseTarget = document.querySelector('main') ||
                                 document.querySelector('[role="main"]');
                                 
                    const root = exactTarget || looseTarget;
                    const hasTarget = !!root;
                    const len = document.body?.innerHTML?.length || 0;
                    
                    const codeBlocks = Array.from(document.querySelectorAll('code, pre, .monaco-editor')).length;
                    
                    if (codeBlocks === 0) return { empty: true };
                    
                    // If no target, what are the top level elements?
                    let toplevel = Array.from(document.body?.children || []).map(el => el.tagName + '#' + el.id + '.' + Array.from(el.classList).join('.'));
                    
                    return { hasTarget, len, codeBlocks, toplevel };
                })()`;
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id }).catch(() => ({}));
                if (res.result?.value) {
                    if (!res.result.value.empty) {
                        console.log(`Ctx ${ctx.id}:`, res.result.value);
                    }
                }
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
diagnose9001Targets();
