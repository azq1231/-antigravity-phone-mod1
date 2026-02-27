import { getOrConnectParams } from '../core/cdp_manager.js';
import { getAppState } from '../core/automation.js';

async function diagnoseMode() {
    process.stdout.write('--- 診斷 Mode 狀態 ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        const state = await getAppState(conns);
        process.stdout.write(`Current getAppState result: ${JSON.stringify(state, null, 2)}\n`);

        // Check DOM specifically for Fast/Planning
        const SCRIPT = `(() => {
            const isForbidden = (el) => el.closest('.monaco-editor, .view-lines, .terminal-container, .part.panel, .notifications-toasts');
            const toolbar = document.querySelector('.flex.items-center.gap-0-5, [class*="items-center"][class*="gap-0.5"]');
            let toolbarHtml = toolbar ? toolbar.outerHTML : 'Not found';
            
            const fastPlanningNodes = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = (el.innerText || "").trim();
                return (t === 'Fast' || t === 'Planning') && el.children.length === 0;
            }).map(el => ({ 
                tag: el.tagName, 
                text: el.innerText.trim(), 
                class: el.className,
                aria: el.getAttribute('aria-label'),
                forbidden: !!isForbidden(el)
            }));
            
            return {
                toolbarHtml: toolbarHtml.substring(0, 500),
                fastPlanningNodes
            };
        })()`;

        for (const conn of conns) {
            for (const ctx of (conn.contexts || [{}])) {
                try {
                    const res = await conn.call("Runtime.evaluate", {
                        expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctx.id
                    });
                    if (res.result && res.result.value && (res.result.value.fastPlanningNodes?.length > 0 || res.result.value.toolbarHtml !== 'Not found')) {
                        process.stdout.write(`Found in Context ${ctx.id || 'default'}:\n`);
                        process.stdout.write(JSON.stringify(res.result.value, null, 2) + "\n");
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        process.stdout.write(`Error: ${e.message}\n`);
    }
    process.exit(0);
}

diagnoseMode();
