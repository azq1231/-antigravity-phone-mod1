import { getDetailedUsage } from '../core/auto_usage.js';
import { getOrConnectParams } from '../core/cdp_manager.js';

async function testFix() {
    const port = 9001; 
    console.log(`--- [Verify Fix] Testing getDetailedUsage on Port ${port} ---`);
    
    try {
        const cdpList = await getOrConnectParams(port, true);
        const result = await getDetailedUsage(cdpList, port);
        
        console.log("--- Result ---");
        console.log(JSON.stringify(result, null, 2));
        
        // 驗證是否有異常字串
        const dataStr = JSON.stringify(result);
        if (dataStr.includes('|') || dataStr.includes('Claude:') || dataStr.includes('Flash:')) {
            // 注意：模型名稱 Key 本身包含 Claude/Flash 是正常的，但 Value 不應該包含。
            const values = Object.values(result.data);
            const hasAnomaly = values.some(v => 
                v.countdown.includes('|') || 
                v.countdown.includes('Claude') || 
                v.countdown.includes('Flash')
            );
            
            if (hasAnomaly) {
                console.error("❌ 驗證失敗：倒計時中仍包含異常雜訊！");
            } else {
                console.log("✅ 驗證成功：倒計時已過濾雜訊。");
            }
        } else {
            console.log("✅ 驗證成功：未發現異常字串。");
        }

    } catch (e) {
        console.error("Test failed:", e);
    }
}

testFix().then(() => process.exit(0));
