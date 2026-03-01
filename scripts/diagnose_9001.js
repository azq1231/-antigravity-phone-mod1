import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose9001Nodes() {
    try {
        const conn = await getOrConnectParams(9001);
        if (!conn) {
            console.log("Port 9001 offline");
            process.exit(0);
        }

        for (const cdp of conn) {
            for (const ctx of cdp.contexts) {
                const SCRIPT = `(() => {
                    const chatItems = Array.from(document.querySelectorAll('.chat-item, .chat-message, .message'));
                    let text = "Chat Items:\\n";
                    if (chatItems.length > 0) {
                        text += chatItems.map(el => el.innerText.substring(0, 50).replace(/\\n/g, ' ')).join('\\n');
                    } else {
                        // check main webview
                        const webviews = Array.from(document.querySelectorAll('webview, iframe'));
                        text += "Found " + webviews.length + " webviews\\n";
                    }
                    
                    const codeBlocks = Array.from(document.querySelectorAll('code, pre, .monaco-editor'));
                    text += "\\nCode blocks: " + codeBlocks.length;
                    
                    return text;
                })()`;
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id }).catch(() => ({}));
                if (res.result?.value) {
                    console.log(`Ctx ${ctx.id}:`, res.result.value);
                }
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
diagnose9001Nodes();
