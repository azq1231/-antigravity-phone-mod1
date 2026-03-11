
import { getOrConnectParams } from '../core/cdp_manager.js';
import { injectMessage, captureSnapshot } from '../core/automation.js';

async function testProperly() {
    const port = 9001;
    console.log(`--- 🧪 Testing Text Injection (Proper List) on Port ${port} ---`);
    const connList = await getOrConnectParams(port);
    
    const snapBefore = await captureSnapshot(connList);
    console.log("Found message elements before:", (snapBefore.html?.match(/<p node=/g) || []).length);
    
    const textPrefix = "Final Validation " + Date.now();
    const result = await injectMessage(connList, textPrefix);
    console.log("Result:", JSON.stringify(result, null, 2));
    
    await new Promise(r => setTimeout(r, 6000));
    
    const snapAfter = await captureSnapshot(connList);
    console.log("Found message elements after:", (snapAfter.html?.match(/<p node=/g) || []).length);
    
    process.exit(0);
}

testProperly();
