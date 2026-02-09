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

async function debugBusy() {
    console.log('--- 🔎 Busy Element Inspection ---');
    try {
        const list = await getJson(`http://127.0.0.1:9000/json/list`);
        const target = list.find(t => t.url?.includes('workbench.html'));
        if (!target) return console.log('Workbench not found');

        const script = `(() => {
            const results = [];
            
            // 1. Check specific tooltip
            const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (cancel) results.push({ name: 'cancel-tooltip', visible: cancel.offsetParent !== null, height: cancel.offsetHeight, opacity: window.getComputedStyle(cancel).opacity });
            
            // 2. Check stop icon
            const stopSvgs = [...document.querySelectorAll('button svg.lucide-square, button svg.lucide-circle-stop')];
            stopSvgs.forEach(svg => {
                const btn = svg.closest('button');
                if (btn) results.push({ name: 'stop-icon-btn', visible: btn.offsetParent !== null, height: btn.offsetHeight, text: btn.innerText });
            });
            
            // 3. Check for any "Stop" text
            const allBtns = [...document.querySelectorAll('button')];
            allBtns.forEach(btn => {
                if (btn.innerText.includes('Stop') || btn.innerText.includes('Cancel')) {
                    results.push({ name: 'text-btn', text: btn.innerText, visible: btn.offsetParent !== null });
                }
            });

            return results;
        })()`;

        const res = await runQuery(target.webSocketDebuggerUrl, script);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) { console.error(e); }
}

debugBusy();
