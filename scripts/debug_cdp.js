import http from 'http';
import WebSocket from 'ws';

const ports = [9000];

async function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Failed to parse JSON`)); }
            });
        });
        req.on('error', (e) => reject(e));
        req.setTimeout(2000);
    });
}

async function runQuery(wsUrl, expression) {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 5000);
        ws.on('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression, returnByValue: true, awaitPromise: true }
            }));
        });
        ws.on('message', (msg) => {
            const data = JSON.parse(msg);
            if (data.id === 1) {
                clearTimeout(timeout);
                ws.close();
                resolve(data.result.result.value);
            }
        });
        ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
}

async function diagnose() {
    console.log('--- Probing Container Candidates ---');
    for (const port of ports) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            const target = list.find(t => t.url?.includes('workbench.html'));
            if (!target) continue;

            const query = `(() => {
                const editor = document.querySelector('[data-lexical-editor="true"]');
                if (!editor) return { error: 'No editor found' };

                let curr = editor;
                const candidates = [];
                for (let i = 0; i < 10; i++) {
                    if (!curr || curr === document.body) break;
                    candidates.push({
                        tag: curr.tagName,
                        id: curr.id,
                        classes: curr.className.substring(0, 100),
                        children: curr.childElementCount,
                        textLength: (curr.innerText || '').length
                    });
                    curr = curr.parentElement;
                }
                return candidates;
            })()`;

            const results = await runQuery(target.webSocketDebuggerUrl, query);
            console.log(JSON.stringify(results, null, 2));
        } catch (e) {
            console.log('Error:', e.message);
        }
    }
}

diagnose();
