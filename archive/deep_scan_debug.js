const http = require('http');
const EventEmitter = require('events');

const PORTS = [9000, 9001, 9002, 9003, 9004, 9005];

async function fetchJSON(port) {
    return new Promise((resolve) => {
        http.get(`http://localhost:${port}/json`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch { resolve([]); }
            });
        }).on('error', () => resolve([]));
    });
}

function connectWS(url) {
    return new Promise((resolve, reject) => {
        try {
            // Basic WS handshake manually or use a lib? 
            // Since we don't have 'ws' lib guaranteed in this environment unless installed... 
            // Wait, we DO use 'ws' in server_v4.js. We can require it.
            const WebSocket = require('ws');
            const ws = new WebSocket(url);
            ws.on('open', () => resolve(ws));
            ws.on('error', (e) => reject(e));
        } catch (e) { reject(e); }
    });
}

async function runCDP(ws, method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = Math.random();
        ws.send(JSON.stringify({ id, method, params }));
        const onMsg = (msg) => {
            const data = JSON.parse(msg);
            if (data.id === id) {
                ws.off('message', onMsg);
                if (data.error) reject(data.error);
                else resolve(data.result);
            }
        };
        ws.on('message', onMsg);
    });
}

async function scanTarget(port, target) {
    if (!target.webSocketDebuggerUrl) return;
    try {
        console.log(`\n➡️ Connecting to Port ${port} Target: "${target.title}" (${target.id})`);
        const WebSocket = require('ws');
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise(r => ws.on('open', r));

        // Enable Runtime
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

        // Listen for Contexts
        const contexts = [];
        ws.on('message', (msg) => {
            const d = JSON.parse(msg);
            if (d.method === 'Runtime.executionContextCreated') {
                contexts.push(d.params.context);
            }
        });

        // Wait a bit for contexts
        await new Promise(r => setTimeout(r, 1000));

        console.log(`   Found ${contexts.length} Contexts.`);

        for (const ctx of contexts) {
            // Check DOM count
            const evalRes = await new Promise(resolve => {
                const id = Math.random();
                ws.send(JSON.stringify({
                    id, method: 'Runtime.evaluate',
                    params: {
                        expression: 'document.querySelectorAll("*").length + " elements | Title: " + document.title + " | Cascade: " + (document.getElementById("cascade") ? "YES" : "NO")',
                        contextId: ctx.id,
                        returnByValue: true
                    }
                }));
                const listener = (m) => {
                    const d = JSON.parse(m);
                    if (d.id === id) { ws.off('message', listener); resolve(d); }
                };
                ws.on('message', listener);
            });

            if (evalRes.result && evalRes.result.value) {
                console.log(`   🔸 Ctx ${ctx.id} (${ctx.name}): ${evalRes.result.value}`);
            } else {
                console.log(`   🔸 Ctx ${ctx.id} (${ctx.name}): (No Access/Result)`);
            }
        }

        ws.close();
    } catch (e) {
        console.log(`   ❌ Failed: ${e.message}`);
    }
}

async function main() {
    console.log("🔍 STARTING DEEP DOM SCAN (9000-9005)...");
    for (const port of PORTS) {
        process.stdout.write(`Checking Port ${port}... `);
        const targets = await fetchJSON(port);
        console.log(`${targets.length} targets.`);

        for (const t of targets) {
            if (t.type === 'page' || t.type === 'webview') {
                await scanTarget(port, t);
            }
        }
    }
    console.log("✅ SCAN COMPLETE");
    process.exit(0);
}

main();
