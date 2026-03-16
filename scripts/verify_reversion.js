
import { getOrConnectParams } from '../core/cdp_manager.js';
import { captureSnapshot } from '../core/auto_snap.js';
import fs from 'fs';

async function diagnose() {
    console.log("🔍 開始深度診斷：尋找快照逆流的原因...");
    const PORT = 9000;
    
    try {
        const cdpList = await getOrConnectParams(PORT);
        console.log(`✅ 已連接到 Port ${PORT}，發現 ${cdpList.length} 個 CDP 目標。`);

        // 模擬排序邏輯並打印細節
        const CAPTURE_SCRIPT = `(() => {
            const isChatContainer = (el) => el && (el.id === 'conversation' || el.id === 'chat' || el.id === 'cascade');
            const exactTarget = [
                document.querySelector('#conversation'),
                document.querySelector('#chat'),
                document.querySelector('#cascade')
            ].find(el => el && (el.offsetHeight > 0 || isChatContainer(el)));
            
            return {
                matchQuality: exactTarget ? 'exact' : 'fallback',
                htmlLength: document.body.outerHTML.length,
                title: document.title,
                url: window.location.href,
                hasFocus: document.hasFocus(),
                visibility: document.visibilityState
            };
        })()`;

        const candidates = [];
        for (const cdp of cdpList) {
            for (const ctx of (cdp.contexts || [{id: undefined}])) {
                try {
                    const res = await cdp.call("Runtime.evaluate", { 
                        expression: CAPTURE_SCRIPT, 
                        returnByValue: true,
                        contextId: ctx.id
                    });
                    if (res.result?.value) {
                        candidates.push({
                            ...res.result.value,
                            targetTitle: cdp.title,
                            source: `Port ${PORT}, Target: ${cdp.title}`
                        });
                    }
                } catch(e) {}
            }
        }

        console.log("\n--- 所有候選者權重列表 ---");
        console.log("品質\t焦點\t可見性\t長度\t標題");
        candidates.forEach(c => {
            console.log(`${c.matchQuality}\t${c.hasFocus}\t${c.visibility}\t${c.htmlLength}\t${c.title}`);
        });

        // 模擬最終選擇
        const sorted = [...candidates].sort((a, b) => {
            const qualityScore = { exact: 1000000, fallback: 0 };
            const qa = qualityScore[a.matchQuality] || 0;
            const qb = qualityScore[b.matchQuality] || 0;
            if (qa !== qb) return qb - qa;
            if (a.hasFocus !== b.hasFocus) return a.hasFocus ? -1 : 1;
            if (a.visibility !== b.visibility) return a.visibility === 'visible' ? -1 : 1;
            return b.htmlLength - a.htmlLength; // 長度在此競爭
        });

        console.log("\n🏆 系統最終選擇的快照：");
        console.log(`標題: ${sorted[0].title}`);
        console.log(`原因: 因為長度為 ${sorted[0].htmlLength}，在平手情況下勝出。`);

        if (sorted.length > 1 && sorted[0].htmlLength > 100000 && sorted.find(c => c.htmlLength < 5000)) {
            console.log("\n⚠️ 發現診斷結論：長度陷阱！");
            console.log("系統選中了一個巨大的舊對話，忽略了一個很短的新對話。這就是回潮原因。");
        }

    } catch (e) {
        console.error("❌ 診斷出錯:", e);
    }
}

diagnose();
