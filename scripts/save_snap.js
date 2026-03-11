
import { getOrConnectParams } from '../core/cdp_manager.js';
import { captureSnapshot } from '../core/automation.js';
import fs from 'fs';

async function takeSnapshot() {
    const port = 9001;
    const conn = await getOrConnectParams(port);
    const snap = await captureSnapshot(conn);
    if (snap.html) {
        fs.writeFileSync('scripts/debug_snap.html', snap.html);
        console.log('Snapshot saved to scripts/debug_snap.html');
        console.log('Match Quality:', snap.matchQuality);
        console.log('Found Target:', snap.foundTarget);
    } else {
        console.log('Error:', snap.error);
    }
    process.exit(0);
}

takeSnapshot();
