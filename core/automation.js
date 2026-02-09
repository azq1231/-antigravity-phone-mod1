import { simpleHash } from './utils.js';

export async function captureSnapshot(cdpList) {
    const CAPTURE_SCRIPT = `(() => {
        const findCascade = (root) => {
            return root.getElementById('conversation') || 
                   root.getElementById('cascade') || 
                   root.querySelector('[class*="chat-container"]') ||
                   root.querySelector('[class*="chat-panel"]');
        };

        const cascade = findCascade(document);
        if (!cascade) return { error: 'cascade not found' };
        
        const clone = cascade.cloneNode(true);
        
        // 1. Destructive Removal: All UI Controls
        const killList = [
            'button', 'svg', 'input', 'textarea', 'form', 'nav', 'header', 'footer',
            '[role="button"]', '[role="menu"]', '[role="dialog"]',
            '[class*="toolbar"]', '[class*="footer"]', '[class*="header"]',
            '[class*="model-selector"]', '[class*="prompt"]', '[class*="input"]',
            '[id^="headlessui-"]', '.splash', '.decor'
        ];
        killList.forEach(sel => {
            clone.querySelectorAll(sel).forEach(el => el.remove());
        });

        // 2. Text-Based Removal: IDE Meta Info
        const garbageKeywords = [
            'files with changes', 'review changes', 'select file', '選擇檔案', 
            'fast', 'claude', 'gemini', 'gpt-oss', 'ask anything', 'ctrl+l'
        ];
        const allNodes = clone.querySelectorAll('*');
        allNodes.forEach(el => {
            if (el.children.length === 0 || (el.children.length === 1 && el.firstElementChild.tagName === 'SPAN')) {
                const txt = (el.innerText || '').toLowerCase();
                if (garbageKeywords.some(kw => txt.includes(kw))) {
                    el.remove();
                }
            }
            // Remove lingering empty divs or ones with just icons (that we deleted)
            if (el.innerText?.trim() === '' && el.children.length === 0 && el.tagName !== 'BR') {
                el.remove();
            }
        });

        // 3. Layout Normalization & Ghost Height Removal
        const cleanupStyles = (el) => {
            if (el.style) {
                // Remove explicit pixel heights that cause ghost scrolling
                if (el.style.height && el.style.height.includes('px')) el.style.height = 'auto';
                if (el.style.minHeight && el.style.minHeight.includes('px')) el.style.minHeight = '0';
                // Kill padding that might be bloating the bottom
                el.style.paddingBottom = '0';
            }
            Array.from(el.children).forEach(cleanupStyles);
        };
        
        cleanupStyles(clone);

        clone.style.padding = '0';
        clone.style.margin = '0';
        clone.style.height = 'auto';
        clone.style.minHeight = '0';

        const html = clone.outerHTML;
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        
        return {
            html: html,
            css: '', 
            scrollInfo: {
                scrollTop: scrollContainer.scrollTop,
                scrollHeight: scrollContainer.scrollHeight,
                clientHeight: scrollContainer.clientHeight
            }
        };
    })()`;

    for (const cdp of cdpList) {
        // Fallback to undefined (default context) if no contexts discovered
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: CAPTURE_SCRIPT, returnByValue: true };
                if (ctxId !== undefined) params.contextId = ctxId;

                const result = await cdp.call("Runtime.evaluate", params);
                if (result.result?.value) {
                    if (!result.result.value.error) {
                        const val = result.result.value;
                        val.hash = simpleHash(val.html + (val.scrollInfo?.scrollTop || 0));
                        val.targetTitle = cdp.title;
                        return val;
                    }
                }
            } catch (e) { }
        }
    }
    return null;
}

