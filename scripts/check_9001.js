
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001;
    const instances = await findAllInstances();
    const inst = instances.find(i => i.port === port);
    
    console.log(`Scanning Port ${port}...`);
    for (const target of inst.targets) {
        try {
            const conn = await connectCDP(target.url);
            const res = await conn.call("Runtime.evaluate", {
                expression: `({
                    url: window.location.href,
                    chatFound: !!document.querySelector('#conversation, #chat, #cascade'),
                    bodyText: document.body.innerText.substring(0, 50)
                })`,
                returnByValue: true
            });
            console.log(`Target: ${target.title.substring(0, 30)} | Chat: ${res.result?.value?.chatFound} | Text: ${res.result?.value?.bodyText?.replace(/\n/g, ' ')}`);
            conn.close();
        } catch (e) {}
    }
}
diagnose();
