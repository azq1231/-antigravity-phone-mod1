export async function getAppState(cdpList) {
    let bestState = { mode: 'Unknown', model: 'Unknown', usage: '', title: '' };
    
    // 優先選取包含 [WSL] 或具有專案特徵的 Workbench
    const targetCdp = cdpList.find(c => c.title && c.title.includes(' [WSL:')) || 
                      cdpList.find(c => c.title && !/Launchpad|Monitor|server|package|json|Extension|Terminal/i.test(c.title)) || 
                      cdpList[0];

    if (!targetCdp) return bestState;
    
    let rawTitle = targetCdp.title || "";
    bestState.title = rawTitle.split(' - ')[0].replace(/ \[WSL:.*\]/, "").trim();

    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown', usage: '' };
        const isForbidden = (el) => el.closest('.monaco-editor, .view-lines, .terminal-container, .notifications-toasts');

        const statusItems = Array.from(document.querySelectorAll('.statusbar-item'));
        for (const item of statusItems) {
            if (isForbidden(item)) continue;
            const t = (item.innerText || "").trim();
            const aria = (item.getAttribute('aria-label') || "").trim();
            const combined = (t + " " + aria).toLowerCase();

            if (state.mode === 'Unknown') {
                if (t === 'Fast' || t === 'Planning') state.mode = t;
                else if (aria.includes('Speed: Fast') || t === '⚡ ON') state.mode = 'Fast';
                else if (aria.includes('Speed: Planning')) state.mode = 'Planning';
            }

            if (state.model === 'Unknown') {
                if (combined.includes('gemini')) state.model = t.includes('Gemini') ? t : 'Gemini 3 Flash';
                else if (combined.includes('claude')) state.model = t.includes('Claude') ? t : 'Claude Sonnet 4.6 (Thinking)';
                else if (combined.includes('gpt')) state.model = t.includes('GPT') ? t : 'GPT-OSS 120B (Medium)';
            }

            if (state.usage === '' && !combined.includes('rocket') && !combined.includes('gitlens')) {
                const hasModel = combined.includes('gemini') || combined.includes('claude') || combined.includes('gpt') || combined.includes('sonnet') || combined.includes('pro') || combined.includes('flash');
                const hasPercent = combined.includes('%');
                if (hasPercent && (hasModel || combined.includes('|') || combined.includes(':'))) {
                    state.usage = aria || t;
                }
            }
        }

        if (state.mode === 'Unknown') {
            const toolbar = document.querySelector('.flex.items-center.gap-0-5, [class*="items-center"][class*="gap-0.5"]');
            if (toolbar) {
                const txt = toolbar.innerText || "";
                if (txt.includes('Planning')) state.mode = 'Planning';
                else if (txt.includes('Fast')) state.mode = 'Fast';
            }
        }

        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;

    const ctxId = (targetCdp.contexts && targetCdp.contexts.length > 0) ? targetCdp.contexts[0].id : undefined;
    try {
        const params = { expression: EXP, returnByValue: true, awaitPromise: true };
        if (ctxId !== undefined) params.contextId = ctxId;
        const res = await targetCdp.call("Runtime.evaluate", params);
        const val = res.result?.value;
        if (val && !val.error) {
            if (val.mode !== 'Unknown') bestState.mode = val.mode;
            if (val.model !== 'Unknown') bestState.model = val.model;
            if (val.usage) bestState.usage = val.usage;
        }
    } catch (e) { }

    return bestState;
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
    } catch (err) { return { error: err.toString() }; }
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

        const isMenuOpen = () => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], div'))
                .find(d => d.offsetHeight > 0 && d.innerText.includes('${safeModel}'));
            return !!dialog;
        };

        if (!isMenuOpen()) {
            const candidates = allEls.filter(el => {
                const t = el.textContent || '';
                if (t.includes('export async function') || t.length > 150) return false;
                return ["Gemini", "Claude", "GPT", "Model", "Sonnet", "Opus"].some(k => t.includes(k));
            });

            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    const isBtn = current.tagName === 'BUTTON' || style.cursor === 'pointer' || current.getAttribute('role') === 'button';
                    const isEditor = current.className && typeof current.className === 'string' &&
                        (current.className.includes('monaco') || current.className.includes('editor'));

                    if (isBtn && !isEditor) {
                        if (current.querySelector('svg') || current.innerText.includes('Model') || /V\\d+\\.\\d+/.test(current.innerText)) {
                            modelBtn = current; break;
                        }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }

            if (!modelBtn) return { error: 'Model selector not found' };
            modelBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }

        const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], div'))
            .find(d => d.offsetHeight > 0 && d.innerText.includes('${safeModel}'));
        if (!visibleDialog) return { error: 'Model list not found or not opened' };

        const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));

        let target = null;
        const isThinking = '${safeModel}'.includes('(Thinking)');
        const baseName = '${safeModel}'.replace('(Thinking)', '').trim();

        target = allDialogEls.find(el => (el.innerText || "").trim() === '${safeModel}' && el.offsetHeight > 0);

        if (!target) {
            const keywords = baseName.split(' ').filter(k => k.length >= 2);
            const matches = allDialogEls.filter(el => {
                const t = (el.innerText || el.textContent || '').trim();
                const hasKeywords = keywords.every(k => t.includes(k));
                const thinkingMatch = isThinking ? t.includes('Thinking') : !t.includes('Thinking');
                return el.offsetHeight > 0 && hasKeywords && thinkingMatch;
            });
            if (matches.length > 0) {
                target = matches.sort((a, b) => a.textContent.length - b.textContent.length)[0];
            }
        }

        if (target) {
            let current = target;
            for (let i = 0; i < 5; i++) {
                if (!current || current === visibleDialog) break;
                if (current.getAttribute('role') === 'option' ||
                    current.classList.contains('monaco-list-row') ||
                    current.tagName === 'BUTTON' ||
                    current.className.includes('item-content')) {
                    target = current;
                    break;
                }
                current = current.parentElement;
            }

            target.scrollIntoView({ block: 'center', inline: 'center' });
            if (target.focus) target.focus();
            await new Promise(r => setTimeout(r, 100));

            const rect = target.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

            target.dispatchEvent(new MouseEvent('mousedown', opts));
            await new Promise(r => setTimeout(r, 50));
            target.dispatchEvent(new MouseEvent('mouseup', opts));
            target.click();
            target.dispatchEvent(new MouseEvent('click', opts));

            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 200));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            document.body.click();

            return { success: true, selected: '${safeModel}' };
        }
        return { error: 'Model option not found in list' };
    } catch (err) { return { error: err.toString() }; }
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

