
import { getJson } from '../core/utils.js';

async function listAllTypes() {
    const port = 9001;
    try {
        const list = await getJson(`http://127.0.0.1:${port}/json`);
        list.forEach(t => {
            console.log(`Title: "${t.title}", Type: "${t.type}", URL: ${t.url}`);
        });
    } catch (e) { console.error(e); }
    process.exit(0);
}

listAllTypes();
