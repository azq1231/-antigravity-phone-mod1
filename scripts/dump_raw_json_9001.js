
import { getJson } from '../core/utils.js';

async function dumpRawJson() {
    const port = 9001;
    try {
        const list = await getJson(`http://127.0.0.1:${port}/json`);
        console.log(JSON.stringify(list, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

dumpRawJson();
