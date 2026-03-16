
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    const webview = conns.find(c => c.url.includes('vscode-webview://'));
    
    if (!webview) {
        console.log("Port 9001 Chat Webview not found");
        process.exit(0);
    }
    
    console.log(`Analyzing Webview on Port 9001: ${webview.url.substring(0, 100)}`);
    
    const SCRIPT = `(() => {
        try {
            const hasChat = !!document.querySelector('#conversation, #chat, #cascade');
            const bodyText = document.body.innerText.substring(0, 200);
            return { hasChat, bodyText };
        } catch (e) { return { error: e.toString() }; }
    })()`;

    for (const ctx of (webview.contexts || [{id:undefined}])) {
        try {
            const res = await webview.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
            console.log(`Context ${ctx.id}:`, JSON.stringify(res.result?.value, null, 2));
        } catch (e) {}
    }
    process.exit(0);
}
diagnose();
