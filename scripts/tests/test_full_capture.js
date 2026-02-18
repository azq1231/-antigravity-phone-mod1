
import fs from 'fs';
import { getOrConnectParams } from '../core/cdp_manager.js';

async function test() {
    const port = 9001;
    const conns = await getOrConnectParams(port);
    const cdp = conns[0];
    console.log('Connected to port', port);

    const fileContent = fs.readFileSync('core/automation.js', 'utf8');
    const match = fileContent.match(/const CAPTURE_SCRIPT = `([\s\S]+?)`;/);
    if (!match) {
        console.error('CAPTURE_SCRIPT not found');
        return;
    }
    const script = match[1];

    // Test for syntax errors first by omitting the try-catch wrapper initially
    const res = await cdp.call("Runtime.evaluate", {
        expression: script,
        returnByValue: true
    });

    if (res.exceptionDetails) {
        console.error('Syntax Error or Exception:', JSON.stringify(res.exceptionDetails, null, 2));
    } else {
        console.log('Result:', JSON.stringify(res.result, null, 2));
    }
    process.exit(0);
}

test().catch(console.error);
