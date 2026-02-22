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
                            const results = [];
                            const all = document.querySelectorAll('*');
                            for (const el of all) {
                                if (el.children.length === 0) {
                                    const t = (el.innerText || "").trim();
                                    if (t.includes('Gemini') || t.includes('Flash')) {
                                        results.push({
                                            tag: el.tagName,
                                            text: t,
                                            cls: el.className,
                                            aria: el.getAttribute('aria-label')
                                        });
                                    }
                                }
                            }
                            return { results, title: document.title };
                        })()`,
                        returnByValue: true,
                        contextId: ctxId
                    });

                    const val = res.result?.value;
                    if (!val || !val.results?.length) continue;

                    output.push(`  Context ${ctxId || 'default'} (${val.title}) found ${val.results.length} items:`);
                    val.results.forEach(item => {
                        output.push(`    <${item.tag}> "${item.text}" | class="${item.cls}" | aria="${item.aria}"`);
                    });
                } catch (e) { }
            }
        }
    } catch (e) {
        output.push('Error: ' + e.message);
    }

    const result = output.join('\n');
    fs.writeFileSync('scripts/global_search_result.txt', result, 'utf8');
    console.log(result);
    process.exit(0);
}

diagnose();
