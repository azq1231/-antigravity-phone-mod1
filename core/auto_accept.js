/**
 * Antigravity Auto-Accept Module
 * 參考 pesoszpesosz/antigravity-auto-accept 實作
 */

export async function runAutoAccept(cdpList) {
    const AUTO_ACCEPT_SCRIPT = `(() => {
        // 擴展匹配邏輯 (相容不同語言與 UI 框架)
        const findButtons = () => {
            const btns = Array.from(document.querySelectorAll('button'));
            return btns.filter(btn => {
                if (btn.disabled || btn.offsetHeight === 0) return false;
                
                const text = (btn.innerText || btn.textContent || "").trim();
                const aria = (btn.getAttribute('aria-label') || "").trim();
                const tooltip = (btn.getAttribute('data-tooltip-id') || "").trim();
                
                // 關鍵字清單
                const keywords = [
                    "Accept", "Continue", "Run", "Always Allow", "Review Changes", 
                    "接受", "繼續", "執行", "一律允許", "檢視變更"
                ];

                return keywords.some(k => 
                    text.includes(k) || 
                    aria.includes(k) || 
                    tooltip.includes(k)
                );
            });
        };

        const buttons = findButtons();
        if (buttons.length > 0) {
            console.log("[AUTO-ACCEPT] Found " + buttons.length + " candidate(s)");
            // 優先點擊「接受」或「繼續」
            const target = buttons.find(b => {
                const t = b.innerText;
                return t.includes("Accept") || t.includes("接受") || t.includes("Continue") || t.includes("繼續");
            }) || buttons[0];

            target.click();
            return { clicked: true, label: target.innerText || target.ariaLabel };
        }
        return { clicked: false };
    })()`;

    for (const cdp of cdpList) {
        for (const ctx of (cdp.contexts || [{id: undefined}])) {
            try {
                const res = await cdp.call("Runtime.evaluate", { 
                    expression: AUTO_ACCEPT_SCRIPT, 
                    returnByValue: true, 
                    contextId: ctx.id 
                });
                if (res?.result?.value?.clicked) {
                    console.log(`[V4-AUTO] Auto-accepted on context ${ctx.id}: ${res.result.value.label}`);
                    return { success: true, label: res.result.value.label };
                }
            } catch (e) { }
        }
    }
    return { success: false };
}
