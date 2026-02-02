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

async function locateForbiddenText() {
    console.log('--- 🔎 Forbidden Text Location ---');
    try {
        const list = await getJson(`http://127.0.0.1:9000/json/list`);
        const target = list.find(t => t.url?.includes('workbench.html'));
        if (!target) return;

        const script = `(() => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            const findText = (text) => {
                const results = [];
                const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
                let node;
                while (node = walk.nextNode()) {
                    if (node.innerText?.includes(text) && node.childElementCount === 0) {
                        results.push({
                            tag: node.tagName,
                            className: node.className,
                            text: node.innerText,
                            isInsideEditorParent: editor?.parentElement?.contains(node) || false
                        });
                    }
                }
                return results;
            };

            const gemini = findText('Gemini');
            const planning = findText('Planning');
            
            // Also find the container picked by V2 logic
            let v2Container = null;
            let curr = editor;
            for (let i = 0; i < 10; i++) {
                if (!curr || curr === document.body) break;
                if (curr.offsetHeight > 400 || curr.className.includes('chat')) {
                    v2Container = {
                        tag: curr.tagName,
                        className: curr.className,
                        id: curr.id,
                        text: curr.innerText.substring(0, 100).replace(/\\n/g, ' ')
                    };
                    break;
                }
                curr = curr.parentElement;
            }

            return { gemini, planning, v2Container };
        })()`;

        const res = await runQuery(target.webSocketDebuggerUrl, script);
        console.log(JSON.stringify(res, null, 2));
    } catch (e) { console.error(e); }
}

locateForbiddenText();
