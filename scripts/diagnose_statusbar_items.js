import { getOrConnectParams } from '../core/cdp_manager.js';
import fs from 'fs';

async function diagnose() {
    const port = 9000;
    const output = [];
    try {
        const conn = await getOrConnectParams(port);

        for (const cdp of conn) {
            output.push(`\n=== Target: ${cdp.title} ===`);
            const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];

            for (const ctxId of ctxIds) {
                try {
                    const res = await cdp.call("Runtime.evaluate", {
                        expression: `(() => {
                            const items = Array.from(document.querySelectorAll('.statusbar-item')).map((el, i) => ({
                                index: i,
                                text: (el.innerText || "").trim().substring(0, 60),
                                ariaLabel: (el.getAttribute('aria-label') || "").substring(0, 60),
                                cls: el.className.substring(0, 80)
                            })).filter(x => x.text.length > 0);
                            
                            const footer = document.querySelector('.part.statusbar, footer');
                            const footerText = footer ? footer.innerText.substring(0, 300) : null;
                            
                            return { items, footerText, title: document.title };
                        })()`,
                        returnByValue: true,
                        contextId: ctxId
                    });

                    const val = res.result?.value;
                    if (!val || (!val.items?.length && !val.footerText)) continue;

                    output.push(`  Context ${ctxId || 'default'} (${val.title}):`);

                    if (val.footerText) {
                        output.push(`  [Footer Text]: ${val.footerText}`);
                    }

                    if (val.items?.length > 0) {
                        output.push(`  [StatusBar Items] (${val.items.length}):`);
                        val.items.forEach(item => {
                            output.push(`    #${item.index}: text="${item.text}" | aria="${item.ariaLabel}"`);
                        });
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        output.push('Error: ' + e.message);
    }

    const result = output.join('\n');
    fs.writeFileSync('scripts/statusbar_result.txt', result, 'utf8');
    console.log(result);
    process.exit(0);
}

diagnose();
