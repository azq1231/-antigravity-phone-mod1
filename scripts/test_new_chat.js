
import { getOrConnectParams } from '../core/cdp_manager.js';

async function testClick() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    const conn = conns.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || conns[0];
    
    const SCRIPT = `(async () => {
        const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (!btn) return { error: 'Not found' };
        
        const oldUrl = window.location.href;
        const oldText = document.body.innerText.substring(0, 100);
        
        btn.click();
        await new Promise(r => setTimeout(r, 1500));
        
        return {
            clicked: true,
            urlChanged: window.location.href !== oldUrl,
            newUrl: window.location.href,
            textChanged: document.body.innerText.substring(0, 100) !== oldText,
            newText: document.body.innerText.substring(0, 100)
        };
    })()`;

    const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

testClick();
