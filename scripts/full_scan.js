const PORTS = [9000, 9001, 9002, 9003];

async function scan() {
    for (const port of PORTS) {
        try {
            console.log(`Scanning Port ${port}...`);
            const res = await fetch(`http://127.0.0.1:${port}/json`);
            const list = await res.json();
            list.forEach(t => {
                console.log(`  [${t.type}] "${t.title}" | URL: ${t.url.substring(0, 100)}`);
            });
        } catch (e) {
            console.log(`  Port ${port} failed: ${e.message}`);
        }
    }
}

scan();