export async function discoverModels(cdpList) {
    const EXP = `(async () => {
    try {
        const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model", "Sonnet", "Opus"];
        const allEls = Array.from(document.querySelectorAll('*'));

        const candidates = allEls.filter(el => {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.includes('export async function') || t.length > 100 || t.length < 2) return false;
            return KNOWN_KEYWORDS.some(k => t.includes(k)) && el.offsetHeight > 0;
        });

        let modelBtn = null;
        for (const el of candidates) {
            let current = el;
            for (let i = 0; i < 6; i++) {
                if (!current) break;
                const style = window.getComputedStyle(current);
                const isInterative = current.tagName === 'BUTTON' || style.cursor === 'pointer' || current.getAttribute('role') === 'button';
                if (isInterative) {
                    if (current.querySelector('svg') || current.innerText.includes('Model') || /V\\d+\\.\\d+/.test(current.innerText)) {
                        modelBtn = current;
                        break;
                    }
                }
                current = current.parentElement;
            }
            if (modelBtn) break;
        }

        if (!modelBtn) return { error: 'Model selector button not found' };

        modelBtn.click();
        await new Promise(r => setTimeout(r, 1000));

        const dialogSelectors = '[role="dialog"], [role="listbox"], .monaco-menu-container, [class*="menu"], [class*="dropdown"]';
        const dialogs = Array.from(document.querySelectorAll(dialogSelectors))
            .filter(d => d.offsetHeight > 0 && d !== modelBtn && !d.contains(modelBtn));

        const visibleDialog = dialogs.find(d => {
            const txt = d.innerText || '';
            return (txt.includes('Claude') || txt.includes('Gemini') || txt.includes('GPT'));
        }) || dialogs[0];

        if (!visibleDialog) return { error: 'Model list dialog not found' };

        const options = Array.from(visibleDialog.querySelectorAll('*'))
            .filter(el => {
                const text = (el.innerText || "").trim();
                if (!text || text.length < 3 || text.length > 80) return false;
                const style = window.getComputedStyle(el);
                const isClickable = el.tagName === 'BUTTON' || style.cursor === 'pointer' || el.getAttribute('role') === 'option' || el.className.includes('menu-item');
                const noise = ["Search", "Model", "Close", "Back", "×", "✓", "New", "NEW"];
                if (noise.some(n => text === n)) return false;
                return isClickable && el.offsetHeight > 0;
            })
            .map(el => {
                const clone = el.cloneNode(true);
                Array.from(clone.children).forEach(child => {
                    if (child.innerText.trim().toUpperCase() === 'NEW' || child.classList.contains('badge')) child.remove();
                });
                return clone.innerText.trim().replace(/\\n/g, ' ').replace(/\\s*New$/i, '').trim();
            })
            .filter((v, i, a) => v.length > 3 && a.indexOf(v) === i);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        setTimeout(() => document.body.click(), 100);

        return { models: options };
    } catch (err) { return { error: err.toString() }; }
})()`;
    for (const cdp of cdpList) {
        for (const ctxId of (cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined])) {
            try {
                const params = { expression: EXP, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                if (res.result?.value?.models) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Model discovery failed' };
}

export async function startNewChat(cdpList) {
    const EXP = `(async () => {
    try {
        const isVisible = (el) => el && el.offsetHeight > 0;
        const btn = Array.from(document.querySelectorAll('[data-tooltip-id="new-conversation-tooltip"]')).find(isVisible) || 
                   Array.from(document.querySelectorAll('button')).find(b => isVisible(b) && (b.querySelector('svg.lucide-plus') || b.innerText.includes('New Chat')));
        if (btn) { btn.click(); return { success: true }; }
        return { error: 'Not found' };
    } catch (err) { return { error: err.toString() }; }
})()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value?.success) { await new Promise(r=>setTimeout(r,500)); return { success: true }; }
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}

export async function selectChat(cdpList, index) {
    const EXP = `(() => {
        const items = Array.from(document.querySelectorAll('[class*="history-item"]'));
        if (items[${index}]) { items[${index}].click(); return { success: true }; }
        return { error: 'Not found' };
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}

export async function getChatHistory(cdpList) { return { success: false, error: 'Disabled' }; }
