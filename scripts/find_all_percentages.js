
import { getOrConnectParams } from '../core/cdp_manager.js';

async function findQuota() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        for (const cdp of conn) {
            console.log(`--- Scanning ${cdp.title} ---`);
            const res = await cdp.call("Runtime.evaluate", { 
                expression: `(() => {
                    const findInNode = (node) => {
                        let findings = [];
                        if (node.innerText && node.innerText.includes('%')) {
                            // If it's a small node with %, grab it
                            if (node.children.length === 0) {
                                findings.push({ text: node.innerText.trim(), tag: node.tagName, class: node.className });
                            }
                        }
                        for (let child of node.children) {
                            findings = findings.concat(findInNode(child));
                        }
                        return findings;
                    };
                    return JSON.stringify(findInNode(document.body).slice(0, 50));
                })()`, 
                returnByValue: true,
                contextId: 1
            }).catch(e => ({ error: e.message }));

            if (res.result?.value) {
                console.log(JSON.parse(res.result.value));
            } else if (res.error) {
                console.log("Error:", res.error);
            }
        }
    } catch (e) { console.error(e); }
    process.exit(0);
}
findQuota();
