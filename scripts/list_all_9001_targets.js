
import { getOrConnectParams } from '../core/cdp_manager.js';

async function listAllTargets() {
    const port = 9001;
    console.log(`--- [CDP Target List] Port ${port} ---`);
    try {
        const conn = await getOrConnectParams(port, true);
        for (const cdp of conn) {
            console.log(`ID: ${cdp.id}`);
            console.log(`Title: ${cdp.title}`);
            console.log(`Type: ${cdp.type}`);
            console.log(`URL: ${cdp.url}`);
            console.log(`Contexts:`, JSON.stringify(cdp.contexts));
            console.log('---');
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

listAllTargets();
