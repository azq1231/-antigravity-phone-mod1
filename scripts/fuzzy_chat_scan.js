
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';
import fs from 'fs';

async function scan() {
    let output = "";
    const log = (msg) => { console.log(msg); output += msg + "\n"; };
    const instances = await findAllInstances();
    for (const inst of instances) {
        for (const target of inst.targets) {
            try {
                const conn = await connectCDP(target.url);
                const res = await conn.call("Runtime.evaluate", {
                    expression: `(() => {
                        const all = document.querySelectorAll('*');
                        const matches = [];
                        all.forEach(el => {
                            const attr = (el.id + ' ' + el.className + ' ' + (el.getAttribute('aria-label')||'')).toLowerCase();
                            if ((attr.includes('chat') || attr.includes('conversation')) && el.offsetHeight > 0) {
                                matches.push({ tag: el.tagName, id: el.id, class: el.className, text: el.innerText?.substring(0, 50) });
                            }
                        });
                        return matches.slice(0, 20);
                    })()`,
                    returnByValue: true
                });
                if (res.result?.value?.length > 0) {
                    log(`\n=== Port ${inst.port} | Target: ${target.title} ===`);
                    log(JSON.stringify(res.result.value, null, 2));
                }
                conn.close();
            } catch (e) {}
        }
    }
    fs.writeFileSync('fuzzy_chat_results.txt', output);
    process.exit(0);
}
scan();
