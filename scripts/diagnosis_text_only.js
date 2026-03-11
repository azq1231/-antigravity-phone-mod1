
import { getOrConnectParams } from '../core/cdp_manager.js';
import { injectMessage } from '../core/automation.js';

async function testText() {
    const port = 9001;
    console.log(`--- 🧪 Testing Text Injection on Port ${port} ---`);
    const conn = await getOrConnectParams(port);
    const testText = "Diagnostic Text " + Date.now();
    
    const cdp = Array.isArray(conn) ? conn[0] : conn;
    if (!cdp) {
        console.error('No CDP found for port', port);
        process.exit(1);
    }

    const getCount = async () => {
        const res = await cdp.call("Runtime.evaluate", {
            expression: `document.querySelectorAll('[class*="ChatMessage"], [class*="message-row"]').length`,
            returnByValue: true
        });
        return res.result.value || 0;
    };

    const before = await getCount();
    console.log('Messages before:', before);

    const result = await injectMessage(conn, testText, true);
    console.log('Result:', JSON.stringify(result, null, 2));
    
    await new Promise(r => setTimeout(r, 6000)); // Wait even longer for network/parsing
    
    const after = await getCount();
    console.log('Messages after:', after);

    const check = await cdp.call("Runtime.evaluate", {
        expression: `document.querySelector('[data-lexical-editor="true"]').innerText`,
        returnByValue: true
    });
    console.log(`Editor Content after 6s: "${check.result.value}"`);
    
    if (after > before) {
        console.log('✅ Message count increased!');
    } else {
        console.log('❌ Message count DID NOT increase.');
    }
    process.exit(0);
}

testText();
