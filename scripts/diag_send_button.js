
import { getOrConnectParams } from '../core/cdp_manager.js';
import fs from 'fs';

async function diagSendButton() {
    let output = '';
    const log = (msg) => { output += msg + '\n'; console.log(msg); };

    log('[DIAG] Starting Detailed Button Diagnosis...');
    try {
        const port = 9000;
        const cdpList = await getOrConnectParams(port);
        
        const SCRIPT = `(() => {
            const elements = Array.from(document.querySelectorAll('button, [role="button"], a'));
            return elements.map(b => ({
                tag: b.tagName,
                role: b.getAttribute('role'),
                text: b.innerText.trim().substring(0, 30),
                ariaLabel: b.getAttribute('aria-label'),
                title: b.getAttribute('title'),
                tooltipId: b.getAttribute('data-tooltip-id'),
                visible: b.offsetHeight > 0,
                svgs: Array.from(b.querySelectorAll('svg')).map(s => s.getAttribute('class'))
            })).filter(b => b.visible);
        })()`;

        for (const cdp of cdpList) {
            for (const ctx of cdp.contexts) {
                try {
                    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                    const buttons = res.result.value || [];
                    if (buttons.length > 0) {
                        log(`\n--- Context ${ctx.id} ---`);
                        const candidates = buttons.filter(b => {
                            const str = (b.text + b.ariaLabel + b.title + b.tooltipId + b.svgs.join(' ')).toLowerCase();
                            return str.includes('send') || str.includes('submit') || str.includes('發送') || str.includes('arrow') || str.includes('up');
                        });
                        
                        if (candidates.length > 0) {
                            log('Candidates found:');
                            candidates.forEach(c => log(JSON.stringify(c, null, 2)));
                        } else {
                            log('No specific candidates. Showing first 20 visible buttons/links:');
                            buttons.slice(0, 20).forEach(b => log(JSON.stringify(b, null, 2)));
                        }
                    }
                } catch (e) { }
            }
        }
    } catch (e) { log(e.toString()); }
    fs.writeFileSync('scripts/buttons_diag.txt', output);
    process.exit(0);
}
diagSendButton();
