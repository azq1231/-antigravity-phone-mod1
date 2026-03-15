
import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpRefreshes() {
    const port = 9001;
    const conn = await getOrConnectParams(port, true);
    const settings = conn.find(c => c.title === 'Settings');
    if (!settings) { console.log("No Settings window"); process.exit(1); }
    
    const res = await settings.call('Runtime.evaluate', {
        expression: `JSON.stringify(Array.from(document.querySelectorAll('div, span')).filter(el => (el.innerText||'').includes('Refreshes in')).map(el => ({ tag: el.tagName, class: el.className.substring(0,30), childCount: el.children.length, text: el.innerText.substring(0, 80).replace(/\\n/g,'|') })))`,
        returnByValue: true
    });
    const items = JSON.parse(res?.result?.value || '[]');
    console.log("Elements with 'Refreshes in':");
    items.forEach(i => console.log(`  [${i.tag}] .${i.class} children=${i.childCount} -> "${i.text}"`));
    
    process.exit(0);
}

dumpRefreshes().catch(console.error);
