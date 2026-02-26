#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORT = 9001;

async function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function run() {
    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    const t = targets.find(t => t.webSocketDebuggerUrl && !t.url.includes('extension'));
    if (!t) return;

    const ws = new WebSocket(t.webSocketDebuggerUrl);
    ws.on('open', async () => {
        const call = (method, params) => new Promise(res => {
            const id = Math.random();
            ws.on('message', function listener(msg) {
                const data = JSON.parse(msg);
                if (data.id === id) { ws.off('message', listener); res(data.result); }
            });
            ws.send(JSON.stringify({ id, method, params }));
        });

        await call('Runtime.enable');
        // Wait for contexts
        await new Promise(r => setTimeout(r, 1000));

        const script = `(() => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
                 return b.innerText.includes('Send') || b.querySelector('svg');
            });

            return {
                editor: editor ? editor.outerHTML.substring(0, 1000) : 'MISSING',
                buttons: buttons.map(b => ({
                    html: b.outerHTML.substring(0, 500),
                    disabled: b.disabled,
                    parent: b.parentElement.className
                }))
            };
        })()`;

        const res = await call('Runtime.evaluate', { expression: script, returnByValue: true });
        console.log(JSON.stringify(res.result?.value, null, 2));
        ws.close();
    });
}
run();
