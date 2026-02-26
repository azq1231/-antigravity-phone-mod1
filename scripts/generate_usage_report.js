import { getOrConnectParams } from '../core/cdp_manager.js';
import fs from 'fs';

async function generateReport() {
    process.stdout.write('--- GENERATING USAGE LABEL REPORT ---\n');
    const port = 9000;
    const reportData = {
        timestamp: new Date().toISOString(),
        details: []
    };

    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            const SCRIPT = `(() => {
                const all = Array.from(document.querySelectorAll('*'));
                return all.filter(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                }).map(el => {
                    const rect = el.getBoundingClientRect();
                    return {
                        text: el.innerText.trim(),
                        tag: el.tagName,
                        className: el.className,
                        id: el.id,
                        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
                        outerHTML: el.outerHTML.substring(0, 200)
                    };
                });
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res?.result?.value) {
                    reportData.details.push({
                        title: conn.title,
                        url: conn.url,
                        contextId: ctx.id,
                        found: res.result.value
                    });
                }
            }
        }

        const reportPath = 'd:/MyProjects/antigravity_phone_chat_ori/usage_label_report.json';
        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));

        // 生成 Markdown 易讀版
        let mdReport = `# Usage Label Diagnostic Report\n\n`;
        reportData.details.forEach(win => {
            mdReport += `## Window: ${win.title}\n`;
            win.found.forEach(f => {
                mdReport += `- **Text**: \`${f.text}\`\n`;
                mdReport += `  - **Element**: \`${f.tag.toLowerCase()}${f.className ? '.' + f.className.split(' ').join('.') : ''}\`\n`;
                mdReport += `  - **Position**: X: ${f.rect.x.toFixed(1)}, Y: ${f.rect.y.toFixed(1)}\n`;
                mdReport += `  - **Size**: ${f.rect.w.toFixed(1)} x ${f.rect.h.toFixed(1)}\n`;
                mdReport += `  - **HTML**: \`${f.outerHTML}\`\n\n`;
            });
        });
        fs.writeFileSync('d:/MyProjects/antigravity_phone_chat_ori/usage_label_report.md', mdReport);

        process.stdout.write(`Report generated at usage_label_report.md\n`);
    } catch (e) {
        process.stdout.write(`Error: ${e.message}\n`);
    }
}

generateReport();
