import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseAll() {
    process.stdout.write('--- DIAGNOSING ALL STATUSES ---\n');
    const ports = [9000, 9001, 9002, 9003];
    for (const port of ports) {
        try {
            const conns = await getOrConnectParams(port);
            if (!conns) continue;
            process.stdout.write(`\n--- PORT ${port} ---\n`);
            for (const conn of conns) {
                process.stdout.write(`Window: ${conn.title}\n`);

                const SCRIPT = `(() => {
                    const results = [];
                    // 1. 抓取所有點開來的 Status Bar Items (VS Code 特徵)
                    const items = Array.from(document.querySelectorAll('.statusbar-item'));
                    items.forEach(item => {
                        results.push({
                            type: 'StatusBarItem',
                            text: (item.innerText || "").trim(),
                            title: item.getAttribute('title'),
                            id: item.id,
                            cls: item.className
                        });
                    });

                    // 2. 抓取所有 Aria Label 包含 "Model" 或 "Speed" 的
                    const ariaNodes = Array.from(document.querySelectorAll('[aria-label]'));
                    ariaNodes.forEach(node => {
                        const label = node.getAttribute('aria-label');
                        if (label.includes('Model') || label.includes('Speed')) {
                            results.push({
                                type: 'AriaNode',
                                label,
                                text: node.innerText.trim(),
                                cls: node.className
                            });
                        }
                    });

                    // 3. 抓取所有包含數字+%的 SPAN
                    const spans = Array.from(document.querySelectorAll('span'));
                    spans.forEach(span => {
                        const t = span.innerText.trim();
                        if (/%$/.test(t) && t.length < 10) {
                            results.push({
                                type: 'PercentSpan',
                                text: t,
                                cls: span.className
                            });
                        }
                    });

                    return results;
                })()`;

                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
                const found = res?.result?.value;
                if (found && found.length > 0) {
                    found.slice(0, 20).forEach(f => {
                        process.stdout.write(`  [${f.type}] Text: ${f.text || f.label} | Cls: ${f.cls}\n`);
                    });
                } else {
                    process.stdout.write(`  Nothing found.\n`);
                }
            }
        } catch (e) {
            process.stdout.write(`  Error: ${e.message}\n`);
        }
    }
}

diagnoseAll();
