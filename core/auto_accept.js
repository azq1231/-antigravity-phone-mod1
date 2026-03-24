/**
 * Antigravity Auto-Accept Module
 * 參考 pesoszpesosz/antigravity-auto-accept 實作
 */

export async function runAutoAccept(cdpList) {
    const AUTO_ACCEPT_SCRIPT = `(() => {
        // 智慧型 UI 定位：只點擊「真正的 UI 按鈕」，排除對話內容
        const findClickable = (root = document, offsetX = 0, offsetY = 0) => {
            let found = [];
            try {
                const elements = Array.from(root.querySelectorAll('*'));
                elements.forEach(el => {
                    const text = (el.innerText || el.textContent || "").trim();
                    const aria = (el.getAttribute('aria-label') || "").trim();
                    const tag = el.tagName.toLowerCase();
                    const styles = window.getComputedStyle(el);

                    // 關鍵字精確比對
                    const keywords = [
                        "Accept all", "Accept", "Allow Once", "Allow This Conversation", "Always Allow", "Yes",
                        "Run Alt+Enter", "Run", "Review Changes", "Allow",
                        "全部接受", "接受", "允許一次", "一律允許", "是", "執行", "查看變更"
                    ];

                    const isUIMatch = keywords.some(k => text === k || aria === k || text.includes(k));
                    
                    // 1. 排除對於普通對話內容的誤判，但如果是關鍵字按鈕則允許
                    if (el.closest('#conversation') && !isUIMatch) return;
                    
                    // 2. 嚴格檢查：必須是可見、可點擊、且符合特定按鈕格式的元件
                    if (el.offsetHeight > 0 && !el.disabled && styles.cursor === 'pointer') {
                        // 包含關鍵字且字串長度不宜過長 (排除長句子)
                        if (isUIMatch && text.length < 40) {
                            const rect = el.getBoundingClientRect();
                            found.push({ 
                                label: text.substring(0, 15), 
                                x: offsetX + rect.left + rect.width / 2, 
                                y: offsetY + rect.top + rect.height / 2 
                            });
                        }
                    }

                    if (el.shadowRoot) {
                        found = found.concat(findClickable(el.shadowRoot, offsetX, offsetY));
                    }
                    
                    try {
                        if (tag === 'iframe' && el.contentDocument) {
                            const fRect = el.getBoundingClientRect();
                            found = found.concat(findClickable(el.contentDocument, offsetX + fRect.left, offsetY + fRect.top));
                        }
                    } catch (e) { }
                });
            } catch (e) { }
            return found;
        };

        const matches = findClickable();
        return (matches && matches.length > 0) ? matches : null;
    })()`;

    if (!Array.isArray(cdpList)) cdpList = [cdpList];

    let totalClicked = 0;
    let lastLabel = "";

    for (const cdp of cdpList) {
        if (!cdp || !cdp.call) continue;
        const contexts = (cdp.contexts && cdp.contexts.length > 0) ? cdp.contexts : [{ id: undefined }];
        for (const ctx of contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { 
                    expression: AUTO_ACCEPT_SCRIPT, 
                    returnByValue: true, 
                    contextId: ctx.id 
                });
                const matches = res?.result?.value;
                if (matches && matches.length > 0) {
                    const target = matches[0];
                    console.log(`[V4-AUTO] Safe UI Click at (${Math.floor(target.x)}, ${Math.floor(target.y)}): ${target.label}`);
                    
                    const mouseParams = { x: Math.floor(target.x), y: Math.floor(target.y), button: 'left', clickCount: 1 };
                    
                    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...mouseParams });
                    await new Promise(r => setTimeout(r, 40));
                    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouseParams });
                    await new Promise(r => setTimeout(r, 80));
                    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouseParams });
                    
                    totalClicked++;
                    lastLabel = target.label;
                    // 此處不 return，繼續檢查其他 context/target
                }
            } catch (e) { }
        }
    }
    return { success: totalClicked > 0, label: lastLabel, count: totalClicked };
}
