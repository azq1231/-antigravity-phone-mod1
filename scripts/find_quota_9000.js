import { getOrConnectParams } from '../core/cdp_manager.js';

async function findQuota() {
    try {
        const conn = await getOrConnectParams(9000, true);
        const w = conn.find(c => c.title && c.title.includes('antigravity'));
        if (!w) return;
        const res = await w.call('Runtime.evaluate', {
            expression: `(() => {
                const items = Array.from(document.querySelectorAll(".statusbar-item"));
                const withPercent = items.filter(i => (i.innerText + " " + (i.getAttribute("aria-label")||"")).includes("%"));
                return withPercent.map(i => ({
                    innerText: i.innerText,
                    aria: i.getAttribute("aria-label")
                }));
            })()`,
            returnByValue: true
        });
        console.log("ITEMS WITH %:");
        res.result.value.forEach((item, i) => {
            console.log(`--- ITEM ${i} ---`);
            console.log("TEXT:", JSON.stringify(item.innerText));
            console.log("ARIA:", JSON.stringify(item.aria));
        });
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
findQuota();
