#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORTS = [9000, 9001, 9002, 9003];

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

async function inspectPort(port) {
    console.log(`\n========================================`);
    console.log(`PORT ${port} DIAGNOSIS`);
    console.log(`========================================`);
    let targets;
    try {
        targets = await getJson(`http://127.0.0.1:${port}/json`);
    } catch (e) {
        console.log(`Port ${port} is NOT active.`);
        return;
    }

    for (const t of targets) {
        if (!t.webSocketDebuggerUrl) continue;
        if (t.title.includes('Service Worker') || t.url.includes('extension')) continue;

        await new Promise((resolve) => {
            const ws = new WebSocket(t.webSocketDebuggerUrl);
            ws.on('open', async () => {
                const call = (method, params) => new Promise(res => {
                    const id = Math.floor(Math.random() * 100000);
                    const onMsg = (msg) => {
                        const data = JSON.parse(msg);
                        if (data.id === id) {
                            ws.off('message', onMsg);
                            res(data.result);
                        }
                    };
                    ws.on('message', onMsg);
                    ws.send(JSON.stringify({ id, method, params }));
                });

                await call('Runtime.enable');

                const diagScript = `(() => {
                    const dump = (el) => {
                        if (!el) return null;
                        return {
                            tag: el.tagName,
                            id: el.id,
                            cls: el.className,
                            innerText: (el.innerText || "").substring(0, 30).replace(/\\n/g, ' '),
                            ariaLabel: el.getAttribute('aria-label') || "",
                            title: el.getAttribute('title') || "",
                            disabled: el.disabled,
                            isVisible: el.offsetWidth > 0 && el.offsetHeight > 0,
                            svgs: Array.from(el.querySelectorAll('svg')).map(s => s.className.baseVal || s.getAttribute('class') || 'svg')
                        };
                    };

                    const editors = Array.from(document.querySelectorAll('[data-lexical-editor="true"], [contenteditable="true"]'));
                    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.button'));

                    return {
                        title: document.title,
                        url: window.location.href,
                        editors: editors.map(dump),
                        buttons: buttons.filter(b => {
                            const txt = (b.innerText + ' ' + (b.getAttribute('aria-label')||'') + ' ' + (b.title||'')).toLowerCase();
                            return txt.includes('send') || txt.includes('submit') || txt.includes('發送') || txt.includes('送出') || b.querySelector('svg');
                        }).map(dump)
                    };
                })()`;

                const res = await call('Runtime.evaluate', { expression: diagScript, returnByValue: true });
                if (res?.result?.value) {
                    const v = res.result.value;
                    if (v.editors.length > 0 || v.buttons.length > 0) {
                        console.log(`Target: "${v.title}"`);
                        v.editors.forEach((e, i) => {
                            console.log(`  [Editor ${i}] Tag:${e.tag} ID:${e.id} Visible:${e.isVisible} Cls:${e.cls}`);
                        });
                        v.buttons.forEach((b, i) => {
                            if (b.isVisible) {
                                console.log(`  [Button ${i}] Text:"${b.innerText}" Aria:"${b.ariaLabel}" Title:"${b.title}" Disabled:${b.disabled}`);
                                console.log(`             SVGs: ${b.svgs.join(', ')}`);
                            }
                        });
                    }
                }
                ws.close();
                resolve();
            });
            ws.on('error', () => resolve());
            setTimeout(() => { ws.close(); resolve(); }, 2000);
        });
    }
}

async function run() {
    for (const port of PORTS) {
        await inspectPort(port);
    }
}

run();
