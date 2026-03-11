
import { getOrConnectParams } from '../core/cdp_manager.js';

async function debugExpression() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            const EXP = `(() => {
                const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
                const editor = editors[0];
                return {
                    count: editors.length,
                    hasAttr: editor ? editor.hasAttribute('contenteditable') : false,
                    valAttr: editor ? editor.getAttribute('contenteditable') : "none",
                    offsetParent: editor ? !!editor.offsetParent : false,
                    visible: editor ? (editor.offsetWidth > 0) : false
                };
            })()`;
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, contextId: ctx.id });
            console.log(`Port ${port} Target ${cdp.title} Ctx ${ctx.id}:`, res.result.value);
        }
    }
    process.exit(0);
}

debugExpression();
