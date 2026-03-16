
import { getOrConnectParams } from '../core/cdp_manager.js';

async function list() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    console.log(`Active Connections for Port ${port}: ${conns.length}`);
    conns.forEach((c, i) => {
        console.log(`[${i}] Title: ${c.title.substring(0, 50)}... | URL: ${c.url.substring(0, 50)}...`);
    });
}
list();
