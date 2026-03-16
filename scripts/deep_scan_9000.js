
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const instances = await findAllInstances();
    const inst = instances.find(i => i.port === port);
    
    if (!inst) {
        console.log(`Port ${port} not found`);
        process.exit(0);
    }

    console.log(`Analyzing targets for Port ${port}...`);
    for (const target of inst.targets) {
        // Here, target.url is the websocket URL.
        // But findAllInstances also stores the type/url if we modified it.
        // Actually, let's just connect and ask the page its URL.
        try {
            const conn = await connectCDP(target.url);
            const res = await conn.call("Runtime.evaluate", {
                expression: `window.location.href`,
                returnByValue: true
            });
            const url = res.result?.value || '';
            console.log(`Target: ${target.title.substring(0, 30)} | URL: ${url.substring(0, 50)}...`);
            
            if (url.includes('webview')) {
                const chat = await conn.call("Runtime.evaluate", {
                    expression: `({
                        hasConversation: !!document.querySelector('#conversation'),
                        hasChat: !!document.querySelector('#chat'),
                        hasCascade: !!document.querySelector('#cascade'),
                        bodyText: document.body.innerText.substring(0, 100)
                    })`,
                    returnByValue: true
                });
                console.log(`  ChatCheck: ${JSON.stringify(chat.result?.value)}`);
            }
            conn.close();
        } catch (e) {
            console.log(`  Failed to connect to ${target.title}: ${e.message}`);
        }
    }
}
diagnose();
