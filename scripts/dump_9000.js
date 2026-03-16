
import { getJson } from '../core/utils.js';
import fs from 'fs';

async function dump() {
    const list = await getJson('http://127.0.0.1:9000/json');
    fs.writeFileSync('tmp_json_9000.json', JSON.stringify(list, null, 2));
    console.log("Dumped to tmp_json_9000.json");
}
dump();
