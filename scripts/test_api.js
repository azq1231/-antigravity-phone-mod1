import { getOrConnectParams } from '../core/cdp_manager.js';
import { getDetailedUsage } from '../core/automation.js';

async function testApi() {
    try {
        const ports = [9000, 9002];
        for (const port of ports) {
            console.log(`\n--- Test Port ${port} ---`);
            const conn = await getOrConnectParams(port).catch(() => null);
            if (!conn) continue;

            const res = await getDetailedUsage(conn);
            console.log("Result:", JSON.stringify(res, null, 2));
        }
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
testApi();
