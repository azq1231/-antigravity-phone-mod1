import { getOrConnectParams } from '../core/cdp_manager.js';
import { captureSnapshot } from '../core/automation.js';
import fs from 'fs';

async function dump() {
    const conn = await getOrConnectParams(9001);
    const snap = await captureSnapshot(conn);
    if (snap && snap.html) {
        fs.writeFileSync('debug_snapshot_9001.html', snap.html);
        console.log('Snapshot dumped to debug_snapshot_9001.html');
    } else {
        console.log('Snapshot failed:', snap);
    }
    process.exit(0);
}

dump();
