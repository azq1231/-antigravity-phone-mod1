#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORT = 9000;

function getJson(url) {
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

async function probeModelSelector(wsUrl, targetTitle) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const contexts = [];
        let idCounter = 1;
        const pending = new Map();
        const timeout = setTimeout(() => { ws.close(); resolve(); }, 5000);

        ws.on('open', async () => {
            const call = (method, params) => new Promise((res, rej) => {
                const id = idCounter++;
                pending.set(id, { resolve: res, reject: rej });
                ws.send(JSON.stringify({ id, method, params }));
            });

            ws.on('message', msg => {
                const data = JSON.parse(msg);
                if (data.id && pending.has(data.id)) {
                    const p = pending.get(data.id);
                    pending.delete(data.id);
                    p.resolve(data.result);
                }
                if (data.method === 'Runtime.executionContextCreated') {
                    contexts.push(data.params.context);
                }
            });

            await call('Runtime.enable');
            await new Promise(r => setTimeout(r, 400));

            console.log(`\n🔍 探測 Target: "${targetTitle}"`);
            const ctxIds = contexts.length > 0 ? contexts.map(c => c.id) : [undefined];

            for (const id of ctxIds) {
                try {
                    const res = await call('Runtime.evaluate', {
                        expression: `(() => {
                            const find = (keywords) => {
                                const els = Array.from(document.querySelectorAll('button, div, span, a'));
                                return els.find(el => {
                                    const txt = (el.innerText || '').toLowerCase();
                                    return keywords.some(k => txt.includes(k.toLowerCase())) && el.offsetHeight > 0;
                                });
                            };

                            const modelBtn = find(['Gemini', 'Claude', 'GPT', 'Model']);
                            const cascade = !!document.querySelector('#conversation, #chat, #cascade');
                            
                            return {
                                title: document.title,
                                url: window.location.href.substring(0, 80),
                                hasModelBtn: !!modelBtn,
                                btnText: modelBtn ? modelBtn.innerText : null,
                                btnTag: modelBtn ? modelBtn.tagName : null,
                                isChatWebView: cascade
                            };
                        })()`,
                        returnByValue: true,
                        contextId: id
                    });

                    if (res?.result?.value) {
                        const v = res.result.value;
                        console.log(`  [Ctx ${id}] ChatView=${v.isChatWebView} | ModelBtn=${v.hasModelBtn} | Text="${v.btnText}" | URL=${v.url}`);
                        if (v.hasModelBtn) console.log(`    🎯 找到了！這個 Context 有模型按鈕！`);
                    }
                } catch (e) { }
            }
            ws.close();
            resolve();
        });
    });
}

async function main() {
    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    for (const t of targets) {
        if (t.webSocketDebuggerUrl) {
            await probeModelSelector(t.webSocketDebuggerUrl, t.title);
        }
    }
}

main();
