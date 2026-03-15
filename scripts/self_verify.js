
import { getOrConnectParams } from '../core/cdp_manager.js';
import { getDetailedUsage } from '../core/auto_usage.js';

async function selfVerify() {
    console.log("--- [Self-Verification] Checking actual Quota Result ---");
    try {
        const port = 9000;
        const conn = await getOrConnectParams(port);
        const result = await getDetailedUsage(conn, port);
        console.log("ACTUAL_RESULT:", JSON.stringify(result, null, 2));
        
        if (result.success && result.data) {
            const allNA = Object.values(result.data).every(d => d.percent === "N/A" && d.countdown === "N/A");
            if (!allNA) {
                console.log("Verification Status: DATA_FOUND");
            } else {
                console.log("Verification Status: ALL_NA");
            }
        } else {
            console.log("Verification Status: FAILED");
        }
    } catch (e) {
        console.error("Verification error:", e);
    }
}

selfVerify();
