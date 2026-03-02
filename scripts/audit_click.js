
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    console.log('--- 🧪 Triggering Click Precision Audit ---');
    const conn = await getOrConnectParams(9001);
    const cdp = Array.isArray(conn) ? conn[0] : conn;

    if (!cdp) {
        console.error('Failed to connect to browser on port 9001');
        return;
    }

    const SCRIPT = `(async () => {
        const findSend = () => {
            const explicit = document.querySelector('button[data-tooltip-id*="send"], button[aria-label*="Send"], button[aria-label*="發送"]');
            if (explicit && explicit.offsetParent !== null) return explicit;
            const svgs = Array.from(document.querySelectorAll('button svg')).filter(svg => {
                const cls = (svg.getAttribute('class') || "").toLowerCase();
                return cls.includes('send') || cls.includes('arrow') || cls.includes('up');
            });
            return svgs.length > 0 ? svgs[0].closest('button') : null;
        };

        const btn = findSend();
        if (!btn) return { error: "Send button not found" };

        const r = btn.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        
        // 檢查該坐標目前是什麼元素
        const elAtPoint = document.elementFromPoint(x, y);
        
        return {
            button: btn.tagName + '.' + btn.className,
            disabled: btn.disabled,
            rect: {x, y, w: r.width, h: r.height},
            elementAtCoordinates: elAtPoint ? (elAtPoint.tagName + '.' + elAtPoint.className) : "null",
            pointerEvents: window.getComputedStyle(btn).pointerEvents
        };
    })()`;

    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

diagnose();
