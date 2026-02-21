import { getOrConnectParams } from '../core/cdp_manager.js';

async function dumpAppStateDebug() {
    console.log("🔍 [DIAGNOSIS] Probing App State Elements...");
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        console.log("✅ CDP Connected (Targets:", conns.length, ")");

        const EXP = `(async () => {
            const debugInfo = { candidates: [] };
            try {
                const allEls = Array.from(document.querySelectorAll('*'));
                const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
                
                const matches = textNodes.filter(el => {
                    return ["Gemini", "Claude", "GPT", "Grok", "o1", "Sonnet", "Opus"].some(k => el.innerText.includes(k));
                });

                matches.forEach(el => {
                    debugInfo.candidates.push({
                        text: el.innerText.trim(),
                        tagName: el.tagName,
                        className: el.className,
                        closestButton: !!el.closest('button'),
                        closestStatusbar: !!el.closest('[class*="statusbar"]') || !!el.closest('[class*="status-bar"]')
                    });
                });
                return debugInfo;
            } catch(e) { return { error: e.toString() }; }
        })()`;

        for (const cdp of conns) {
            const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
            for (const ctxId of ctxIds) {
                try {
                    const params = { expression: EXP, returnByValue: true, awaitPromise: true };
                    if (ctxId !== undefined) params.contextId = ctxId;
                    const res = await cdp.call("Runtime.evaluate", params);
                    if (res.result && res.result.value && !res.result.value.error && res.result.value.candidates.length > 0) {
                        console.log(JSON.stringify(res.result.value, null, 2));
                        return;
                    }
                } catch (e) { }
            }
        }
    } catch (e) {
        console.error("💥 Error during probe:", e.message);
    }
}

dumpAppStateDebug();
