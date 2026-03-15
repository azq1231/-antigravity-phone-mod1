
import { getOrConnectParams } from '../core/cdp_manager.js';

async function traceModel9001() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port);
        const cdpList = Array.isArray(conn) ? conn : [conn];

        const SCRIPT = `(() => {
            const out = [];
            const models = ["Gemini", "Claude", "GPT", "o1", "Sonnet"];
            document.querySelectorAll('*').forEach(el => {
                const t = (el.innerText || "").trim();
                if (models.some(m => t.includes(m)) && t.length < 50 && el.children.length === 0 && el.offsetParent !== null) {
                    let parent = el.parentElement;
                    out.push("MODEL: [" + t + "] PATH: " + el.tagName);
                    let depth = 0;
                    while(parent && depth < 5) {
                        out.push("  PARENT(" + depth + "): [" + (parent.innerText || "").replace(/\\n/g, ' ').substring(0, 200) + "] CLASS: " + parent.className);
                        parent = parent.parentElement;
                        depth++;
                    }
                }
            });
            return out.join('\\n');
        })()`;

        for (const cdp of cdpList) {
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value) {
                    console.log(`Port ${port} Context ${ctx.id}:`);
                    console.log(res.result.value);
                }
            }
        }
    } catch (e) { console.error(e); }
}

traceModel9001();
