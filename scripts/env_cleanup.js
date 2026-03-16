
import { getOrConnectParams } from '../core/cdp_manager.js';

async function cleanup() {
    console.log("🧼 開始環境大掃除：終止所有殘留的注入腳本...");
    const PORTS = [9000, 9001];
    
    for (const port of PORTS) {
        try {
            const cdpList = await getOrConnectParams(port);
            console.log(`📡 已連接到 Port ${port}，正在清理 ${cdpList.length} 個目標...`);

            const CLEANUP_SCRIPT = `(() => {
                // 1. 清除所有計時器 (暴力枚舉)
                let highestTimeoutId = setTimeout(() => {}, 0);
                for (let i = 0; i <= highestTimeoutId; i++) {
                    clearTimeout(i);
                    clearInterval(i);
                }
                
                // 2. 清除 MutationObservers (如果能找到的話)
                // 雖然不能直接枚舉，但我們可以嘗試覆蓋一些常見的全局鉤子
                if (window.__antigravity_observer) {
                    window.__antigravity_observer.disconnect();
                    delete window.__antigravity_observer;
                }

                return "Cleanup completed for this context";
            })()`;

            for (const cdp of cdpList) {
                for (const ctx of (cdp.contexts || [{id: undefined}])) {
                    await cdp.call("Runtime.evaluate", { 
                        expression: CLEANUP_SCRIPT,
                        contextId: ctx.id
                    });
                }
                console.log(`✅ 清理完畢: ${cdp.title}`);
            }
        } catch (e) {
            console.warn(`⚠️ Port ${port} 清理略過: ${e.message}`);
        }
    }
    console.log("✨ 所有已知端口清理完畢。");
    process.exit(0);
}

cleanup();
