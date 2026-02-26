import { getOrConnectParams } from '../core/cdp_manager.js';

async function verify() {
    console.log('--- FIND BUTTONS DIAGNOSIS ---');
    const port = 9001;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            console.log(`Checking: ${conn.title}`);
            const SCRIPT = `(() => {
                const btns = Array.from(document.querySelectorAll('*')).filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.cursor === 'pointer' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
                });
                
                return btns.map(b => ({
                    tag: b.tagName,
                    text: (b.innerText || "").substring(0, 20),
                    aria: b.getAttribute('aria-label'),
                    title: b.getAttribute('title'),
                    cls: b.className,
                    visible: b.offsetParent !== null,
                    html: b.outerHTML.substring(0, 150)
                })).filter(b => b.visible);
            })()`;

            const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            console.log(JSON.stringify(res?.result?.value, null, 2));
        }
    } catch (e) {
        console.error(e);
    }
}
verify();
