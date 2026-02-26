import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseUsageLabel() {
    process.stdout.write('--- HUNTING FOR USAGE DIALOG ---\n');
    const ports = [9000, 9001, 9002, 9003];
    for (const port of ports) {
        try {
            process.stdout.write(`\n--- PORT ${port} ---\n`);
            const conns = await getOrConnectParams(port);
            if (!conns) continue;

            for (const conn of conns) {
                process.stdout.write(`Window: ${conn.title}\n`);

                const SCRIPT = `(async () => {
                    const logs = [];
                    const foundItems = [];

                    // 1. 尋找可能的點擊目標 (包含 % 的標籤)
                    const elements = Array.from(document.querySelectorAll('*'));
                    const target = elements.find(el => {
                        const t = (el.innerText || "").trim();
                        return t.includes('%') && t.length < 20 && el.offsetParent !== null;
                    });

                    if (target) {
                        logs.push("Found target: " + target.innerText);
                        
                        // 2. 模擬點擊
                        target.click();
                        logs.push("Clicked target.");
                        
                        // 等待彈窗出現
                        await new Promise(r => setTimeout(r, 1000));
                        
                        // 3. 掃描畫面上所有可見的文字塊 (可能是彈窗內容)
                        const allVisible = Array.from(document.querySelectorAll('*'))
                            .filter(el => {
                                const rect = el.getBoundingClientRect();
                                return rect.width > 20 && rect.height > 20 && el.offsetParent !== null;
                            });

                        // 抓取包含恢復時間或關鍵字的模型
                        allVisible.forEach(el => {
                            const t = (el.innerText || "").trim();
                            if ((t.includes('Gemini') || t.includes('Claude') || t.includes('恢復') || t.includes('restore') || t.includes('h ')) && t.length < 500) {
                                if (el.children.length < 5) { // 具體項目
                                    foundItems.push({ text: t, tag: el.tagName, cls: el.className });
                                }
                            }
                        });
                        
                        // 4. 關閉彈窗 (按 ESC)
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    } else {
                        logs.push("No '%' label found.");
                    }

                    return { logs, foundItems };
                })()`;

                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true });
                const result = res?.result?.value;

                if (result) {
                    process.stdout.write(`  Logs: ${result.logs.join(' | ')}\n`);
                    if (result.foundItems.length > 0) {
                        process.stdout.write(`  Found Items (Potential Dialog Content):\n`);
                        result.foundItems.forEach(f => {
                            process.stdout.write(`    - [${f.text}] (${f.tag})\n`);
                        });
                    }
                }
            }
        } catch (e) {
            process.stdout.write(`  Error: ${e.message}\n`);
        }
    }
}

diagnoseUsageLabel();
