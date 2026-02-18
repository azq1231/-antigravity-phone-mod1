#!/usr/bin/env node
// 診斷 CDP 連線狀態，找出 Chat Panel 的 execution context
// 具備進階診斷功能：輸入框、發送按鈕、捲動狀態、資源路徑
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

async function connectAndInspect(wsUrl, targetTitle) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const contexts = [];
        let idCounter = 1;
        const pending = new Map();
        const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 8000);

        ws.on('open', async () => {
            clearTimeout(timeout);

            const call = (method, params) => new Promise((res, rej) => {
                const id = idCounter++;
                const t = setTimeout(() => { pending.delete(id); res(null); }, 5000);
                pending.set(id, { resolve: res, reject: rej, timeoutId: t });
                ws.send(JSON.stringify({ id, method, params }));
            });

            ws.on('message', msg => {
                try {
                    const data = JSON.parse(msg);
                    if (data.id && pending.has(data.id)) {
                        const p = pending.get(data.id);
                        clearTimeout(p.timeoutId);
                        pending.delete(data.id);
                        if (data.error) p.reject(data.error);
                        else p.resolve(data.result);
                    }
                    if (data.method === 'Runtime.executionContextCreated') {
                        contexts.push(data.params.context);
                    }
                } catch (e) { }
            });

            // 啟用 Runtime 來獲取所有 execution contexts
            await call('Runtime.enable');
            await new Promise(r => setTimeout(r, 500));

            console.log(`\n📌 Target: "${targetTitle}" | Contexts: ${contexts.length}`);

            for (const ctx of contexts) {
                console.log(`  🔹 Context ${ctx.id}: name="${ctx.name}" origin="${ctx.origin}"`);

                // 在每個 context 中檢查是否有 chat 相關元素及功能狀態
                try {
                    const res = await call('Runtime.evaluate', {
                        expression: `(() => {
                            const conversation = document.querySelector('#conversation');
                            const chat = document.querySelector('#chat');
                            const cascade = document.querySelector('#cascade');
                            const lexical = document.querySelector('[data-lexical-editor="true"]') || document.querySelector('[contenteditable="true"]');
                            const main = document.querySelector('main');
                            
                            // 1. 檢查發送按鈕
                            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                            const sendBtn = buttons.find(b => {
                                const txt = (b.innerText + (b.getAttribute('aria-label')||'') + (b.title||'')).toLowerCase();
                                return txt.includes('send') || txt.includes('發送') || b.querySelector('svg.lucide-send') || b.querySelector('.lucide-send');
                            });

                            // 2. 檢查捲動容器
                            const scrollEl = document.querySelector('.overflow-y-auto, [data-scroll-area]') || conversation || chat;
                            const scrollable = scrollEl ? (scrollEl.scrollHeight > scrollEl.clientHeight) : false;

                            // 3. 檢查壞路徑 (可能會在手機破圖)
                            const badPaths = Array.from(document.querySelectorAll('img, style, link')).filter(el => {
                                const src = el.src || el.href || '';
                                return typeof src === 'string' && (src.includes('vscode-file://') || src.includes('file://'));
                            }).length;

                            const title = document.title;
                            const bodyLen = document.body ? document.body.innerHTML.length : 0;
                            const url = window.location.href;

                            return {
                                hasConversation: !!conversation,
                                hasChat: !!chat,
                                hasLexical: !!lexical,
                                matchQuality: (conversation || chat || cascade) ? 'EXACT' : (main ? 'LOOSE' : 'FALLBACK'),
                                inputReady: !!lexical && (lexical.offsetParent !== null || lexical.offsetWidth > 0),
                                hasSendBtn: !!sendBtn,
                                scrollStatus: scrollable ? 'Scrollable' : 'Fixed/Empty',
                                badResourceCount: badPaths,
                                title: title,
                                bodyLen: bodyLen,
                                url: url.substring(0, 120)
                            };
                        })()`,
                        returnByValue: true,
                        contextId: ctx.id
                    });

                    if (res?.result?.value) {
                        const v = res.result.value;
                        console.log(`    📊 [Quality: ${v.matchQuality}] title="${v.title}" bodyLen=${v.bodyLen}`);
                        console.log(`    📊 URL: ${v.url}`);
                        console.log(`    ⚙️  功能檢查: InputReady=${v.inputReady} | SendBtn=${v.hasSendBtn} | Scroll=${v.scrollStatus}`);

                        if (v.badResourceCount > 0) {
                            console.log(`    ⚠️ 資源警告: 發現 ${v.badResourceCount} 個潛在的本地路徑連結，這可能導致手機端破圖！`);
                        }

                        if (v.matchQuality === 'EXACT') {
                            console.log(`    ✅ >>> 發現核心對話視窗！此 Context 最穩定 <<<`);
                        }
                    }
                } catch (e) {
                    console.log(`    ❌ Error: ${e.message || JSON.stringify(e)}`);
                }
            }

            // 如果沒有 context，直接在 default context 試
            if (contexts.length === 0) {
                console.log(`  ⚠️ 沒有 execution contexts，嘗試 default context...`);
                try {
                    const res = await call('Runtime.evaluate', {
                        expression: `(() => {
                            return {
                                hasConversation: !!document.querySelector('#conversation'),
                                hasCascade: !!document.querySelector('#cascade'),
                                title: document.title,
                                bodyLen: document.body?.innerHTML.length || 0
                            };
                        })()`,
                        returnByValue: true
                    });
                    if (res?.result?.value) {
                        const v = res.result.value;
                        console.log(`    📊 title="${v.title}" bodyLen=${v.bodyLen} cascade=${v.hasCascade}`);
                    }
                } catch (e) {
                    console.log(`    ❌ ${e.message || JSON.stringify(e)}`);
                }
            }

            ws.close();
            resolve();
        });
        ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
}

async function main() {
    console.log(`🔍 升級版診斷工具 - 正在掃描 CDP Port ${PORT}...\n`);

    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    console.log(`找到 ${targets.length} 個 targets:`);
    targets.forEach((t, i) => {
        console.log(`  [${i}] type=${t.type} title="${t.title || '(empty)'}" wsUrl=${t.webSocketDebuggerUrl ? 'YES' : 'NO'}`);
    });

    const connectableTargets = targets.filter(t => t.webSocketDebuggerUrl);

    for (const target of connectableTargets) {
        try {
            await connectAndInspect(
                target.webSocketDebuggerUrl,
                `${target.type}: ${target.title || '(no title)'}`
            );
        } catch (e) {
            console.log(`\n❌ 無法連接 "${target.title}": ${e.message}`);
        }
    }

    console.log('\n✅ 診斷完成。請根據上方「⚙️ 功能檢查」判斷狀態。');
    process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
