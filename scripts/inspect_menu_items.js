#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORT = 9000;

function call(ws, method, params) {
    return new Promise((resolve) => {
        const id = Math.floor(Math.random() * 100000);
        const timeout = setTimeout(() => resolve({ error: 'Timeout' }), 5000);
        ws.send(JSON.stringify({ id, method, params }));

        const listener = (msg) => {
            const data = JSON.parse(msg);
            if (data.id === id) {
                clearTimeout(timeout);
                ws.off('message', listener);
                resolve(data.result);
            }
        };
        ws.on('message', listener);
    });
}

async function inspectModelMenu() {
    const list = await new Promise(r => http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => r(JSON.parse(d)));
    }));

    const target = list.find(t => t.title.includes('Antigravity') && t.webSocketDebuggerUrl);
    if (!target) return console.log('找不到 Antigravity target');

    console.log(`正在連接: ${target.title}`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);

    ws.on('open', async () => {
        console.log('WS 連接成功');
        await call(ws, 'Runtime.enable', {});

        // 先找出所有 Contexts
        const contexts = [];
        ws.on('message', (msg) => {
            const data = JSON.parse(msg);
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            }
        });

        // 等待 Contexts 載入
        await new Promise(r => setTimeout(r, 600));
        console.log(`發現 ${contexts.length} 個 Contexts`);

        for (const ctx of contexts) {
            console.log(`\n--- 診斷 Context ${ctx.id} (${ctx.name}) ---`);
            const EXP = `(async () => {
                const results = [];
                try {
                    // 1. 尋找並嘗試打開選單
                    const btns = Array.from(document.querySelectorAll('button, [role=\"button\"], div')).filter(el => {
                        const t = el.innerText || '';
                        return (t.includes('Gemini') || t.includes('Claude') || t.includes('Model')) && el.offsetHeight > 0;
                    });
                    
                    if (btns.length > 0) {
                        results.push('發現潛在按鈕: ' + btns.map(b => b.innerText.substring(0,20)).join(', '));
                        // 不要真的點擊，先觀察目前畫面上的 dialog
                    }

                    // 2. 抓取畫面上所有可見的選單選項
                    const allEls = Array.from(document.querySelectorAll('*'));
                    const menuItems = allEls.filter(el => {
                        const text = el.innerText || '';
                        return el.children.length === 0 && 
                               (text.includes('Claude') || text.includes('Gemini') || text.includes('GPT')) &&
                               el.offsetHeight > 0;
                    });

                    menuItems.forEach(item => {
                        results.push(\`[Found Item] Text: "\${item.innerText}" | Tag: \${item.tagName} | Parent: \${item.parentElement.tagName} | Rect: \${item.offsetWidth}x\${item.offsetHeight}\`);
                    });

                    if (results.length === 0) results.push('此 Context 未發現相關元素');
                } catch(e) { results.push('Error: ' + e.toString()); }
                return results;
            })()`;

            const res = await call(ws, 'Runtime.evaluate', {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (res && res.result && res.result.value) {
                console.log(res.result.value.join('\n'));
            } else {
                console.log('無法獲取結果: ', JSON.stringify(res));
            }
        }

        ws.close();
    });
}

inspectModelMenu();
