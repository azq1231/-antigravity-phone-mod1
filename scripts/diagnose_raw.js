import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseRaw() {
    process.stdout.write('--- DIAGNOSING RAW HTML ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            // 直接抓整個 body，但只取前 5000 字，因為 Status bar 通常在底部或特定區域
            const SCRIPT = `(() => {
                const body = document.body;
                if (!body) return "NO BODY";
                
                // 抓取所有包含數字的元素的文字，且長度極短 (可能是用量)
                const candidates = Array.from(document.querySelectorAll('*'))
                    .filter(el => {
                        const t = (el.innerText || "").trim();
                        return /[0-9]/.test(t) && t.length < 15 && el.offsetParent !== null;
                    })
                    .map(el => "[" + el.innerText.trim() + "](" + el.className + ")");

                return {
                    title: document.title,
                    htmlHeader: body.innerHTML.substring(0, 1000),
                    htmlFooter: body.innerHTML.substring(body.innerHTML.length - 2000),
                    candidates: candidates.slice(0, 50)
                };
            })()`;

            const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            const result = res?.result?.value;
            if (result) {
                process.stdout.write(`  Title: ${result.title}\n`);
                process.stdout.write(`  Short candidates: ${result.candidates.join(', ')}\n`);
                // 如果有 body，我們寫到檔案裡分析，避免 terminal 截斷
                const fs = await import('fs');
                const logPath = `d:/MyProjects/antigravity_phone_chat_ori/tmp_dom_${conn.title.replace(/[^a-z0-9]/gi, '_')}.html`;
                fs.writeFileSync(logPath, result.htmlHeader + "\n--- MIDDLE ---\n" + result.htmlFooter);
                process.stdout.write(`  Wrote partial DOM to ${logPath}\n`);
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

diagnoseRaw();
