
import { getOrConnectParams } from '../core/cdp_manager.js';

async function findModelsNav() {
    const port = 9001;
    const conn = await getOrConnectParams(port, true);
    const settings = conn.find(c => c.title === 'Settings');
    if (!settings) { console.log("No Settings"); process.exit(0); }
    
    const res = await settings.call('Runtime.evaluate', {
        expression: `(() => {
            // Find ALL elements with text "Models" - leaf only
            const all = Array.from(document.querySelectorAll('*')).filter(el => {
                return el.children.length === 0 && el.innerText.trim() === 'Models';
            });
            return JSON.stringify(all.map(el => ({
                tag: el.tagName,
                class: el.className,
                visible: el.offsetParent !== null,
                offsetH: el.offsetHeight,
                parent: el.parentElement?.className
            })));
        })()`,
        returnByValue: true
    });
    const items = JSON.parse(res?.result?.value || '[]');
    console.log("All 'Models' elements:");
    items.forEach(i => console.log(`  [${i.tag}] .${i.class} visible=${i.visible} h=${i.offsetH} parent=.${i.parent}`));
    process.exit(0);
}

findModelsNav().catch(console.error);
