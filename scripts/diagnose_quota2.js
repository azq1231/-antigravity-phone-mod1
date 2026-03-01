import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    try {
        const conn = await getOrConnectParams(9000);
        for (const cdp of conn) {
            for (const ctx of cdp.contexts) {
                const res = await cdp.call('Runtime.evaluate', {
                    expression: `(() => {
                        const items = [];
                        document.querySelectorAll('*:not(style):not(script)').forEach(el => {
                            if (el.children.length === 0) {
                                const text = (el.innerText || '').trim();
                                if (text && text.length > 0 && text.length < 150) {
                                    const rect = el.getBoundingClientRect();
                                    // only care about things in bottom half of screen
                                    if (rect.y > window.innerHeight / 2) {
                                        items.push({
                                            text: text,
                                            y: rect.y,
                                            xpath: (function getPath(e) {
                                                if (!e || e.nodeType !== 1) return '';
                                                return e.className;
                                            })(el)
                                        });
                                    }
                                }
                            }
                        });
                        return Array.from(new Set(items.map(i => JSON.stringify(i)))).map(i => JSON.parse(i));
                    })()`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result?.value?.length > 0) {
                    console.log(`Context ${ctx.id} bottom texts:\n`, res.result.value.map(v => v.text).join('\n'));
                }
            }
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
diagnose();
