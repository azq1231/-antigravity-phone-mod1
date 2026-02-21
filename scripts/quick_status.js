import WebSocket from 'ws';
import http from 'http';

const PORTS = [9000, 9001, 9002, 9003];

function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(1000, () => { req.destroy(); resolve(null); });
    });
}

async function checkPort(port) {
    const targets = await getJson(`http://127.0.0.1:${port}/json`);
    if (!targets) return { port, status: 'Offline' };

    const connectable = targets.filter(t => t.webSocketDebuggerUrl);
    return {
        port,
        status: 'Online',
        targets: connectable.length,
        details: connectable.map(t => ({ title: t.title, type: t.type }))
    };
}

async function main() {
    console.log('--- Antigravity System Status Report ---');
    console.log(`Time: ${new Date().toLocaleString()}`);

    const results = await Promise.all(PORTS.map(checkPort));

    results.forEach(r => {
        if (r.status === 'Online') {
            console.log(`[Port ${r.port}] ✅ ONLINE | Targets: ${r.targets}`);
            r.details.forEach(d => console.log(`   - ${d.type}: ${d.title}`));
        } else {
            console.log(`[Port ${r.port}] ❌ OFFLINE`);
        }
    });

    // Check if 3004 is responding
    const serverStatus = await getJson('http://127.0.0.1:3004/api/health').catch(() => null);
    console.log(`\n[Server 3004] ${serverStatus ? '✅ UP' : '❓ NO HEALTH ENDPOINT (Check manually)'}`);

    process.exit(0);
}

main();
