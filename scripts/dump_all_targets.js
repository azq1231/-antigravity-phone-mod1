
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

import fs from 'fs';

async function dumpAll() {
    let output = "";
    const log = (msg) => { console.log(msg); output += msg + "\n"; };
    
    const instances = await findAllInstances();
    for (const inst of instances) {
        for (const target of inst.targets) {
            try {
                const conn = await connectCDP(target.url);
                const res = await conn.call("Runtime.evaluate", {
                    expression: `document.body.innerText.substring(0, 200)`,
                    returnByValue: true
                });
                log(`Port ${inst.port} | Target: ${target.title.substring(0, 50)}`);
                log(`  Preview: ${res.result?.value?.replace(/\n/g, ' ')}`);
                
                const detail = await conn.call("Runtime.evaluate", {
                    expression: `({
                        hasInput: !!document.querySelector('textarea, input, [contenteditable]'),
                        allIds: Array.from(document.querySelectorAll('*')).map(el => el.id).filter(id => id).slice(0, 50)
                    })`,
                    returnByValue: true
                });
                log(`  Detail: ${JSON.stringify(detail.result?.value, null, 2)}`);
                
                conn.close();
            } catch (e) {}
        }
    }
    fs.writeFileSync('all_targets_diag.txt', output);
    process.exit(0);
}
dumpAll();
