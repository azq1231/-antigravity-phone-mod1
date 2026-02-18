
import { findAllInstances, getOrConnectParams } from '../core/cdp_manager.js';

async function test() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    const cdp = conns[0];
    console.log('Connected to port', port, 'target:', cdp.title);

    // Test the logic that is currently in automation.js
    const script = `(() => {
        try {
            const cleanText = (text) => {
                if (!text) return text;
                let out = text;
                const brainPathRegex = /[a-z]:[\\\\/]+(?:users)[\\\\/]+[^\\\\/]+[\\\\/]+\\.gemini[\\\\/]+antigravity[\\\\/]+brain[\\\\/]+/gi;
                out = out.replace(brainPathRegex, '/brain/');
                out = out.replace(/\\/brain\\/[^"'\\s>)]+/g, (match) => match.replace(/\\\\/g, '/'));
                return out;
            };
            return { success: true, test: cleanText("C:\\\\Users\\\\kuo_1\\\\.gemini\\\\antigravity\\\\brain\\\\test.webp") };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const res = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true });
    console.log('Result:', JSON.stringify(res, null, 2));
    process.exit(0);
}

test().catch(console.error);
