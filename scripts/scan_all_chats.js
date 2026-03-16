
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function scan() {
    console.log("[SCAN] Searching all ports for Chat window...");
    const instances = await findAllInstances();
    
    for (const inst of instances) {
        console.log(`\nPort ${inst.port}: ${inst.title}`);
        for (const target of inst.targets) {
            try {
                const conn = await connectCDP(target.url);
                const res = await conn.call("Runtime.evaluate", {
                    expression: `!!document.querySelector('#conversation, #chat, #cascade')`,
                    returnByValue: true
                });
                if (res.result?.value) {
                    console.log(`  ✅ FOUND CHAT in target: ${target.title}`);
                    console.log(`     URL: ${target.url}`);
                } else {
                    console.log(`  - ${target.title.substring(0, 30)} (No Chat)`);
                }
                conn.close();
            } catch (e) {
                console.log(`  ! Error connecting to ${target.title}: ${e.message}`);
            }
        }
    }
    process.exit(0);
}

scan();
