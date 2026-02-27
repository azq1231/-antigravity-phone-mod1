import { getOrConnectParams } from '../core/cdp_manager.js';
import { getAppState } from '../core/automation.js';

async function diagnoseState() {
    process.stdout.write('--- 診斷 State ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        const state = await getAppState(conns);
        process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    } catch (e) {
        process.stdout.write(`Error: ${e.message}\n`);
    }
    process.exit(0);
}

diagnoseState();
