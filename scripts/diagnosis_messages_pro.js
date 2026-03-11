
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseMessagesContexts() {
    const port = 9001;
    const cdpList = await getOrConnectParams(port);
    console.log(`Port ${port} has ${cdpList.length} targets.`);
    
    for (const cdp of cdpList) {
        console.log(`- Target: ${cdp.title} (${cdp.url})`);
        console.log(`  Contexts: ${cdp.contexts.length}`);
        
        for (const ctx of cdp.contexts) {
            const SCRIPT = `(() => {
                const selectors = ['[class*="ChatMessage"]', '[class*="message-row"]', '[data-lexical-editor="true"]'];
                const res = {};
                selectors.forEach(s => {
                    const el = document.querySelector(s);
                    res[s] = el ? "FOUND" : "MISSING";
                });
                return res;
            })()`;
            
            try {
                const res = await cdp.call("Runtime.evaluate", { 
                    expression: SCRIPT, 
                    returnByValue: true, 
                    contextId: ctx.id 
                });
                console.log(`    Context ${ctx.id} (${ctx.name}):`, JSON.stringify(res.result.value));
            } catch (e) {
                console.log(`    Context ${ctx.id} Error: ${e.message}`);
            }
        }
    }
    process.exit(0);
}

diagnoseMessagesContexts();
