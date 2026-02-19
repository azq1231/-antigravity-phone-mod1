#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORT = 9000;

function getJson(url) {
    return new Promise((resolve) => {
        http.get(url, (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', () => resolve([]));
    });
}

async function scanMenu() {
    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    const target = targets.find(t => t.title.includes('Antigravity') && t.webSocketDebuggerUrl);
    if (!target) process.exit(1);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', async () => {
        const call = (method, params) => new Promise(res => {
            const id = Math.floor(Math.random() * 1000);
            ws.send(JSON.stringify({ id, method, params }));
            const l = (msg) => {
                const data = JSON.parse(msg);
                if (data.id === id) { ws.off('message', l); res(data.result); }
            };
            ws.on('message', l);
        });

        await call('Runtime.enable', {});

        const SCRIPT = `(async () => {
            const btn = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => 
                ["Gemini", "Claude", "GPT", "Model"].some(k => (el.textContent||'').includes(k)) && el.offsetHeight > 0
            );
            if (btn) btn.click();
            await new Promise(r => setTimeout(r, 1000));

            // 抓取所有包含 Claude 的元素，並列出詳細資訊
            return Array.from(document.querySelectorAll('*'))
                .filter(el => (el.textContent || '').includes('Claude') && el.offsetHeight > 0)
                .map(el => ({
                    tag: el.tagName,
                    text: el.textContent.trim(),
                    innerText: el.innerText ? el.innerText.trim() : '',
                    html: el.innerHTML.substring(0, 100),
                    childCount: el.children.length,
                    rect: { w: el.offsetWidth, h: el.offsetHeight }
                }));
        })()`;

        const res = await call('Runtime.evaluate', { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: 3 });
        console.log(JSON.stringify(res?.result?.value, null, 2));
        ws.close();
        process.exit(0);
    });
}

scanMenu();
