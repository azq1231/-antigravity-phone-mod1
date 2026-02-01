import http from 'http';
import WebSocket from 'ws';

const PORTS = [9000, 9001, 9002, 9003];

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

async function checkCascade() {
    console.log('🔍 Checking for #cascade ID...');
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            const target = list.find(t => t.url?.includes('workbench.html')) || list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);

            if (!target) {
                console.log(`Port ${port}: No workbench found.`);
                continue;
            }

            console.log(`Port ${port}: Workbench found. Connecting...`);
            const ws = new WebSocket(target.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
                setTimeout(() => reject(new Error('Timeout')), 3000);
            });

            const call = (method, params) => new Promise((resolve, reject) => {
                const id = Math.floor(Math.random() * 1000000);
                const handler = (msg) => {
                    const data = JSON.parse(msg);
                    if (data.id === id) {
                        ws.off('message', handler);
                        if (data.error) reject(data.error); else resolve(data.result);
                    }
                };
                ws.on('message', handler);
                ws.send(JSON.stringify({ id, method, params }));
            });

            const checkScript = `(() => {
                let s = "";
                const mic = [...document.querySelectorAll('div, span, button')].find(el => {
                    const html = el.innerHTML;
                    return (html.includes('mic') || html.includes('microphone') || (el.querySelector('svg') && !el.innerText)) && el.getBoundingClientRect().top > 500;
                });
                
                if (mic) {
                    s += "BOTTOM_MIC: " + mic.tagName + "." + mic.className + "\\n";
                    let p = mic;
                    for (let i = 0; i < 10; i++) {
                        if (!p) break;
                        s += "  [" + i + "]: " + p.tagName + "." + p.className + " | ATTR: " + JSON.stringify(Object.fromEntries([...p.attributes].map(a => [a.name, a.value]))) + "\\n";
                        p = p.parentElement;
                    }
                }
                
                return s;
            })()`;

            const result = await call("Runtime.evaluate", { expression: checkScript, returnByValue: true });
            console.log(`Port ${port} Result:`, JSON.stringify(result.result.value, null, 2));
            ws.close();
        } catch (e) {
            console.log(`Port ${port} Error: ${e.message}`);
        }
    }
}

checkCascade();
