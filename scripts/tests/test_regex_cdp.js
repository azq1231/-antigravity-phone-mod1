
import { getOrConnectParams } from '../core/cdp_manager.js';

async function test() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    const cdp = conns[0];

    const script = `(() => {
        try {
            const r = /[a-z]:[\\\\\\\\/]+(?:users)[\\\\\\\\/]+[^\\\\\\\\/]+[\\\\\\\\/]+\\.gemini[\\\\\\\\/]+antigravity[\\\\\\\\/]+brain[\\\\\\\\/]+/gi;
            return { success: true, regex: r.toString() };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const res = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true });
    console.log('Result:', JSON.stringify(res, null, 2));
    process.exit(0);
}

test().catch(console.error);
