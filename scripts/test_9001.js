import { getOrConnectParams } from '../core/cdp_manager.js';
import { getAppState, getDetailedUsage } from '../core/automation.js';

async function test9001() {
    try {
        console.log("Checking 9001 AppState...");
        const conn = await getOrConnectParams(9001);
        if (!conn) {
            console.log("Port 9001 offline");
            process.exit(0);
        }

        const state = await getAppState(conn);
        console.log("AppState:", JSON.stringify(state, null, 2));

        console.log("\nChecking 9001 Detailed Usage...");
        const usage = await getDetailedUsage(conn);
        console.log("DetailedUsage:", JSON.stringify(usage, null, 2));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test9001();
