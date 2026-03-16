
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    const target = conns.find(c => c.title.includes('yian-v1 [WSL: ubuntu]'));
    
    if (!target) {
        console.error("Target not found");
        process.exit(1);
    }
    
    const SCRIPT = `(() => {
        const conversation = document.getElementById('conversation');
        const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]') || 
                           Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-plus') || b.innerText.includes('New Chat'));
        
        return {
            hasConversation: !!conversation,
            chatText: conversation ? conversation.innerText.substring(0, 100) : 'N/A',
            hasNewChatBtn: !!newChatBtn,
            btnVisible: newChatBtn ? newChatBtn.offsetHeight > 0 : false,
            btnTitle: newChatBtn ? (newChatBtn.title || newChatBtn.getAttribute('aria-label')) : 'N/A'
        };
    })()`;

    for (const ctx of (target.contexts || [{id:undefined}])) {
        try {
            const res = await target.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
            const val = res.result?.value;
            if (val && (val.hasConversation || val.hasNewChatBtn)) {
                console.log(`Context ${ctx.id}:`, JSON.stringify(val, null, 2));
            }
        } catch (e) {}
    }
    process.exit(0);
}
diagnose();
