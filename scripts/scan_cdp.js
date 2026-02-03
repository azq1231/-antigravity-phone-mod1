import fetch from 'node-fetch';

const PORTS = [9000, 9001, 9002, 9003];

async function scan() {
    console.log("🔍 Scanning for IDE CDP targets...");
    for (const port of PORTS) {
        try {
            const res = await fetch(`http://localhost:${port}/json`);
            if (res.ok) {
                const targets = await res.json();
                console.log(`✅ Port ${port} found: ${targets.length} targets`);
                targets.forEach(t => {
                    console.log(`  - [${t.type}] ${t.title} (${t.url.substring(0, 50)}...)`);
                });
            }
        } catch (e) {
            console.log(`❌ Port ${port} closed or unreachable: ${e.message}`);
        }
    }
}

scan();
