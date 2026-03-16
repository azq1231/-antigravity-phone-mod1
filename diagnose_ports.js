import { getOrConnectParams } from './core/cdp_manager.js';

async function diagnose() {
    const ports = [9000, 9001];
    for (const port of ports) {
        console.log(`\n--- Checking Port ${port} ---`);
        try {
            const list = await getOrConnectParams(port, true);
            console.log(`Found ${list.length} targets`);
            for (const cdp of list) {
                const res = await cdp.call("Runtime.evaluate", { 
                    expression: "(() => { return document.querySelector('.statusbar-item')?.innerText || document.body.innerText.substring(0, 100); })()",
                    returnByValue: true 
                }).catch(() => null);
                console.log(`  Target [${cdp.title}]: ${res?.result?.value}`);
                
                // Search for the specific status bar string
                const fullBar = await cdp.call("Runtime.evaluate", { 
                    expression: "(() => { return Array.from(document.querySelectorAll('.statusbar-item')).map(el => el.innerText).join(' | '); })()",
                    returnByValue: true 
                }).catch(() => null);
                if (fullBar?.result?.value?.includes('%')) {
                    console.log(`  Found Quota Bar: ${fullBar.result.value}`);
                }
            }
        } catch (e) {
            console.log(`  Failed to connect: ${e.message}`);
        }
    }
}

diagnose().then(() => process.exit(0));
