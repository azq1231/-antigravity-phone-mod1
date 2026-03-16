
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    const target3 = conns.find(c => c.url.includes('27E249B6413DF01538960F74FFC75B65'));
    
    if (!target3) {
        console.error("Target 3 (Chat iframe) not found in connections");
        process.exit(1);
    }

    console.log(`[DIAGNOSIS] Chat Iframe found: ${target3.title.substring(0, 50)}...`);

    const SCRIPT = `(() => {
        try {
            const body = document.body;
            if (!body) return { error: 'No body' };
            
            // Check for specific elements
            const conversation = document.querySelector('#conversation');
            const chat = document.querySelector('#chat');
            const cascade = document.querySelector('#cascade');
            
            return {
                title: document.title,
                bodyHTML: document.body.innerHTML.substring(0, 500),
                ids: {
                    conversation: !!conversation,
                    chat: !!chat,
                    cascade: !!cascade
                },
                offsetHeight: {
                    conversation: conversation ? conversation.offsetHeight : -1,
                    chat: chat ? chat.offsetHeight : -1,
                    cascade: cascade ? cascade.offsetHeight : -1
                }
            };
        } catch (e) { return { error: e.toString() }; }
    })()`;

    for (const ctx of (target3.contexts || [{id:undefined}])) {
        try {
            const res = await target3.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
            console.log(`Context ${ctx.id}:`, JSON.stringify(res.result?.value || res, null, 2));
        } catch (e) {
            console.log(`Context ${ctx.id}: Failed - ${e.message}`);
        }
    }
    process.exit(0);
}

diagnose();
