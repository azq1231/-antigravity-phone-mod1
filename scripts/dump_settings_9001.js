
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpSettings() {
    const port = 9001;
    try {
        const conn = await getOrConnectParams(port, true);
        const settings = conn.find(c => c.title === 'Settings');
        if (settings) {
            const html = await settings.call("Runtime.evaluate", { expression: `document.body.innerHTML` });
            const text = await settings.call("Runtime.evaluate", { expression: `document.body.innerText` });
            console.log("--- HTML START ---");
            console.log(html.result.value.substring(0, 1000));
            console.log("--- TEXT START ---");
            console.log(text.result.value);
        } else {
            console.log("Settings window not found");
        }
    } catch (e) {}
    process.exit(0);
}

dumpSettings();
