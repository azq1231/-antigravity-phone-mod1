import { getOrConnectParams } from '../core/cdp_manager.js';

async function trace() {
    const port = 9001;
    console.log(`--- [SubText Trace] Port ${port} ---`);
    const cdpList = await getOrConnectParams(port, true);
    
    const SCRIPT = `(() => {
        const results = [];
        const nameMap = { 'Pro': 'Gemini 3 Pro (H/L)', 'Flash': 'Gemini 3 Flash', 'Claude': 'Claude / GPT-4o' };
        const getGroupKey = (name) => {
            if (!name) return null;
            const n = name.trim().toLowerCase();
            if (n.includes('flash')) return nameMap['Flash'];
            if (n.includes('pro')) return nameMap['Pro'];
            if (n.includes('gpt') || n.includes('claude') || n.includes('4o')) return nameMap['Claude'];
            return null;
        };

        const scan = (doc, prefix = "") => {
            const containers = Array.from(doc.querySelectorAll('div, section, [role="dialog"] div, .monaco-list-row, .card, .quota-compact-item'));
            containers.forEach(container => {
                const cText = (container.innerText || "").trim();
                if (cText.length < 5) return;

                const modelRegex = /(Flash|Pro|Claude|GPT-4o)/gi;
                let match;
                while ((match = modelRegex.exec(cText)) !== null) {
                    const key = getGroupKey(match[1]);
                    if (!key) continue;
                    const subText = cText.substring(match.index, match.index + 200);
                    results.push({
                        model: match[1],
                        key,
                        subText: subText.replace(/\\n/g, '[\\\\n]'),
                        path: prefix + container.tagName + "." + container.className
                    });
                }
            });
            doc.querySelectorAll('iframe').forEach(iframe => {
                try { if (iframe.contentDocument) scan(iframe.contentDocument, prefix + "if > "); } catch(e) {}
            });
        };
        scan(document);
        return results;
    })()`;

    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
        const data = res.result?.value;
        if (data && data.length > 0) {
            console.log(`\n### Target: ${cdp.title} ###`);
            data.forEach(item => {
                console.log(`Model: ${item.model} | Path: ${item.path}`);
                console.log(`SubText: ${item.subText}\n`);
            });
        }
    }
}
trace().then(() => process.exit(0));
