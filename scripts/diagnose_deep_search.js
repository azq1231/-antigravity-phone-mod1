import { getOrConnectParams } from '../core/cdp_manager.js';

async function deepSearch() {
    process.stdout.write('--- DEEP SEARCHING FOR % SYMBOL ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            const SCRIPT = `(() => {
                const results = [];
                // 遍歷所有節點，甚至是 Shadow DOM 
                function walk(node) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        if (node.textContent.includes('%')) {
                            const parent = node.parentElement;
                            if (parent && parent.offsetParent !== null) {
                                results.push({
                                    text: parent.innerText,
                                    tag: parent.tagName,
                                    cls: parent.className,
                                    html: parent.outerHTML.substring(0, 100)
                                });
                            }
                        }
                    }
                    if (node.childNodes) {
                        node.childNodes.forEach(walk);
                    }
                    if (node.shadowRoot) {
                        walk(node.shadowRoot);
                    }
                }
                walk(document.body);
                return results;
            })()`;

            const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            const found = res?.result?.value;
            if (found && found.length > 0) {
                found.forEach(f => {
                    process.stdout.write(`  [${f.text}] | Tag: ${f.tag} | Cls: ${f.cls}\n`);
                });
            } else {
                process.stdout.write(`  Nothing found via direct walk.\n`);
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

deepSearch();
