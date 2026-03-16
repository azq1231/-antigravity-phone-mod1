
import { getOrConnectParams } from '../core/cdp_manager.js';

async function debugSnapshot() {
    console.log("🔍 診斷 Snapshot 缺失問題...");
    const PORT = 9000;
    try {
        const cdpList = await getOrConnectParams(PORT);
        console.log(`📡 發現 ${cdpList.length} 個 CDP 目標`);

        for (const cdp of cdpList) {
            console.log(`\n--- 目標: ${cdp.title} ---`);
            const contexts = cdp.contexts || [{id: undefined}];
            console.log(`Contexts 數量: ${contexts.length}`);

            for (const ctx of contexts) {
                const res = await cdp.call("Runtime.evaluate", {
                    expression: `(() => {
                        try {
                            return {
                                hasBody: !!document.body,
                                hasConversation: !!document.querySelector('#conversation'),
                                hasChat: !!document.querySelector('#chat'),
                                url: window.location.href,
                                title: document.title
                            };
                        } catch(e) { return { error: e.toString() }; }
                    })()`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                console.log(`Context[${ctx.id || 'default'}]:`, JSON.stringify(res.result?.value, null, 2));
            }
        }
    } catch (e) {
        console.error("❌ 診斷過程出錯:", e);
    }
    process.exit(0);
}

debugSnapshot();
