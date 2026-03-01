import { getOrConnectParams } from '../core/cdp_manager.js';
import { captureSnapshot } from '../core/automation.js';
import fs from 'fs';

async function diagnoseSnapshot() {
    try {
        const conn = await getOrConnectParams(9001);
        if (!conn) process.exit(0);

        const snap = await captureSnapshot(conn);
        console.log("Got snapshot! matchQuality:", snap.matchQuality, "len:", snap.html.length);

        if (snap.html) {
            fs.writeFileSync('snap_dump.html', snap.html);
        }
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
}
diagnoseSnapshot();
