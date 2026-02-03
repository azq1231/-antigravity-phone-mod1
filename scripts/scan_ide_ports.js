const http = require('http');

const PORTS = Array.from({ length: 10 }, (_, i) => 9000 + i);

async function checkPort(port) {
    return new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${port}/json`, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    const candidates = targets.filter(t => t.url && t.url.includes('workbench.html'));
                    resolve({ port, found: true, targets: candidates, all: targets });
                } catch { resolve({ port, found: true, error: 'JSON parse error', all: [] }); }
            });
        });
        req.on('error', () => resolve({ port, found: false }));
        req.setTimeout(200, () => { req.destroy(); resolve({ port, found: false }); });
    });
}

(async () => {
    console.log('Scanning ports 9000-9009 for IDE workbench...');
    const promises = PORTS.map(checkPort);
    const results = await Promise.all(promises);

    let foundAny = false;
    results.forEach(r => {
        if (r.found) {
            console.log(`\n[Port ${r.port}] is OPEN.`);
            if (r.all.length > 0) {
                console.log(`  Total targets: ${r.all.length}`);
                r.all.forEach(t => {
                    console.log(`  - [${t.type}] ${t.title || 'No Title'} (${t.url?.substring(0, 50)}...)`);
                });
            } else {
                console.log(`  (Empty target list)`);
            }

            if (r.targets.length > 0) {
                console.log(`  *** WORKBENCH FOUND IN PORT ${r.port} ***`);
                foundAny = true;
            }
        }
    });

    if (!foundAny) {
        console.log('\nResult: workbench.html NOT FOUND in any scanned port.');
    }
})();
