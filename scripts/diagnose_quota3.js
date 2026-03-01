import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    try {
        const conn = await getOrConnectParams(9000);
        for (const cdp of conn) {
            for (const ctx of cdp.contexts) {
                const res = await cdp.call('Runtime.evaluate', {
                    expression: `(() => {
                        let result = null;
                        document.querySelectorAll('*:not(style):not(script)').forEach(el => {
                            if (el.innerText && el.innerText.includes('GP:') && el.innerText.includes('GF:')) {
                                if (el.children.length === 0) {
                                    const style = window.getComputedStyle(el);
                                    let hiddenReason = 'visible';
                                    if (style.display === 'none') hiddenReason = 'display:none';
                                    else if (style.visibility === 'hidden') hiddenReason = 'visibility:hidden';
                                    else if (style.opacity === '0') hiddenReason = 'opacity:0';

                                    let parent = el.parentElement;
                                    let parentHideReason = null;
                                    while (parent) {
                                        const pStyle = window.getComputedStyle(parent);
                                        if (pStyle.display === 'none') parentHideReason = 'parent display:none';
                                        parent = parent.parentElement;
                                    }

                                    result = {
                                        text: el.innerText,
                                        hiddenReason,
                                        parentHideReason,
                                        className: el.className,
                                        id: el.id
                                    };
                                }
                            }
                        });
                        return result;
                    })()`,
                    returnByValue: true,
                    contextId: ctx.id
                });
                if (res.result?.value) {
                    console.log(`Context ${ctx.id} quota status:`, res.result.value);
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
