import http from 'http';
import WebSocket from 'ws';

async function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

function runQuery(wsUrl, expression) {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 5000);
        ws.on('open', () => { ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
        ws.on('message', (msg) => { const data = JSON.parse(msg); if (data.id === 1) { clearTimeout(timeout); ws.close(); resolve(data.result.result.value); } });
        ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
}

async function simulateV3() {
    console.log('--- 🧪 V3 容器探測模擬 ---');
    try {
        const list = await getJson(`http://127.0.0.1:9000/json/list`);
        const target = list.find(t => t.url?.includes('workbench.html'));
        if (!target) return;

        const script = `(() => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            if (!editor) return { error: 'No editor' };
            
            let curr = editor;
            let found = null;
            for (let i = 0; i < 15; i++) {
                if (!curr || curr === document.body) break;
                
                const rect = curr.getBoundingClientRect();
                const isCorrectSize = rect.height > 200 && rect.width < window.innerWidth * 0.95;
                const isChatPanel = curr.className.includes('chat');
                
                if (isChatPanel || (isCorrectSize && i > 2)) {
                    found = { level: i, id: curr.id, className: curr.className, width: rect.width, height: rect.height, text: curr.innerText.substring(0, 50) };
                    break;
                }
                curr = curr.parentElement;
            }
            return found || { error: 'Not found, fallback to body' };
        })()`;

        const res = await runQuery(target.webSocketDebuggerUrl, script);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) { console.error(e); }
}

simulateV3();
