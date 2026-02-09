import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:9000/devtools/page/CEF64CA772B82B75319D4EDC3BA3FF07';

async function dumpDom() {
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    console.log('Connected to target CEF64...');

    let id = 1;
    const pending = new Map();
    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.id && pending.has(data.id)) { pending.get(data.id)(data.result); pending.delete(data.id); }
    });
    const call = (method, params) => new Promise((resolve) => {
        const curId = id++;
        pending.set(curId, resolve);
        ws.send(JSON.stringify({ id: curId, method, params }));
    });

    await call("Runtime.enable", {});
    const res = await call("Runtime.evaluate", {
        expression: `document.documentElement.outerHTML`,
        returnByValue: true
    });
    console.log('HTML Length:', res.result.value.length);
    console.log('HTML Preview:', res.result.value.substring(0, 500));
    ws.close();
    process.exit(0);
}

dumpDom().catch(console.error);
