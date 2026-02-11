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
            '[role="button"]', '[role="menu"]', '[role="dialog"]', '[role="tooltip"]',
            '[class*="toolbar"]', '[class*="footer"]', '[class*="header"]',
            '[class*="actions"]', '[class*="status"]', '[class*="menu"]',
            '[class*="icon"]', '.lucide', 'i', 'span[class*="icon"]',
            '[class*="model-selector"]', '[class*="prompt"]', '[class*="input"]',
            '[id^="headlessui-"]', '.splash', '.decor', '[class*="hover-"]',
            '[class*="overlay"]'
        ];
        killList.forEach(sel => {
            clone.querySelectorAll(sel).forEach(el => el.remove());
        });

        // 2. Text-Based Removal: IDE Meta Info
        const garbageKeywords = [
            'files with changes', 'review changes', 'select file', '選擇檔案', 
            'fast', 'claude', 'gemini', 'gpt-oss', 'ask anything', 'ctrl+l',
            'exit code 0', 'checked command status', 'good', 'bad'
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
                if (el.style.height && el.style.height.includes('px')) el.style.height = 'auto';
                if (el.style.minHeight && el.style.minHeight.includes('px')) el.style.minHeight = '0';
                el.style.paddingBottom = '0';
                el.style.width = '100%';
                el.style.maxWidth = 'none';
                el.style.overflowX = 'hidden';
                if (window.getComputedStyle(el).position === 'fixed') el.style.position = 'relative';
            }
            Array.from(el.children).forEach(cleanupStyles);
        };
        
        cleanupStyles(clone);

        clone.style.padding = '0';
        clone.style.margin = '0';
        clone.style.height = 'auto';
        clone.style.minHeight = '0';
        clone.style.width = '100%';
        clone.style.maxWidth = 'none';
        clone.style.overflowX = 'hidden';

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

