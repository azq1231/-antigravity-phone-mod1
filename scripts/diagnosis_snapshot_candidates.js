
import { getOrConnectParams } from '../core/cdp_manager.js';
import { cleanContent } from '../core/auto_sanitizer.js';

async function diagnose() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    
    const CAPTURE_SCRIPT = `(() => {
        try {
            const body = document.body;
            if (!body) return { error: 'No body' };
            const exactTarget = document.querySelector('#conversation') || document.querySelector('#chat') || document.querySelector('#cascade');
            const looseTarget = document.querySelector('main') || document.querySelector('[role="main"]');
            const target = exactTarget || looseTarget;
            const root = target || body;
            return {
                html: root.outerHTML.substring(0, 500),
                length: root.outerHTML.length,
                matchQuality: exactTarget ? 'exact' : (looseTarget ? 'loose' : 'fallback'),
                title: document.title,
                url: window.location.href
            };
        } catch (e) { return { error: e.toString() }; }
    })()`;

    const candidates = [];
    for (const cdp of conns) {
        for (const ctx of (cdp.contexts || [{id:undefined}])) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: CAPTURE_SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value && !res.result.value.error) {
                    candidates.push({
                        ...res.result.value,
                        targetTitle: cdp.title
                    });
                }
            } catch (e) { }
        }
    }

    console.log(`CANDIDATES FOUND: ${candidates.length}`);
    candidates.forEach((c, i) => {
        console.log(`[${i}] T: ${c.title.substring(0,30)} | Target: ${c.targetTitle.substring(0,30)} | Q: ${c.matchQuality} | L: ${c.length}`);
    });
    
    process.exit(0);
}

diagnose();
