
import { getOrConnectParams } from '../core/cdp_manager.js';
import { captureSnapshot } from '../core/auto_snap.js';

async function diagnose() {
    const port = 9000;
    console.log(`[DIAGNOSIS] 📸 測試 Port ${port} 的快照抓取邏輯...`);
    
    try {
        const conns = await getOrConnectParams(port);
        const snap = await captureSnapshot(conns);
        
        console.log("--- 快照結果 ---");
        console.log(JSON.stringify(snap, (key, value) => key === 'html' || key === 'css' ? (value?.length + ' bytes') : value, 2));
        
    } catch (e) {
        console.error("Diagnosis failed:", e);
    }
    process.exit(0);
}

diagnose();
