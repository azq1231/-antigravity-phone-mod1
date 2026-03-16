
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const instances = await findAllInstances();
    const inst = instances.find(i => i.port === port);
    
    for (const target of inst.targets) {
        try {
            const conn = await connectCDP(target.url);
            const res = await conn.call("Runtime.evaluate", {
                expression: `({
                    url: window.location.href,
                    iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src)
                })`,
                returnByValue: true
            });
            const data = res.result?.value;
            if (data && data.url.includes('webview')) {
                console.log(`Webview: ${data.url.substring(0, 50)}...`);
                console.log(`Nested iframes: ${data.iframes.length}`);
                data.iframes.forEach(src => console.log(`  - ${src.substring(0, 50)}...`));
            }
            conn.close();
        } catch (e) {}
    }
    process.exit(0);
}
diagnose();
