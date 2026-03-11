
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpMain() {
    const port = 9001;
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;
    
    const SCRIPT = `(() => {
        const main = document.querySelector('main') || document.body;
        const walk = (el, depth = 0) => {
            if (depth > 4) return null;
            return {
                tag: el.tagName,
                id: el.id,
                classes: el.className,
                children: Array.from(el.children).map(c => walk(c, depth + 1))
            };
        };
        return walk(main);
    })()`;
    
    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

dumpMain();