export async function injectMessage(cdpList, text, force = false) {
    const safeText = JSON.stringify(text);
    const EXPRESSION = `(async () => {
        const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
        const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
        const busyEl = cancel || stopBtn;
        
        if (!${force} && busyEl && busyEl.offsetParent !== null && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

        const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
        const editor = editors.at(-1);
        if (!editor) return { ok: false, error: "editor_not_found" };

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);
        try { document.execCommand?.("insertText", false, ${safeText}); } catch {
            editor.textContent = ${safeText};
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${safeText} }));
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.button'));
        const isActuallySend = (b) => {
            const label = (b.innerText + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || '')).toLowerCase();
            if (label.includes('continue') || label.includes('繼續') || label.includes('stop') || label.includes('停止')) return false;
            return label.includes('send') || label.includes('submit') || label.includes('發送') || b.querySelector('svg.lucide-arrow-right, .lucide-send');
        };
        
        const submit = allButtons.find(isActuallySend);
        
        if (submit && submit.offsetParent !== null) {
             setTimeout(() => submit.click(), 50);
             return { ok: true, method: "click_verified_send" };
        } else {
             editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
             return { ok: true, method: "enter_safe_fallback" };
        }
    })()`;

    for (const cdp of cdpList) {
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                if (res.result?.value?.ok || res.result?.value?.reason === 'busy') return res.result.value;
            } catch (e) { }
        }
    }
    return { ok: false, error: "no_editor_found" };
}

export async function getAppState(cdpList) {
    const EXP = `(async () => {
        try {
            const state = { mode: 'Unknown', model: 'Unknown' };
            const allEls = Array.from(document.querySelectorAll('*'));
            for (const el of allEls) {
                if (el.innerText === 'Fast' || el.innerText === 'Planning') { state.mode = el.innerText; break; }
            }
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            const modelEl = textNodes.find(el => {
                return ["Gemini", "Claude", "GPT", "Grok", "o1", "Sonnet", "Opus"].some(k => el.innerText.includes(k)) && 
                       (el.closest('button') || el.closest('[class*="statusbar"]'));
            });
            if (modelEl) state.model = modelEl.innerText.trim();
            return state;
        } catch(e) { return { error: e.toString() }; }
    })()`;
    for (const cdp of cdpList) {
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: EXP, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                if (res.result?.value && !res.result.value.error && res.result.value.mode !== 'Unknown') return res.result.value;
            } catch (e) { }
        }
    }
    return { mode: 'Unknown', model: 'Unknown' };
}

export async function setMode(cdpList, mode) {
    const EXP = `(async () => {
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });
            let modeBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    if (window.getComputedStyle(current).cursor === 'pointer' || current.tagName === 'BUTTON') {
                        modeBtn = current; break;
                    }
                    current = current.parentElement;
                }
                if (modeBtn) break;
            }
            if (!modeBtn) return { error: 'Mode button not found' };
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div')).find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            if (!visibleDialog) return { error: 'Dropdown not opened' };
            const target = Array.from(visibleDialog.querySelectorAll('*')).find(el => el.textContent.trim() === '${mode}');
            if (target) { target.click(); return { success: true }; }
            return { error: 'Option not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value?.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}

export async function setModel(cdpList, modelName) {
    const safeModel = modelName.replace(/'/g, "\\'");
    const EXP = `(async () => {
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => ["Gemini", "Claude", "GPT", "Model"].some(k => el.textContent.includes(k)));
            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                        if (current.querySelector('svg.lucide-chevron-up') || current.innerText.includes('Model')) { modelBtn = current; break; }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }
            if (!modelBtn) return { error: 'Model selector not found' };
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div')).find(d => d.offsetHeight > 0 && d.innerText.includes('${safeModel}'));
            if (!visibleDialog) return { error: 'Model list not opened' };
            const target = Array.from(visibleDialog.querySelectorAll('*')).find(el => el.textContent.includes('${safeModel}'));
            if (target) { target.click(); return { success: true }; }
            return { error: 'Model option not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value?.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}

export async function injectScroll(cdpList, scrollTop) {
    const SCROLL_SCRIPT = `(() => {
        const cascade = document.getElementById('cascade');
        if (!cascade) return false;
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        scrollContainer.scrollTop = ${scrollTop};
        return true;
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: SCROLL_SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value === true) return true;
            } catch (e) { }
        }
    }
    return false;
}
