
import { getOrConnectParams } from '../core/cdp_manager.js';
import { getJson } from '../core/utils.js';

async function diagnose() {
    const port = 9000;
    console.log(`[DIAGNOSIS] 🎯 開始深度監控 Port ${port}...`);

    const poll = async () => {
        const rawTargets = await getJson(`http://127.0.0.1:${port}/json`);
        const conns = await getOrConnectParams(port);
        
        console.log(`\n--- 掃描時間: ${new Date().toLocaleTimeString()} ---`);
        console.log(`HTTP [json] 數量: ${rawTargets.length} | CDP [active] 數量: ${conns.length}`);

        for (const conn of conns) {
            const ctxs = conn.contexts || [];
            console.log(`Target: "${conn.title.substring(0,30)}" | Contexts: ${ctxs.length} | URL: ${conn.url.substring(0,50)}...`);
            
            for (const ctx of ctxs) {
                try {
                    const res = await conn.call("Runtime.evaluate", {
                        expression: `({
                            title: document.title,
                            htmlLen: document.body.innerHTML.length,
                            chatVisible: !!document.querySelector('#conversation, #chat, #cascade'),
                            firstLine: (document.querySelector('.message-content, p') || {}).innerText?.substring(0, 20) || 'EMPTY'
                        })`,
                        returnByValue: true,
                        contextId: ctx.id
                    });
                    const val = res.result?.value;
                    if (val) {
                        console.log(`  └ [Context ${ctx.id}] Len: ${val.htmlLen} | Chat: ${val.chatVisible} | Snippet: ${val.firstLine}`);
                    }
                } catch (e) {
                    console.log(`  └ [Context ${ctx.id}] Error: ${e.message}`);
                }
            }
        }
    };

    // 進行 10 秒鐘的監控，每 2 秒一次
    for (let i = 0; i < 5; i++) {
        await poll();
        if (i < 4) await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n[DIAGNOSIS] 監控結束。`);
    process.exit(0);
}

diagnose();
