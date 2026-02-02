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

async function checkBusy() {
    console.log('--- 🔍 Busy Status Deep Dive ---');
    try {
        const list = await getJson(`http://127.0.0.1:9000/json/list`);
        const target = list.find(t => t.url?.includes('workbench.html'));
        if (!target) return;

        const result = await runQuery(target.webSocketDebuggerUrl, `(() => {
            const cancelBtn = document.querySelector('[data-tooltip-id*="cancel"]');
            const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
            
            return {
                cancelBtn: cancelBtn ? {
                    id: cancelBtn.id,
                    className: cancelBtn.className,
                    tooltip: cancelBtn.getAttribute('data-tooltip-id'),
                    visible: cancelBtn.offsetParent !== null,
                    rect: cancelBtn.getBoundingClientRect()
                } : null,
                stopBtn: stopBtn ? {
                    visible: stopBtn.offsetParent !== null
                } : null
            };
        })()`);

        console.log(JSON.stringify(result, null, 2));
    } catch (e) { console.error(e); }
}

checkBusy();
