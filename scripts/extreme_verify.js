import { getOrConnectParams } from '../core/cdp_manager.js';

async function verify() {
    console.log('--- EXTREME DIAGNOSIS START ---');
    const port = 9001;
    try {
        const conns = await getOrConnectParams(port);
        console.log(`Found ${conns.length} targets on 9001`);

        const SCRIPT = `(async () => {
            const report = [];
            const log = (m) => report.push(m);

            const ed = document.querySelector('[data-lexical-editor="true"]');
            if (!ed) return { err: "No Editor" };

            // 1. Locate ALL candidate buttons
            const btns = Array.from(document.querySelectorAll('button, [role="button"], a.button'));
            log("Total potential buttons: " + btns.length);

            const matches = btns.map((b, i) => {
                const label = (b.innerText + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.className || '') + ' ' + (b.id || '')).toLowerCase();
                const hasZap = b.querySelector('svg.lucide-zap, svg[class*="Zap"]');
                const hasSendIcon = b.querySelector('svg.lucide-arrow-right, svg.lucide-arrow-up, .lucide-send, svg[class*="send"], svg[class*="arrow-up"]');
                
                return {
                    idx: i,
                    label: label.substring(0, 50),
                    disabled: b.disabled,
                    visible: b.offsetParent !== null,
                    hasZap: !!hasZap,
                    hasSend: !!hasSendIcon,
                    html: b.outerHTML.substring(0, 200)
                };
            }).filter(m => m.visible && (m.label.includes('send') || m.hasZap || m.hasSend));

            log("Matches found: " + matches.length);
            
            // 2. Perform a test click on the LAST match (usually the input send button)
            const lastMatch = matches[matches.length - 1];
            if (lastMatch) {
                const btn = btns[lastMatch.idx];
                log("Testing click on: " + lastMatch.label);
                
                // Track if click actually triggers anything (we can't easily, but we can check if it stays disabled)
                btn.click();
                log("Click dispatched");
            }

            return { report, matches, lastMatch };
        })()`;

        for (const conn of conns) {
            console.log(`Checking: ${conn.title}`);
            const ctxId = conn.contexts.length > 0 ? conn.contexts[0].id : undefined;
            const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctxId });
            console.log(JSON.stringify(res?.result?.value, null, 2));
        }
    } catch (e) {
        console.error(e);
    }
}
verify();
