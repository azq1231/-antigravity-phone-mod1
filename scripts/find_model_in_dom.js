import { getOrConnectParams } from '../core/cdp_manager.js';

async function dump() {
    const port = 9000;
    try {
        const conn = await getOrConnectParams(port);
        for (const cdp of conn) {
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", {
                    expression: `(() => {
                        const all = Array.from(document.querySelectorAll('*'));
                        return all.map(el => ({
                            tag: el.tagName,
                            text: el.innerText?.substring(0, 50),
                            className: el.className
                        })).filter(o => o.text && (o.text.includes('Gemini') || o.text.includes('Claude') || o.text.includes('GPT')));
                    })()`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result?.value?.length > 0) {
                    console.log(`Port ${port} Context ${ctx.id} Matches:`, JSON.stringify(res.result.value, null, 2));
                }
            }
        }
    } catch (e) { console.error(e); }
}
dump();
