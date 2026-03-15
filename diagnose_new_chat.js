
import { getOrConnectParams } from './core/cdp_manager.js';

async function diagnoseNewChat() {
    const port = 9001; // 假設你在用這個 Port
    console.log(`Diagnosing New Chat on Port ${port}...`);
    
    try {
        const cdpList = await getOrConnectParams(port);
        
        const SCRIPT = `(() => {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
                .filter(el => {
                    const t = (el.innerText || el.textContent || '').toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    const tip = (el.getAttribute('data-tooltip-id') || '').toLowerCase();
                    const hasPlus = !!el.querySelector('svg.lucide-plus') || el.classList?.contains('lucide-plus');
                    return t.includes('new chat') || aria.includes('new chat') || tip.includes('new chat') || hasPlus;
                })
                .map(el => ({
                    tag: el.tagName,
                    text: (el.innerText || el.textContent || '').substring(0, 30),
                    aria: el.getAttribute('aria-label'),
                    tip: el.getAttribute('data-tooltip-id'),
                    visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
                    class: el.className
                }));
            return buttons;
        })()`;

        for (const cdp of cdpList) {
            for (const ctx of (cdp.contexts || [])) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value && res.result.value.length > 0) {
                    console.log(`Found ${res.result.value.length} potential New Chat buttons in Port ${port} ctx ${ctx.id}:`);
                    console.table(res.result.value);
                    return;
                }
            }
        }
        console.log("No New Chat buttons found during diagnosis.");
    } catch (e) {
        console.error("Diagnosis failed:", e);
    }
}

diagnoseNewChat();
