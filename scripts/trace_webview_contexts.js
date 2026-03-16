
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    const webview = conns.find(c => c.url.includes('vscode-webview://'));
    
    if (!webview) {
        console.error("Webview not found");
        process.exit(1);
    }
    
    console.log(`Webview Target: ${webview.url.substring(0, 50)}...`);
    console.log(`Contexts count: ${webview.contexts.length}`);
    
    for (const ctx of webview.contexts) {
        console.log(`\n--- Context ${ctx.id} (${ctx.name || 'Unnamed'}) ---`);
        try {
            const res = await webview.call("Runtime.evaluate", {
                expression: `document.body.innerHTML.substring(0, 500)`,
                returnByValue: true,
                contextId: ctx.id
            });
            console.log(`HTML: ${res.result?.value}`);
        } catch (e) {
            console.log(`Error: ${e.message}`);
        }
    }
    process.exit(0);
}
diagnose();
