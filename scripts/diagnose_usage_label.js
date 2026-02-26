import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseUsageLabel() {
    process.stdout.write('--- DIAGNOSING USAGE LABEL ---\n');
    const ports = [9000, 9001, 9002, 9003];
    for (const port of ports) {
        try {
            process.stdout.write(`\n[Port ${port}] 正在掃描...`);
            const conns = await getOrConnectParams(port);
            if (!conns || conns.length === 0) {
                process.stdout.write(` Port ${port}: 沒有連線。\n`);
                continue;
            }
            process.stdout.write(` 找到 ${conns.length} 個連線。\n`);
            for (const conn of conns) {
                process.stdout.write(` - 視窗: ${conn.title}\n`);

                // 嘗試多個 context
                const contexts = conn.contexts && conn.contexts.length > 0 ? conn.contexts : [{ id: undefined }];

                for (const ctx of contexts) {
                    process.stdout.write(`   - Context ${ctx.id || 'default'}: `);
                    const SCRIPT = `(() => {
                        try {
                            const results = [];
                            
                            // 1. 抓取包含百分比的文字
                            const elements = Array.from(document.querySelectorAll('*'));
                            const percentEls = elements.filter(el => {
                                const t = (el.innerText || "").trim();
                                return t.includes('%') && t.length < 50;
                            });
                            
                            percentEls.forEach(el => {
                                results.push({
                                    type: 'PercentLabel',
                                    text: el.innerText.trim(),
                                    tag: el.tagName,
                                    cls: el.className,
                                    title: el.getAttribute('title'),
                                    aria: el.getAttribute('aria-label'),
                                    html: el.outerHTML.substring(0, 100)
                                });
                            });

                            // 2. 抓取狀態列所有按鈕 (StatusBar Items)
                            const statusItems = Array.from(document.querySelectorAll('.statusbar-item, [class*="statusbar"] div, [class*="statusbar"] a'));
                            statusItems.forEach(el => {
                                const t = (el.innerText || "").trim();
                                if (t.length > 0 && t.length < 50) {
                                    results.push({
                                        type: 'StatusItem',
                                        text: t,
                                        tag: el.tagName,
                                        cls: el.className,
                                        title: el.getAttribute('title'),
                                        html: el.outerHTML.substring(0, 100)
                                    });
                                }
                            });

                            return results;
                        } catch(e) { return {error: e.toString()}; }
                    })()`;

                    const params = { expression: SCRIPT, returnByValue: true };
                    if (ctx.id !== undefined) params.contextId = ctx.id;

                    const res = await conn.call("Runtime.evaluate", params);
                    const result = res?.result?.value;

                    if (Array.isArray(result) && result.length > 0) {
                        process.stdout.write(`找到 ${result.length} 個候選元素。\n`);
                        // 過濾重複文字或不感興趣的
                        const seen = new Set();
                        result.forEach(f => {
                            if (seen.has(f.text)) return;
                            seen.add(f.text);
                            process.stdout.write(`     [${f.type}] [${f.text}] Tag: ${f.tag} | Cls: ${f.cls.substring(0, 30)} | Title: ${f.title}\n`);
                        });
                        break; // 找到就換下一個視窗
                    } else if (result?.error) {
                        process.stdout.write(`錯誤: ${result.error}\n`);
                    } else {
                        process.stdout.write(`無候選元素。\n`);
                    }
                }
            }
        } catch (e) {
            process.stdout.write(` Port ${port} 失敗: ${e.message}\n`);
        }
    }
    process.stdout.write('\n--- DIAGNOSIS FINISHED ---\n');
}

diagnoseUsageLabel().catch(err => {
    process.stdout.write(`\nFATAL ERROR: ${err.message}\n`);
});
