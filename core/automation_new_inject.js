
/**
 * 核心注入函式：發送文字
 * 採用底層 CDP 入侵，繞過 React/Lexical 所有阻擋
 */
export async function injectMessage(cdpList, text, force = false) {
    const CHECK_SCRIPT = `(async () => {
        const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
        if (editors.length === 0) return { ok: false, error: "no_editor" };
        
        const editor = editors[editors.length - 1];
        editor.focus();
        editor.innerHTML = '<p dir="ltr"><br></p>';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
    })()`;

    for (const cdp of cdpList) {
        // 優先嘗試主世界 (undefined context)
        const contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        
        for (const ctxId of contexts) {
            try {
                const params = { expression: CHECK_SCRIPT, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                
                const checkRes = await cdp.call("Runtime.evaluate", params);
                if (checkRes?.result?.value?.ok) {
                    // FOUND!
                    await cdp.call('Input.insertText', { text: text });
                    await new Promise(r => setTimeout(r, 100));

                    // 同步狀態
                    await cdp.call("Runtime.evaluate", { 
                        expression: `(() => {
                            const editor = [...document.querySelectorAll('[data-lexical-editor="true"]')].at(-1);
                            if (editor) {
                                editor.dispatchEvent(new Event('input', { bubbles: true }));
                                editor.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        })()`,
                        contextId: ctxId
                    });
                    
                    await new Promise(r => setTimeout(r, 100));
                    
                    // Enter
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                    await new Promise(r => setTimeout(r, 20));
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                    
                    // Fallback Click
                    await new Promise(r => setTimeout(r, 600));
                    await cdp.call("Runtime.evaluate", {
                        expression: `(() => {
                            const editor = [...document.querySelectorAll('[data-lexical-editor="true"]')].at(-1);
                            if (editor && editor.innerText.trim().length > 0) {
                                const btn = document.querySelector('button[data-tooltip-id*="send"]') || 
                                            Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Send') || b.ariaLabel?.includes('Send'));
                                if (btn && !btn.disabled) btn.click();
                            }
                        })()`,
                        contextId: ctxId
                    });

                    return { ok: true, method: "cdp_v4_smart_send" };
                }
            } catch (e) { }
        }
    }
    return { ok: false, error: "no_editor_found" };
}
