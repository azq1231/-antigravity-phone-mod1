import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const EXP = `(async () => {
        const results = [];
        const all = Array.from(document.querySelectorAll('*'));
        
        const mode = all.find(el => el.innerText?.trim() === 'Fast' || el.innerText?.trim() === 'Planning');
        results.push({ key: 'mode_search', found: !!mode, text: mode?.innerText });

        const modelKeywords = ["Gemini", "Claude", "GPT", "o1", "Sonnet", "Opus"];
        const candidates = all.filter(el => {
            const t = el.innerText?.trim() || "";
            const hasKeyword = modelKeywords.some(k => t.includes(k));
            if (!hasKeyword) return false;
            if (t.includes('|') || t.includes('%')) return false;
            return true;
        }).map(el => ({
            tag: el.tagName,
            text: el.innerText.trim(),
            className: el.className,
            children: el.children.length,
            isButton: !!el.closest('button'),
            opacity70: el.className.includes('opacity-70')
        }));

        return { mode_found: !!mode, candidates: candidates.slice(0, 10) };
    })()`;

    try {
        const conn = await getOrConnectParams(port);
        const res = await conn[0].call("Runtime.evaluate", { expression: EXP, returnByValue: true });
        console.log(JSON.stringify(res.result.value, null, 2));
    } catch (e) { console.error(e); }
}
diagnose();
