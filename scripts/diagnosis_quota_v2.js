import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001; // 假設用戶主要使用 9001
    console.log(`正在連接到埠號 ${port}...`);
    const cdpList = await getOrConnectParams(port, true);
    
    if (cdpList.length === 0) {
        console.error("未找到任何 CDP 目標");
        return;
    }

    const SCRIPT = `(() => {
        const results = [];
        const scan = (doc, prefix = "") => {
            const allElements = Array.from(doc.querySelectorAll('div, section, [role="dialog"] div, .monaco-list-row, .statusbar-item'));
            allElements.forEach(el => {
                const text = (el.innerText || "").trim();
                const aria = (el.getAttribute('aria-label') || "").trim();
                const content = text + " " + aria;
                if (content.includes("配額") || content.includes("重置") || content.includes("用量") || content.includes("%")) {
                    results.push({
                        tagName: el.tagName,
                        className: el.className,
                        text: content.substring(0, 100),
                        path: prefix
                    });
                }
            });
            
            // 遞迴掃描 iframe
            doc.querySelectorAll('iframe').forEach((iframe, idx) => {
                try {
                    if (iframe.contentDocument) {
                        scan(iframe.contentDocument, prefix + "iframe[" + idx + "] > ");
                    }
                } catch(e) {}
            });
        };
        scan(document);
        return results;
    })()`;

    for (const cdp of cdpList) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
            const data = res.result?.value;
            if (data && data.length > 0) {
                console.log(`--- 目標: ${cdp.title} ---`);
                data.forEach((item, i) => {
                    console.log(`[${i}] ${item.tagName}.${item.className}`);
                    console.log(`    文本: ${item.text}`);
                });
            }
        } catch (e) {
            console.error(`執行腳本失敗: ${e.message}`);
        }
    }
}

diagnose().then(() => process.exit(0));
