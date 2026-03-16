
import { getJson } from '../core/utils.js';

async function list() {
    const list = await getJson('http://127.0.0.1:9000/json');
    console.log(JSON.stringify(list.map(t => ({
        title: t.title,
        type: t.type,
        url: t.url,
        ws: !!t.webSocketDebuggerUrl
    })), null, 2));
}
list();
