import { getDetailedUsage } from './auto_usage.js';

/**
 * 訊息注入 (Blind Ninja Method)
 * 使用 CDP Input.insertText 與 KeyboardEvent 模擬，繞過所有 UI 框架限制。
 */
export async function injectMessage(cdpList, text, force = false) {
    const CHECK_SCRIPT = `(async () => {
        const cancel = document.querySelector('button[data-tooltip-id*="cancel"], button svg.lucide-square')?.closest('button');
        if (!${force} && cancel && cancel.offsetHeight > 0) return { ok: false, reason: "busy" };

        const editors = [...document.querySelectorAll('[data-lexical-editor="true"], [contenteditable="true"]')].filter(el => el.offsetHeight > 0);
        if (editors.length === 0) return { ok: false, error: "no_editor" };
        
        const editor = editors[editors.length - 1];
        editor.focus();

        // 強力清空
        while (editor.firstChild) editor.removeChild(editor.firstChild);
        const p = document.createElement('p');
        p.setAttribute('dir', 'ltr');
        p.appendChild(document.createElement('br'));
        editor.appendChild(p);

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
    })()`;

    for (const cdp of cdpList) {
        const contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        for (const ctxId of contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: CHECK_SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctxId });
                if (res?.result?.value?.reason === 'busy') return res.result.value;
                if (res?.result?.value?.ok) {
                    // 1. 寫入文字
                    await cdp.call('Input.insertText', { text: text });
                    await new Promise(r => setTimeout(r, 100));

                    // 2. 模擬 Enter 發送
                    const kEnter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...kEnter });
                    await new Promise(r => setTimeout(r, 20));
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...kEnter });
                    
                    // 3. 備援：如果文字還在，嘗試點擊實體按鈕
                    await new Promise(r => setTimeout(r, 600));
                    await cdp.call("Runtime.evaluate", {
                        expression: `(() => {
                            const editor = [...document.querySelectorAll('[data-lexical-editor="true"]')].at(-1);
                            if (editor && editor.innerText.trim().length > 0) {
                                const btn = document.querySelector('button[data-tooltip-id*="send"]') || 
                                            Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Send') || b.ariaLabel?.includes('Send'));
                                if (btn) btn.click();
                            }
                        })()`,
                        contextId: ctxId
                    });

                    return { ok: true, method: "blind_ninja_v4" };
                }
            } catch (e) { }
        }
    }
    return { ok: false, error: "no_editor_found" };
}

/**
 * 圖片與附件注入 (Hardware Snap-Clear Method)
 */
export async function injectImage(cdpList, base64Data, text = null) {
    const PREPARE_SCRIPT = `(async () => {
        try {
            const editors = [...document.querySelectorAll('[data-lexical-editor="true"], [contenteditable="true"]')].filter(el => el.offsetHeight > 0);
            const target = editors[editors.length - 1];
            if (!target) return { ok: false, error: "no_editor" };

            target.focus();
            
            const parts = "${base64Data}".split(',');
            const byteString = atob(parts[parts.length - 1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: "image/png" });
            const file = new File([blob], "upload.png", { type: "image/png" });

            const dt = new DataTransfer();
            dt.items.add(file);
            target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));

            // 尋找發送按鈕坐標 (精確過濾版)
            const findSendBtn = () => {
                const candidates = Array.from(document.querySelectorAll('button')).filter(btn => {
                    const label = (btn.getAttribute('aria-label') || "").toLowerCase();
                    const tip = (btn.getAttribute('data-tooltip-id') || "").toLowerCase();
                    const text = btn.innerText.toLowerCase();
                    
                    // 基礎關鍵字匹配
                    const isMatch = (label.includes('send') || tip.includes('send') || text.includes('發送')) && btn.offsetHeight > 0;
                    
                    // 排除清單：避免點到終端機發送或其他切換按鈕
                    const isExcluded = label.includes('terminal') || label.includes('history') || label.includes('mode') || label.includes('plan');
                    
                    return isMatch && !isExcluded;
                });

                if (candidates.length === 0) return null;

                // 智慧排序：優先選擇最右下角的按鈕
                const best = candidates.sort((a, b) => {
                    const ra = a.getBoundingClientRect();
                    const rb = b.getBoundingClientRect();
                    // 分數計算：越靠右、越靠下分數越高
                    const scoreA = ra.right + ra.bottom;
                    const scoreB = rb.right + rb.bottom;
                    return scoreB - scoreA;
                })[0];

                const r = best.getBoundingClientRect();
                return { x: r.left + r.width/2, y: r.top + r.height/2, label: best.getAttribute('aria-label') };
            };

            const rect = findSendBtn();
            return { ok: true, rect: rect, foundLabel: rect ? rect.label : null };
        } catch (e) { return { ok: false, error: e.toString() }; }
    })()`;

    for (const cdp of cdpList) {
        const contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        for (const ctxId of contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: PREPARE_SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctxId });
                const val = res.result?.value;
                if (val && val.ok) {
                    if (text) {
                        await cdp.call('Input.insertText', { text: text + " " });
                        await new Promise(r => setTimeout(r, 200));
                    }
                    
                    // 關鍵等待：讓 Lexical 處理圖片數據
                    await new Promise(r => setTimeout(r, 800));

                    if (val.rect) {
                        console.log(`[AUTO-INJECT] Clicking send button: ${val.foundLabel} at (${Math.floor(val.rect.x)}, ${Math.floor(val.rect.y)})`);
                        const mouseBase = { x: Math.floor(val.rect.x), y: Math.floor(val.rect.y), button: 'left', clickCount: 1 };
                        await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouseBase });
                        await new Promise(r => setTimeout(r, 50));
                        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouseBase });
                    }
                    
                    // 實體 Enter 補位 (Dual Trigger Strategy)
                    const kEnter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...kEnter });
                    await new Promise(r => setTimeout(r, 20));
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...kEnter });
                    
                    return { ok: true, method: "optimized_snap_clear" };
                }
            } catch (e) { }
        }
    }
    return { ok: false, error: "injection_failed" };
}
