#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORT = 9000;
const MODEL_TO_TEST = "Claude Sonnet 4.6 (Thinking)";

function getJson(url) {
    return new Promise((resolve) => {
        http.get(url, (res) => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
        }).on('error', () => resolve([]));
    });
}

async function runTest() {
    console.log(`--- 開始測試模型選擇: ${MODEL_TO_TEST} ---`);
    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    const target = targets.find(t => t.title.includes('Antigravity') && t.webSocketDebuggerUrl);
    if (!target) { console.log('找不到視窗'); process.exit(1); }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', async () => {
        const call = (method, params) => new Promise(res => {
            const id = Math.floor(Math.random() * 1000);
            ws.send(JSON.stringify({ id, method, params }));
            ws.on('message', function l(msg) {
                const data = JSON.parse(msg);
                if (data.id === id) { ws.off('message', l); res(data.result); }
            });
        });

        await call('Runtime.enable', {});

        // 從 automation.js 提取的核心邏輯
        const safeModel = MODEL_TO_TEST.replace(/\'/g, "\\\'");
        const SCRIPT = `(async () => {
            try {
                const allEls = Array.from(document.querySelectorAll('*'));
                // 模擬點開選單
                const btn = allEls.find(el => ["Gemini", "Claude", "Model"].some(k => (el.textContent||'').includes(k)) && el.offsetHeight > 0);
                if (btn) btn.click();
                await new Promise(r => setTimeout(r, 1000));

                const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], div'))
                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${safeModel}'));
                
                if (!visibleDialog) return { error: 'Dialog not found' };
                
                const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
                const keywords = '${safeModel}'.replace('(Thinking)', '').trim().split(' ').filter(k => k.length >= 2 && k !== 'Claude');
                
                const containers = allDialogEls.filter(el => {
                    const style = window.getComputedStyle(el);
                    return (el.getAttribute('role') === 'option' || style.cursor === 'pointer') && el.offsetHeight > 0;
                });

                let target = containers.find(el => keywords.every(k => (el.textContent || '').includes(k)));

                if (!target) {
                    target = allDialogEls.sort((a,b) => a.textContent.length - b.textContent.length)
                        .find(el => el.offsetHeight > 0 && keywords.every(k => (el.textContent||'').includes(k)));
                }

                if (target) {
                    let clickable = target;
                    for (let i = 0; i < 3; i++) {
                        const parent = clickable.parentElement;
                        if (!parent || parent === visibleDialog) break;
                        const pStyle = window.getComputedStyle(parent);
                        if (parent.getAttribute('role') === 'option' || pStyle.cursor === 'pointer') {
                            clickable = parent;
                        } else { break; }
                    }
                    // clickable.click(); // 測試時先不要真正點擊，觀察結果
                    return { 
                        success: true, 
                        found: target.textContent.trim(), 
                        clickableTag: clickable.tagName, 
                        clickableClass: clickable.className,
                        clickableRole: clickable.getAttribute('role'),
                        keywords: keywords
                    };
                }
                return { error: 'Target not found' };
            } catch(e) { return { error: e.toString() }; }
        })()`;

        const res = await call('Runtime.evaluate', { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: 3 });
        console.log(JSON.stringify(res?.result?.value, null, 2));
        ws.close();
        process.exit(0);
    });
}

runTest();
