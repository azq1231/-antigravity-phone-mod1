
import { captureSnapshot } from '../core/auto_snap.js';
import CDP from 'chrome-remote-interface';
import axios from 'axios';

async function diagnoseLive() {
    try {
        const port = 9000;
        const res = await axios.get(`http://localhost:${port}/json`);
        const targets = res.data.filter(t => t.type === 'page' || t.type === 'webview');
        
        console.log(`[DIAGNOSE] 發現 ${targets.length} 個目標`);
        
        const cdpList = await Promise.all(targets.map(async t => {
            const client = await CDP({ target: t.webSocketDebuggerUrl });
            const { Runtime } = client;
            await Runtime.enable();
            
            // 獲取 context
            const { contexts } = await Runtime.getContexts(); // 注意：這取決於 cdp 封裝，我們直接用 Runtime.evaluate 對每個 context 執行
            
            return {
                title: t.title,
                call: (method, params) => client.send(method, params),
                contexts: [{ id: undefined }] // 簡單模擬
            };
        }));

        const winner = await captureSnapshot(cdpList);
        console.log("\n=== 實時診斷結果 ===");
        console.log(`勝出目標: ${winner.targetTitle}`);
        console.log(`長度: ${winner.html?.length}`);
        console.log(`品質: ${winner.matchQuality}`);
        console.log(`焦點: ${winner.hasFocus}`);
        console.log(`可見性: ${winner.visibility}`);
        
        // 檢查是否有「冤錯假案」：有沒有更短但品質一樣的目標被忽略了？
        // 這裡需要修改 captureSnapshot 暫時導出候選者清單，或者我們手動檢查 cdpList
        
        process.exit(0);
    } catch (e) {
        console.error("診斷失敗:", e);
        process.exit(1);
    }
}

diagnoseLive();
