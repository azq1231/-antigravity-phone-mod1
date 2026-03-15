import { getOrConnectParams } from '../core/cdp_manager.js';

async function fullDiag9000() {
    try {
        const conn = await getOrConnectParams(9000, true);
        const w = conn.find(c => c.title && c.title.includes('antigravity'));
        if (!w) return;
        const res = await w.call('Runtime.evaluate', {
            expression: `Array.from(document.querySelectorAll(".statusbar-item")).map(i => {
                return {
                    text: i.innerText,
                    aria: i.getAttribute("aria-label"),
                    classList: Array.from(i.classList)
                };
            })`,
            returnByValue: true
        });
        console.dir(res.result.value, { depth: null });
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
fullDiag9000();
