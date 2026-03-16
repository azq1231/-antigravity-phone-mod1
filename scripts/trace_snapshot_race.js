
import { getOrConnectParams } from '../core/cdp_manager.js';

async function traceSnapshots() {
    const port = 9001; 
    console.log(`[TRACE] Monitoring Port ${port} for 5 seconds...`);
    const conns = await getOrConnectParams(port);
    
    for(let i=0; i<5; i++) {
        const candidates = [];
        for (const cdp of conns) {
            for (const ctx of (cdp.contexts || [{id:undefined}])) {
                try {
                    const res = await cdp.call("Runtime.evaluate", { 
                        expression: `({
                            html: document.body.innerText.substring(0, 30),
                            len: document.body.innerHTML.length,
                            title: document.title,
                            id: document.querySelector('#conversation, #chat, #cascade') ? 'CHAT_FOUND' : 'NO_CHAT'
                        })`, 
                        returnByValue: true, 
                        contextId: ctx.id 
                    });
                    if (res.result?.value) {
                        candidates.push({ ...res.result.value, targetTitle: cdp.title });
                    }
                } catch (e) {}
            }
        }
        console.log(`\n--- Tick ${i} ---`);
        candidates.sort((a,b) => b.len - a.len); // 模擬原本的長度優先邏輯
        candidates.forEach(c => {
            const winPrefix = (c === candidates[0]) ? "WIN" : "   ";
            console.log(`${winPrefix} | Len: ${c.len} | ID: ${c.id} | Tit: ${c.title.substring(0,15)}`);
        });
        await new Promise(r => setTimeout(r, 1000));
    }
    process.exit(0);
}

traceSnapshots();
