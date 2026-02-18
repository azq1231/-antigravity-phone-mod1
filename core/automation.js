import { simpleHash } from './utils.js';

export async function captureSnapshot(cdpList) {
    const CAPTURE_SCRIPT = `(() => {
        try {
            const body = document.body;
            if (!body) return { error: 'No body' };
            
            // 1. Try to find the best container (分層匹配)
            // 精確匹配：真正的 Chat/Conversation 容器
            const exactTarget = document.querySelector('#conversation') || 
                         document.querySelector('#chat') || 
                         document.querySelector('#cascade');
            // 寬泛匹配：一般性 main 容器 (workbench 也有 role="main")
            const looseTarget = document.querySelector('main') ||
                         document.querySelector('[role="main"]');
            
            const target = exactTarget || looseTarget;

            // 標記匹配品質：exact > loose > fallback
            const matchQuality = exactTarget ? 'exact' : (looseTarget ? 'loose' : 'fallback');

            // If we found a target, use it. Otherwise, use body but indicate it's a fallback
            const root = target || body;
            
            // 2. Capture CSS
            const rules = [];
            try {
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            rules.push(rule.cssText);
                        }
                    } catch (e) { }
                }
            } catch(e) {}
            const allCSS = rules.join('\\n');

            // 3. Calculate Scroll Info
            const scrollEl = root.querySelector('.overflow-y-auto, [data-scroll-area]') || root;
            const scrollInfo = {
                scrollTop: scrollEl.scrollTop || 0,
                scrollHeight: scrollEl.scrollHeight || 0,
                clientHeight: scrollEl.clientHeight || 0
            };

            // 4. Serialize & Clean HTML
            const isTruncated = !target;
            const clone = root.cloneNode(true);
            
            // A. Aggressively remove interaction/input areas
            const interactionSelectors = [
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '[class*="bg-gray-500"]',
                '[class*="outline-solid"]',
                '[contenteditable="true"]',
                '[placeholder*="Ask anything"]',
                '.monaco-inputbox',
                '.quick-input-widget'
            ];

            interactionSelectors.forEach(selector => {
                try {
                    clone.querySelectorAll(selector).forEach(el => {
                        try {
                            const isInputArea = el.querySelector('textarea, input, [contenteditable="true"]') || 
                                                el.getAttribute('placeholder')?.includes('Ask') ||
                                                el.innerText.includes('Ask anything');
                            
                            if (isInputArea || selector === '.monaco-inputbox' || selector === '.quick-input-widget') {
                                if (selector === '[contenteditable="true"]') {
                                    const area = el.closest('.relative.flex.flex-col.gap-8') || 
                                                 el.closest('.flex.grow.flex-col.justify-start.gap-8') ||
                                                 el.closest('div[id^="interaction"]') ||
                                                 el.parentElement?.parentElement;
                                    if (area && area !== clone) area.remove();
                                    else el.remove();
                                } else {
                                    el.remove();
                                }
                            }
                        } catch(e) {}
                    });
                } catch(e) {}
            });

            // B. Text-based cleanup for banners and status bars
            clone.querySelectorAll('*').forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('review changes') || text.includes('files with changes') || 
                        text.includes('context found') || text.includes('ask anything')) {
                        if (el.children.length < 15 || el.querySelector('button') || el.classList?.contains('justify-between')) {
                            el.remove();
                        }
                    }
                } catch (e) {}
            });

            // --- 5. Protocol Sanitization ---
            const badSchemes = ['vscode-file://', 'file://', 'app://', 'devtools://', 'vscode-webview-resource://'];
            const blankGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            
            const cleanText = (text) => {
                if (!text) return text;
                let out = text;
                
                const brainRegex = /[a-z]:[^"'>]+?\\\\.gemini[\\\\/]+antigravity[\\\\/]+brain[\\\\/]+/gi;
                out = out.replace(brainRegex, '/brain/');

                if (out.includes('/brain/')) {
                    const parts = out.split('/brain/');
                    out = parts[0] + parts.slice(1).map(part => {
                        const endIndices = ['"', "'", ' ', '>', ')', '\\n'].map(c => part.indexOf(c)).filter(i => i !== -1);
                        const endIdx = endIndices.length > 0 ? Math.min(...endIndices) : part.length;
                        const urlPart = part.substring(0, endIdx).replace(/\\\\/g, '/');
                        return urlPart + part.substring(endIdx);
                    }).join('/brain/');
                }
                
                if (out.includes('url(')) {
                    out = out.split('url(').map((part, i) => {
                        if (i === 0) return part;
                        const endIdx = part.indexOf(')');
                        const urlContent = part.substring(0, endIdx);
                        if (badSchemes.some(s => urlContent.includes(s))) {
                            return '"' + blankGif + '"' + part.substring(endIdx);
                        }
                        return part;
                    }).join('url(');
                }
                badSchemes.forEach(s => {
                    out = out.split(s).join('#');
                });
                return out;
            };

            clone.querySelectorAll('*').forEach(el => {
                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i];
                    if (badSchemes.some(s => attr.value.includes(s)) || attr.value.includes('antigravity/brain')) {
                        el.setAttribute(attr.name, cleanText(attr.value));
                    }
                }
                if (el.tagName === 'STYLE') el.textContent = cleanText(el.textContent);
            });

            const cleanCSS = cleanText(allCSS);
            let cleanHTML = cleanText(clone.outerHTML);

            return {
                html: isTruncated ? cleanHTML.substring(0, 10000) : cleanHTML, 
                css: cleanCSS,
                scrollInfo: scrollInfo,
                foundTarget: !!target,
                matchQuality: matchQuality,
                title: document.title,
                url: window.location.href
            };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const candidates = [];

    for (const cdp of cdpList) {
        let contexts = cdp.contexts || [];
        if (contexts.length === 0) contexts = [{ id: undefined }];

        for (const ctx of contexts) {
            try {
                const params = { expression: CAPTURE_SCRIPT, returnByValue: true };
                if (ctx.id !== undefined) params.contextId = ctx.id;

                const res = await cdp.call("Runtime.evaluate", params);
                if (res.exceptionDetails) {
                    console.error(`[DEBUG-SNAP] Exception in Port ${cdp.port} ctx ${ctx.id}:`, JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text));
                }

                if (res.result?.value) {
                    const val = res.result.value;
                    if (val.error) {
                        console.log(`[DEBUG-SNAP] Error in ctx ${ctx.id}: ${val.error}`);
                        continue;
                    }

                    candidates.push({
                        html: val.html,
                        css: val.css,
                        scrollInfo: val.scrollInfo,
                        hash: simpleHash(val.html),
                        targetTitle: cdp.title,
                        foundTarget: val.foundTarget,
                        matchQuality: val.matchQuality || 'fallback',
                        url: val.url
                    });
                }
            } catch (e) {
                // Console error only on catastrophic failure
            }
        }
    }

    if (candidates.length === 0) {
        return { error: 'no snapshot found', debug: { reason: 'Exhausted all contexts' } };
    }

    // Best selection logic (V4.2 - 精準匹配優先):
    // 匹配品質排序：exact(#conversation/#chat/#cascade) > loose(main/role=main) > fallback(body)
    // 同品質內，HTML 越長越好（內容越豐富）
    const qualityScore = { exact: 3, loose: 1, fallback: 0 };
    candidates.sort((a, b) => {
        const qa = qualityScore[a.matchQuality] || 0;
        const qb = qualityScore[b.matchQuality] || 0;
        if (qa !== qb) return qb - qa;
        return b.html.length - a.html.length;
    });

    return candidates[0];
}

export async function injectScroll(cdpList, options) {
    const SCRIPT = `(async () => {
        const { scrollTop, scrollPercent } = ${JSON.stringify(options)};
        
        // Helper: Find the best scroll container
        const findScrollContainer = () => {
             // 1. Try explicit scrollable areas first
             const candidates = document.querySelectorAll('.overflow-y-auto, [data-scroll-area]');
             for (const el of candidates) {
                 if (el.scrollHeight > el.clientHeight) return el;
             }
             
             // 2. Try the chat container itself
             const cascade = document.querySelector('#conversation') || document.querySelector('#chat') || document.querySelector('#cascade');
             if (cascade && cascade.scrollHeight > cascade.clientHeight) return cascade;
             
             // 3. Fallback to any scrollable div
             const divs = document.querySelectorAll('div');
             for (const div of divs) {
                 if (div.scrollHeight > div.clientHeight + 50) return div;
             }
             return document.documentElement;
        };

        const target = findScrollContainer();
        if (!target) return { success: false, error: 'No scroll target' };

        // Logic from original server.js: Prefer percentage if valid, else absolute
        if (typeof scrollPercent === 'number' && scrollPercent >= 0) {
            target.scrollTop = scrollPercent * (target.scrollHeight - target.clientHeight);
        } else if (typeof scrollTop === 'number') {
             target.scrollTop = scrollTop;
        }
        
        return { success: true, newScrollTop: target.scrollTop, scrollHeight: target.scrollHeight };
    })()`;

    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value?.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
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

export async function startNewChat(cdpList) {
    const EXP = `(async () => {
        try {
            const exactBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            if (exactBtn) {
                exactBtn.click();
                return { success: true, method: 'data-tooltip-id' };
            }

            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
            const plusButtons = allButtons.filter(btn => {
                if (btn.offsetParent === null) return false;
                return btn.querySelector('svg.lucide-plus') || 
                       btn.innerText.toLowerCase().includes('new chat') ||
                       btn.title?.toLowerCase().includes('new chat');
            });

            if (plusButtons.length > 0) {
                plusButtons[0].click();
                return { success: true, method: 'plus-search' };
            }

            return { error: 'New Chat button not found' };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
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

export async function getChatHistory(cdpList) {
    const EXP = `(async () => {
        try {
            const historyList = document.querySelector('[class*="history-list"], [class*="ConversationList"]');
            if (!historyList) {
                // Try searching for any sidebar-like container
                const sidebar = document.querySelector('nav, [class*="sidebar"]');
                if (!sidebar) return { error: 'History container not found' };
                
                const possibleItems = Array.from(sidebar.querySelectorAll('a, button, [role="link"]'))
                    .filter(el => el.innerText.length > 5 && el.innerText.length < 100);
                
                if (possibleItems.length > 0) {
                     return { success: true, items: possibleItems.map((el, i) => ({ id: i, title: el.innerText.trim(), active: false })) };
                }
                return { error: 'No history items found in sidebar' };
            }

            const items = Array.from(historyList.querySelectorAll('[class*="history-item"], [class*="ConversationListItem"]'))
                .filter(el => el.offsetParent !== null)
                .map((el, idx) => {
                    const titleEl = el.querySelector('[class*="title"], [class*="text-ellipsis"]');
                    return {
                        id: idx,
                        title: (titleEl ? titleEl.innerText : el.innerText).trim().substring(0, 100),
                        active: el.classList.contains('active') || !!el.querySelector('[class*="active"]')
                    };
                });

            return { success: true, items };
        } catch(err) {
            return { error: err.toString() };
        }
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

export async function selectChat(cdpList, index) {
    const EXP = `(async () => {
        try {
            const historyList = document.querySelector('[class*="history-list"], [class*="ConversationList"]');
            const sidebar = historyList || document.querySelector('nav, [class*="sidebar"]');
            if (!sidebar) return { error: 'History container not found' };

            const items = Array.from(sidebar.querySelectorAll('[class*="history-item"], [class*="ConversationListItem"], a, button, [role="link"]'))
                .filter(el => el.offsetParent !== null && el.innerText.length > 5);
            
            if (items[${index}]) {
                items[${index}].click();
                return { success: true };
            }
            return { error: 'Item not found at index ${index}' };
        } catch(err) {
            return { error: err.toString() };
        }
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
