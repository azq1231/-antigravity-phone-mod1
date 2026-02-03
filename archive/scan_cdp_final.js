import fetch from 'node-fetch';

const PORTS = [9000, 9001, 9002, 9003, 9004, 9005];

async function scan() {
    console.log("🔍 Deep scanning IDE ports (9000-9005)...");
    for (const port of PORTS) {
        try {
            const res = await fetch(`http://localhost:${port}/json`);
            if (res.ok) {
                const targets = await res.json();
                console.log(`\n=== Port ${port} (${targets.length} targets) ===`);
                for (const t of targets) {
                    console.log(`  - [${t.type}] Title: "${t.title}" | URL: ${t.url?.substring(0, 80)}`);
                }
            }
        } catch (e) {
            // console.log(`- Port ${port} Offline`);
        }
    }
}

scan();
