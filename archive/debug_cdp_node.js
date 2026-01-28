import http from 'http';

function getJson(url) {
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

async function debug() {
    try {
        console.log("Checking 9001...");
        const list = await getJson('http://127.0.0.1:9001/json/list');
        console.log("Items found:", list.length);

        // Check for workbench
        const wb = list.find(t => t.url && t.url.includes('workbench.html'));

        // Also check my relaxed logic
        const relaxed = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);

        if (wb) {
            console.log("✅ Workbench found! (Strict match successful)");
            console.log("URL:", wb.url);
        } else {
            console.log("❌ Workbench NOT found (Strict match failed)");
        }

        if (relaxed) {
            console.log("✅ Relaxed match found!");
            console.log("Title:", relaxed.title);
            console.log("Type:", relaxed.type);
        } else {
            console.log("❌ Relaxed match NOT found");
        }

        if (!wb && !relaxed) {
            console.log("DUMPING ALL TARGETS:");
            list.forEach((t, i) => {
                console.log(`[${i}] Type: ${t.type}, Title: ${t.title || 'N/A'}, URL: ${t.url || 'N/A'}`);
            });
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

debug();
