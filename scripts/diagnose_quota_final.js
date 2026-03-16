import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9001;
    console.log(`--- [Quota Deep Scan] Port ${port} ---`);
    const cdpList = await getOrConnectParams(port, true);
    
    // 試圖尋找對話框
    const SCRIPT = `(() => {
        const results = [];
        const scan = (doc, prefix = "") => {
            // 找出所有可能的容器
            const elements = Array.from(doc.querySelectorAll('div, section, [role="dialog"] div, .monaco-list-row'));
            elements.forEach(el => {
                const text = (el.innerText || "").trim();
                // 如果包含模型關鍵字，記錄其前 500 字元
                if (text.includes("Flash") || text.includes("Pro") || text.includes("Claude")) {
                    results.push({
                        path: prefix,
                        tagName: el.tagName,
                        className: el.className,
                        text: text.substring(0, 500),
                        htmlSnippet: el.outerHTML.substring(0, 300)
                    });
                }
            });
            
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
                console.log(`\n### 目標: ${cdp.title} ###`);
                data.forEach((item, i) => {
                    // 只打印長度適中且包含關鍵數據的
                    if (item.text.includes("%") || item.text.includes("重置")) {
                        console.log(`\n[${i}] ${item.path}${item.tagName}.${item.className}`);
                        console.log(`文本內容:\n"""\n${item.text}\n"""`);
                    }
                });
            }
        } catch (e) {
            console.error(`掃描出錯: ${e.message}`);
        }
    }
}

diagnose().then(() => process.exit(0));
