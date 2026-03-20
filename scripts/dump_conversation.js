
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpConversation() {
    const port = 9000;
    const cdpList = await getOrConnectParams(port);
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", {
                    expression: `(() => {
                        const el = document.getElementById('conversation');
                        if (!el) return null;
                        return {
                            id: el.id,
                            html: el.innerHTML.substring(0, 5000),
                            buttons: Array.from(el.querySelectorAll('button, [role="button"]')).map(b => ({
                                tag: b.tagName,
                                text: b.innerText.substring(0, 20),
                                aria: b.getAttribute('aria-label'),
                                tip: b.getAttribute('data-tooltip-id'),
                                title: b.getAttribute('title')
                            }))
                        };
                    })()`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result.value) {
                    console.log(`\nMATCH FOUND in Context ${ctx.id}:`);
                    console.log(JSON.stringify(res.result.value, null, 2));
                }
            } catch (e) { }
        }
    }
    process.exit(0);
}
dumpConversation();