export async function injectImage(cdpList, base64Data, text = null) {
    const safeText = JSON.stringify(text || "");
    const results = [];

    for (const cdp of cdpList) {
        // VS Code and similar Electron apps have multiple contexts per page
        const cdpContexts = cdp.contexts.length > 0 ? cdp.contexts : [{ id: undefined }];

        for (const ctx of cdpContexts) {
            const EXPRESSION = `(async () => {
                const logs = [];
                function log(msg) { logs.push(msg); }

                try {
                    // 1. Locate Target
                    let editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
                    let target = editors.at(-1);

                    if (!target) {
                        let candidates = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'))
                            .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
                        candidates.sort((a, b) => {
                            const aLex = a.hasAttribute('data-lexical-editor') ? 1 : 0;
                            const bLex = b.hasAttribute('data-lexical-editor') ? 1 : 0;
                            if (aLex !== bLex) return bLex - aLex;
                            return (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight);
                        });
                        target = candidates[0];
                    }

                    if (!target) return { ok: false, error: "no_editor_in_context", logs: logs };

                    log('Target: ' + target.tagName + ' cls: ' + target.className.substring(0, 50));
                    
                    target.focus();
                    try { 
                        const rect = target.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
                        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
                        target.click(); 
                    } catch(e) {}

                    // 2. Prepare Blob & DataTransfer
                    const parts = "${base64Data}".split(',');
                    const byteString = atob(parts[ parts.length - 1 ]);
                    const mimeString = parts[0].split(':')[1].split(';')[0];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                    const blob = new Blob([ab], {type: mimeString});
                    const file = new File([blob], "upload.png", { type: mimeString });
                    
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    // Critical for some apps: ensure files property is populated
                    try {
                        Object.defineProperty(dt, 'files', { value: [file], writable: false });
                    } catch(e) { log('Could not define dt.files: ' + e.message); }

                    if (${!!text}) dt.setData('text/plain', ${safeText});
                    
                    // 3. Injection Sequence
                    const getStatus = () => ({
                        imgs: document.querySelectorAll('img').length,
                        chips: document.querySelectorAll('[class*="chip"], [class*="Image"], [class*="image"]').length,
                        children: target.children.length
                    });
                    const before = getStatus();
                    
                    log('Dispatching Paste...');
                    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
                    
                    try {
                        target.dispatchEvent(new InputEvent('beforeinput', {
                            dataTransfer: dt, inputType: 'insertFromPaste', bubbles: true, cancelable: true, composed: true
                        }));
                    } catch(e) {}

                    await new Promise(r => setTimeout(r, 600));
                    
                    if (getStatus().children <= before.children && getStatus().imgs <= before.imgs) {
                        log('Paste failed, trying Drop...');
                        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
                        await new Promise(r => setTimeout(r, 600));
                    }

                    // Strategy F: Direct DOM insertion (Bypasses TrustedHTML for simple elements)
                    if (getStatus().children <= before.children && getStatus().imgs <= before.imgs) {
                        log('Events failed, attempting manual insertion...');
                        try {
                            const img = document.createElement('img');
                            img.src = "${base64Data}";
                            img.style.maxWidth = '100px';
                            img.setAttribute('data-injected', 'true');
                            
                            const selection = window.getSelection();
                            if (selection.rangeCount > 0) {
                                const range = selection.getRangeAt(0);
                                range.deleteContents();
                                range.insertNode(img);
                                log('Inserted via Range API');
                            } else {
                                target.appendChild(img);
                                log('Appended to target');
                            }
                        } catch(e) { log('Manual insertion failed: ' + e.message); }
                    }

                    const after = getStatus();
                    log('Status change - Imgs: ' + (after.imgs - before.imgs) + ', Children: ' + (after.children - before.children));

                    // 4. Send Button Logic
                    log('Waiting for processing...');
                    await new Promise(r => setTimeout(r, 2000)); 
                    
                    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.button, [title*="Send"], [aria-label*="Send"], [id*="send"], [data-testid*="send"]'));
                    const findSend = (b) => {
                        const txt = (b.innerText || b.getAttribute('aria-label') || b.title || b.id || b.getAttribute('data-testid') || '').toLowerCase();
                        if (/continue|繼續|stop|停止/i.test(txt)) return false;
                        if (/send|submit|發送|送出|tweet/i.test(txt)) return true;
                        // Icon detection
                        return b.querySelector('svg.lucide-arrow-right, svg.lucide-arrow-up, svg.lucide-send, .lucide-send, svg[class*="send"], svg.lucide-zap');
                    };
                    
                    const btn = buttons.find(findSend);
                    if (btn && btn.offsetParent !== null) {
                        btn.click();
                        log('Clicked: ' + (btn.innerText || btn.getAttribute('aria-label') || btn.tagName));
                        return { ok: true, method: "click", logs: logs };
                    } else {
                        log('Enter fallback');
                        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
                        return { ok: true, method: "enter", logs: logs };
                    }

                } catch (e) {
                    return { ok: false, error: e.toString(), logs: logs };
                }
            })()`;

            try {
                const evalParams = { expression: EXPRESSION, returnByValue: true, awaitPromise: true };
                if (ctx.id !== undefined) evalParams.contextId = ctx.id;

                const res = await cdp.call("Runtime.evaluate", evalParams);
                const val = res.result.value;
                if (val && (val.ok || val.error !== "no_editor_in_context")) {
                    return val; // Found a valid editor or hit a real error, stop here
                }
                if (val) results.push(val);
            } catch (e) {
                // Context might be gone
            }
        }
    }

    return { ok: false, error: "no_editor_found_all_contexts", results: results };
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
            // 4. Select specific model
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            
            // Priority 1: Exact/Partial Match
            let target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.includes('${safeModel}')
            );
            
            // Priority 2: Fuzzy Match (ignore text in parentheses, e.g. "Gemini 3 Pro (High)" -> "Gemini 3 Pro")
            if (!target) {
                const simpleName = '${safeModel}'.split('(')[0].trim();
                if (simpleName.length > 2) {
                    target = allDialogEls.find(el => 
                        el.children.length === 0 && el.textContent.includes(simpleName)
                    );
                }
            }

            if (target) {
                // Smart Click: Traverse up to find the clickable container
                let clickable = target;
                for (let i = 0; i < 4; i++) {
                    if (!clickable || clickable === visibleDialog) break;
                    const style = window.getComputedStyle(clickable);
                    if (clickable.tagName === 'BUTTON' || style.cursor === 'pointer' || clickable.getAttribute('role') === 'option') {
                        break;
                    }
                    clickable = clickable.parentElement;
                }
                const finalTarget = clickable || target;

                // Simulated full interaction chain
                const opts = { bubbles: true, cancelable: true, view: window };
                finalTarget.dispatchEvent(new MouseEvent('mousedown', opts));
                finalTarget.dispatchEvent(new MouseEvent('mouseup', opts));
                finalTarget.click();
                
                return { success: true };
            }
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
