
import { getOrConnectParams } from '../core/cdp_manager.js';
import { getDetailedUsage } from '../core/automation.js';

async function reproduce() {
    const port = 9001;
    console.log(`--- [Reproduction] Testing Port ${port} multiple times ---`);
    try {
        for (let i = 1; i <= 5; i++) {
            console.log(`\nAttempt ${i}:`);
            const conn = await getOrConnectParams(port, true);
            console.log(`  Targets: ${conn.map(c => c.title).join(' | ')}`);
            
            const start = Date.now();
            const res = await getDetailedUsage(conn);
            const duration = (Date.now() - start) / 1000;
            
            console.log(`  Result (Took ${duration}s):`, JSON.stringify(res, null, 2));
            
            if (!res.success) {
                console.log(`  ❌ Failed at attempt ${i}`);
            } else {
                console.log(`  ✅ Success at attempt ${i}`);
            }
            
            // Wait 3 seconds between attempts
            await new Promise(r => setTimeout(r, 3000));
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

reproduce();
