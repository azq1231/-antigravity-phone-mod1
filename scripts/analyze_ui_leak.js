import http from 'http';
import WebSocket from 'ws';

async function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function runQuery(wsUrl, expression) {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 5000);
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

async function analyzeUILeak() {
    console.log('--- 🔎 UI Leak Analysis ---');
    try {
        const list = await getJson(`http://127.0.0.1:9000/json/list`);
        const target = list.find(t => t.url?.includes('workbench.html'));
        if (!target) return console.log('Workbench not found');

        const script = `(() => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            if (!editor) return { error: 'No editor found' };

            let curr = editor;
            const hierarchy = [];
            for (let i = 0; i < 15; i++) {
                if (!curr) break;
                hierarchy.push({
                    level: i,
                    tag: curr.tagName,
                    id: curr.id,
                    className: curr.className,
                    text_preview: curr.innerText?.substring(0, 100).replace(/\\n/g, ' '),
                    hasGemini: curr.innerText?.includes('Gemini'),
                    hasPlanning: curr.innerText?.includes('Planning')
                });
                curr = curr.parentElement;
            }
            return hierarchy;
        })()`;

        const res = await runQuery(target.webSocketDebuggerUrl, script);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) { console.error(e); }
}

analyzeUILeak();
