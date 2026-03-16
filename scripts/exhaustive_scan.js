
import { getJson } from '../core/utils.js';

async function scan() {
    const ports = [9000, 9001, 9002, 9003, 9222];
    for (const port of ports) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json`);
            console.log(`Port ${port}: Found ${list.length} targets.`);
            list.forEach(t => {
                const title = t.title || '';
                const url = t.url || '';
                if (title.toLowerCase().includes('chat') || url.toLowerCase().includes('chat') || url.includes('webview')) {
                    console.log(`  [MATCH] Title: ${title.substring(0, 50)}`);
                    console.log(`          URL: ${url.substring(0, 100)}`);
                    console.log(`          Type: ${t.type}`);
                }
            });
        } catch (e) {
            console.log(`Port ${port}: Not reachable or empty.`);
        }
    }
}
scan();
