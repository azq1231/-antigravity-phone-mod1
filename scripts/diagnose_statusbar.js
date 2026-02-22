import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    try {
        const conn = await getOrConnectParams(9000);
        for (const cdp of conn) {
            console.log(`Checking target: ${cdp.title}`);
            for (const ctx of cdp.contexts) {
                const res = await cdp.call('Runtime.evaluate', {
                    expression: `(() => {
                        const items = Array.from(document.querySelectorAll('*'))
                            .filter(el => {
                                const t = el.innerText || "";
                                return (el.className.includes('statusbar') || el.closest('[class*="statusbar"]')) && t.trim().length > 0;
                            })
                            .map(el => ({ 
                                text: el.innerText.trim(), 
                                className: el.className,
                                html: el.outerHTML.substring(0, 100)
                            }));
                        return items;
                    })()`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result?.value?.length > 0) {
                    console.log(`Context ${ctx.id} items:`, JSON.stringify(res.result.value, null, 2));
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}
diagnose();
