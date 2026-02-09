import WebSocket from 'ws';
import http from 'http';

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function scanForCascade(port) {
    console.log(`\n--- Scanning Port ${port} ---`);
    try {
        const list = await getJson(`http://127.0.0.1:${port}/json`);
        for (const target of list) {
            if (!target.webSocketDebuggerUrl) continue;
            console.log(`Checking [${target.type}] "${target.title}" ...`);

            const ws = new WebSocket(target.webSocketDebuggerUrl);
            try {
                await new Promise((resolve, reject) => {
                    const t = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 3000);
                    ws.on('open', () => { clearTimeout(t); resolve(); });
                    ws.on('error', reject);
                });

                let idCounter = 1;
                const call = (method, params) => new Promise((res) => {
                    const id = idCounter++;
                    const handler = (msg) => {
                        const data = JSON.parse(msg);
                        if (data.id === id) {
                            ws.removeListener('message', handler);
                            res(data.result);
                        }
                    };
                    ws.on('message', handler);
                    ws.send(JSON.stringify({ id, method, params }));
                });

                await call("Runtime.enable", {});
                const check = await call("Runtime.evaluate", {
                    expression: `(() => {
                        const c = document.getElementById('cascade') || document.querySelector('[class*="cascade"]');
                        return c ? ('FOUND: ' + c.id + ' | ' + c.className) : 'NOT FOUND';
                    })()`,
                    returnByValue: true
                });

                console.log(`Result: ${check?.result?.value}`);
                ws.close();
            } catch (e) {
                console.log(`Failed: ${e.message}`);
                ws.close();
            }
        }
    } catch (e) {
        console.log(`Port ${port} Error: ${e.message}`);
    }
}

(async () => {
    await scanForCascade(9000);
    await scanForCascade(9001);
})();
