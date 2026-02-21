import { getOrConnectParams } from '../core/cdp_manager.js';
import { captureSnapshot } from '../core/automation.js';
import fs from 'fs';

async function dump() {
    try {
        const conns = await getOrConnectParams(9000);
        const snapshot = await captureSnapshot(conns);
        if (snapshot.html) {
            console.log("HTML length:", snapshot.html.length);
            fs.writeFileSync('last_snap_dump.html', snapshot.html);
            console.log("Dumped to last_snap_dump.html");
        } else {
            console.log("No HTML in snapshot:", snapshot.error);
        }
    } catch (e) {
        console.error(e);
    }
}
dump();
