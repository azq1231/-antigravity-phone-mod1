
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001; // The user was at 9001 in the metadata
    console.log(`[DIAGNOSIS] Connecting to port ${port}...`);
    const conns = await getOrConnectParams(port);
    
    console.log(`[DIAGNOSIS] Found ${conns.length} targets.`);
    conns.forEach((c, i) => console.log(`  [${i}] Title: ${c.title}, Type: ${c.type}`));

    // Find the chat window
    const conn = conns.find(c => c.title.includes('Antigravity')) || conns[0];
    if (!conn) {
        console.error("No valid target found");
        process.exit(1);
    }
    console.log(`[DIAGNOSIS] Using target: ${conn.title}`);

    const EXP = `(async () => {
        const results = [];
        
        // 1. Check for New Chat buttons
        const selectors = [
            '[data-tooltip-id="new-conversation-tooltip"]',
            'button:has(svg.lucide-plus)',
            'button'
        ];
        
        let targetBtn = null;
        for (const sel of selectors) {
            const els = Array.from(document.querySelectorAll(sel));
            for (const el of els) {
                const text = el.innerText || '';
                const hasPlus = el.querySelector('svg.lucide-plus') || el.innerHTML.includes('lucide-plus');
                if (sel === '[data-tooltip-id="new-conversation-tooltip"]' || hasPlus || text.includes('New Chat')) {
                    results.push({
                        selector: sel,
                        text: text.substring(0, 50),
                        visible: el.offsetHeight > 0,
                        rect: el.getBoundingClientRect(),
                        htmlSnippet: el.outerHTML.substring(0, 200)
                    });
                    if (!targetBtn && el.offsetHeight > 0) targetBtn = el;
                }
            }
        }
        
        if (targetBtn) {
            console.log('Found button, clicking...');
            // Capture state before click
            const beforeChatCount = document.querySelectorAll('[class*="history-item"]').length;
            const beforeContent = document.body.innerText.substring(0, 200);
            
            targetBtn.click();
            
            await new Promise(r => setTimeout(r, 2000));
            
            const afterChatCount = document.querySelectorAll('[class*="history-item"]').length;
            const afterContent = document.body.innerText.substring(0, 200);
            
            results.push({
                action: 'click',
                beforeChatCount,
                afterChatCount,
                contentChanged: beforeContent !== afterContent
            });
        } else {
            results.push({ action: 'click', error: 'No visible button found' });
        }
        
        return results;
    })()`;

    try {
        const res = await conn.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true });
        console.log("DIAGNOSIS RESULTS:");
        console.log(JSON.stringify(res.result.value, null, 2));
    } catch (e) {
        console.error("Evaluation error:", e);
    }
    
    process.exit(0);
}

diagnose();
