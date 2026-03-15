
import { getOrConnectParams } from '../core/cdp_manager.js';

async function listAll() {
    const port = 9001;
    const conns = await getOrConnectParams(port, true);
    console.log(JSON.stringify(conns.map(c => ({ title: c.title, url: c.url, type: c.type })), null, 2));
    process.exit(0);
}
listAll();
