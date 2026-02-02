
import WebSocket from 'ws';
import http from 'http';

const PORT = 9000;

async function diagnose() {
    console.log(`[DIAGNOSE] Checking Port ${PORT}...`);

    // 1. Check /json/version
    try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log(`[PASS] CDP Info found: ${data.Browser}`);
        console.log(`[INFO] WebSocket Debug URL: ${data.webSocketDebuggerUrl}`);
    } catch (e) {
        console.error(`[FAIL] Could not connect to http://127.0.0.1:${PORT}/json/version`);
        console.error(`       Reason: ${e.message}`);
        console.error(`       Is Antigravity.exe running?`);
        return;
    }

    // 2. Find Page Target
    let target = null;
    try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const targets = await res.json();
        target = targets.find(t => t.type === 'page' && t.url.includes('window.html')) || targets[0];

        if (!target) {
            console.error(`[FAIL] No suitable page target found.`);
            console.log('Targets:', targets.map(t => t.url));
            return;
        }
        console.log(`[PASS] Found target: ${target.title} (${target.url})`);
    } catch (e) { }

    if (!target || !target.webSocketDebuggerUrl) return;

    // 3. Connect WS and Check Selector
    const ws = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    console.log(`[PASS] WebSocket Connected.`);

    const call = (method, params) => new Promise((resolve) => {
        const id = Date.now();
        ws.send(JSON.stringify({ id, method, params }));
        ws.once('message', msg => {
            const d = JSON.parse(msg);
            if (d.id === id) resolve(d.result);
        });
    });

    // Check #cascade
    const evalRes = await call('Runtime.evaluate', {
        expression: `!!document.getElementById('cascade')`,
        returnByValue: true
    });

    const hasCascade = evalRes?.result?.value;
    console.log(`[CHECK] document.getElementById('cascade') exists? ${hasCascade ? '✅ YES' : '❌ NO'}`);

    if (!hasCascade) {
        // Dumy Body HTML to see what's there
        const bodyRes = await call('Runtime.evaluate', {
            expression: `document.body.innerHTML.substring(0, 500)`,
            returnByValue: true
        });
        console.log(`[DEBUG] Body Preview: ${bodyRes?.result?.value}`);
    }

    ws.close();
}

diagnose();
