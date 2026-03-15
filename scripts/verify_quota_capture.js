
import { getOrConnectParams } from '../core/cdp_manager.js';

async function verifyQuota() {
    const port = 9000;
    console.log(`--- [Quota Discovery] Target: Port ${port} ---`);
    
    try {
        const cdpList = await getOrConnectParams(port);
        const workbench = cdpList.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || cdpList[0];
        
        if (!workbench) {
            console.error("Error: Could not find Workbench target.");
            return;
        }

        const SCRIPT = `(() => {
            const results = [];
            // 遍歷所有可能包含文字的元素
            const elements = Array.from(document.querySelectorAll('.statusbar-item, .statusbar-item *'));
            
            for (const el of elements) {
                const text = (el.innerText || "").trim();
                const aria = (el.getAttribute('aria-label') || "").trim();
                const content = (text + " " + aria);
                
                // 只要包含目標關鍵字就記錄下來
                if (content.includes('Pro:') || content.includes('Flash:') || content.includes('Claude:')) {
                    results.push({
                        tagName: el.tagName,
                        text: text,
                        aria: aria,
                        rect: el.getBoundingClientRect()
                    });
                }
            }
            return results;
        })()`;

        const res = await workbench.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
        const items = res.result?.value || [];

        console.log(`Found ${items.length} potential quota elements:`);
        
        const finalData = {};
        const regex = /(Pro|Flash|Claude):?\s*(\d+)%/g;

        items.forEach(item => {
            const combined = (item.text + " " + item.aria);
            console.log(`  - Content: "${combined}"`);
            
            let match;
            while ((match = regex.exec(combined)) !== null) {
                const name = match[1];
                const percent = match[2] + "%";
                finalData[name] = { percent };
                console.log(`    [MATCH] ${name} -> ${percent}`);
            }
        });

        console.log("\n--- Final Parsed Result ---");
        console.log(JSON.stringify(finalData, null, 2));

    } catch (e) {
        console.error("Discovery failed:", e);
    }
}

verifyQuota();
