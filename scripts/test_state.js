import { getOrConnectParams } from '../core/cdp_manager.js';
import { getAppState } from '../core/automation.js';

async function testState() {
    try {
        const conn = await getOrConnectParams(9000);
        const state = await getAppState(conn);
        console.log("App state:", state);
        process.exit(0);
    } catch (e) { console.error(e); process.exit(1); }
}
testState();
