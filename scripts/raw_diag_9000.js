
import { getJson } from '../core/utils.js';
import WebSocket from 'ws';

async function diagnose() {
    const list = await getJson('http://127.0.0.1:9000/json');
    console.log(`Found ${list.length} raw targets on 9000.`);
    
    for (const t of list) {
        if (!t.webSocketDebuggerUrl) continue;
        console.log(`\nConnecting to: ${t.title || 'Untitled'} (${t.type})`);
        
        try {
            const ws = new WebSocket(t.webSocketDebuggerUrl);
            await new Promise((res, rej) => {
                ws.on('open', res);
                ws.on('error', rej);
                setTimeout(() => rej(new Error('Timeout')), 2000);
            });
            
            const call = (method, params) => new Promise((res) => {
                const id = Math.floor(Math.random() * 100000);
                ws.send(JSON.stringify({ id, method, params }));
                ws.on('message', function listener(msg) {
                    const data = JSON.parse(msg);
                    if (data.id === id) {
                        ws.removeListener('message', listener);
                        res(data.result);
                    }
                });
            });
            
            await call('Runtime.enable', {});
            const snap = await call('Runtime.evaluate', {
                expression: `({
                    url: window.location.href,
                    html: document.body.innerHTML.substring(0, 500)
                })`,
                returnByValue: true
            });
            
            console.log(`  URL: ${snap?.result?.value?.url}`);
            console.log(`  HTML: ${snap?.result?.value?.html?.replace(/\n/g, ' ')}`);
            ws.close();
        } catch (e) {
            console.log(`  Connection failed: ${e.message}`);
        }
    }
    process.exit(0);
}
diagnose();
