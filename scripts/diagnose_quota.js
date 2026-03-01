import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    try {
        const conn = await getOrConnectParams(9000);
        for (const cdp of conn) {
            console.log(`Checking target: ${cdp.title}`);
            for (const ctx of cdp.contexts) {
                const res = await cdp.call('Runtime.evaluate', {
                    expression: `(() => {
                        const items = [];
                        document.querySelectorAll('*:not(style):not(script)').forEach(el => {
                            if (el.children.length === 0) {
                                const text = (el.innerText || '').toLowerCase().trim();
                                if (text.length > 2 && text.length < 50) {
                                    if (text.includes('premium') || text.includes('pro') || text.includes('slow') || text.includes('fast') || text.includes('request') || text.includes('配額') || text.includes('limit') || text.match(/[0-9]+\\s*\\/\\s*[0-9]+/)) {
                                        const style = window.getComputedStyle(el);
                                        let hiddenReason = 'visible';
                                        if (style.display === 'none') hiddenReason = 'display:none';
                                        else if (style.visibility === 'hidden') hiddenReason = 'visibility:hidden';
                                        else if (style.opacity === '0') hiddenReason = 'opacity:0';

                                        const rect = el.getBoundingClientRect();
                                        
                                        items.push({
                                            text: text,
                                            hiddenReason,
                                            rect: {w: rect.width, h: rect.height},
                                            xpath: (function getPath(e) {
                                                if (!e || e.nodeType !== 1) return '';
                                                if (e.id) return '#' + e.id;
                                                return e.tagName + (e.className ? '.' + e.className.split(' ').join('.') : '');
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
                    console.log(`Context ${ctx.id} quota UI:`, JSON.stringify(res.result.value, null, 2));
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
