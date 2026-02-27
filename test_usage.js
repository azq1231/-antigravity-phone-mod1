import { getOrConnectParams } from './core/cdp_manager.js';
import { getDetailedUsage } from './core/automation.js';

async function testVerbose() {
    process.stdout.write('--- TESTING getDetailedUsage ---\n');
    try {
        const conns = await getOrConnectParams(9000);
        const result = await getDetailedUsage(conns);
        process.stdout.write(`Result: ${JSON.stringify(result, null, 2)}\n`);
    } catch (e) {
        process.stdout.write(`Error: ${e.message}\n`);
    }
    process.exit(0);
}

testVerbose();
