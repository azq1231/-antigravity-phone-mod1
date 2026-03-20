
import { getOrConnectParams } from '../core/cdp_manager.js';

async function auditSend() {
    console.log('--- 🧪 Audit Send Button (Port 9000) ---');
    try {
        const conn = await getOrConnectParams(9000);
        const cdpList = Array.isArray(conn) ? conn : [conn];

        const SCRIPT = `(() => {
            const findSend = () => {
                const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
                const candidates = els.filter(el => {
                    const str = (el.innerText + el.ariaLabel + el.title + (el.getAttribute('data-tooltip-id') || "") + el.className).toLowerCase();
                    const hasIcon = el.querySelector('svg[class*="send"], svg[class*="arrow"], svg[class*="up"]');
                    return (str.includes('send') || str.includes('submit') || str.includes('發送') || hasIcon) && el.offsetHeight > 0;
                });
                return candidates.map(b => ({
                    tag: b.tagName,
                    text: b.innerText.substring(0, 20),
                    label: b.ariaLabel,
                    tip: b.getAttribute('data-tooltip-id'),
                    title: b.getAttribute('title'),
                    rect: b.getBoundingClientRect(),
                    svgs: Array.from(b.querySelectorAll('svg')).map(s => s.getAttribute('class'))
                }));
            };
            return {
                url: window.location.href,
                buttons: findSend(),
                hasLexical: !!document.querySelector('[data-lexical-editor="true"]')
            };
        })()`;

        for (const cdp of cdpList) {
            for (const ctx of cdp.contexts) {
                try {
                    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                    if (res.result.value && (res.result.value.buttons.length > 0 || res.result.value.hasLexical)) {
                        console.log(`\n[CTX ${ctx.id}] URL: ${res.result.value.url}`);
                        console.log(`Lexical Found: ${res.result.value.hasLexical}`);
                        console.table(res.result.value.buttons.map(b => ({
                            tag: b.tag,
                            text: b.text,
                            label: b.label,
                            tip: b.tip,
                            rect: `${Math.round(b.rect.right)}x${Math.round(b.rect.bottom)}`,
                            svg: b.svgs[0]?.split(' ').pop()
                        })));
                    }
                } catch (e) { }
            }
        }
    } catch (e) { console.error(e); }
    process.exit(0);
}
auditSend();
