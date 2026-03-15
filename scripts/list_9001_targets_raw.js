
import { getJson } from '../core/utils.js';

async function list9001() {
    try {
        const list = await getJson(`http://127.0.0.1:9001/json`);
        console.log(JSON.stringify(list, null, 2));
    } catch (e) {
        console.error("Error fetching 9001 json:", e.message);
    }
}

list9001();
