import { simpleHash } from './utils.js';

export async function captureSnapshot(cdpList) {
    const CAPTURE_SCRIPT = `(() => {
        try {
            const startTime = Date.now();
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
            
            // 2. Capture CSS (Optimized V4.2)
            const rules = [];
            const skipPrefixes = ['.monaco-', '.codicon-', '.mtk', '.monaco-editor', '.margin-view-overlays', '.decorations-overview-ruler', '.minimap'];
            try {
                for (const sheet of document.styleSheets) {
                    try {
                        // Skip entire sheets if they are obviously IDE-internal (e.g. Monaco/Codicon)
                        if (sheet.href && (sheet.href.includes('monaco') || sheet.href.includes('codicon'))) continue;
                        
                        for (const rule of sheet.cssRules) {
                            // Skip huge blocks of IDE rules
                            const selector = rule.selectorText || '';
                            if (skipPrefixes.some(p => selector.includes(p))) continue;
                            if (rule.cssText.includes('@font-face')) continue; // Font face rules are huge and unused
                            
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
                    // 1. Clean attributes (Huge size saver)
                    const attrsToRemove = [];
                    for (let i = 0; i < el.attributes.length; i++) {
                        const attr = el.attributes[i];
                        if (attr.name.startsWith('data-') && !attr.name.includes('scroll')) {
                             attrsToRemove.push(attr.name);
                        }
                    }
                    attrsToRemove.forEach(a => el.removeAttribute(a));

                    // 3. Text based noise cleanup
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
                
                const brainRegex = /[a-z]:[^"'> ]+?\\.gemini[\\\\\\/]+antigravity[\\\\\\/]+brain[\\\\\\/]+/gi;
                out = out.replace(brainRegex, '/brain/');

                // Map Antigravity resources to virtual endpoint
                const resourceRegex = /(?:[a-zA-Z0-9+.-]+:\\/\\/[^"'>\\s]*?(?=[a-zA-Z](:|%3A)))?(?:\\/+)?([a-zA-Z](:|%3A)(?:[\\\\\\/]|%2F|%5C|%20|\\s)+Program(?:[\\\\\\/]|%2F|%5C|%20|\\s)+Files)/gi;
                out = out.replace(resourceRegex, '/vscode-resources');
                out = out.replace(/\\/\\/vscode-resources/gi, '/vscode-resources');

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
        const val = attr.value;
        const isBad = badSchemes.some(s => val.includes(s)) ||
            val.includes('antigravity') ||
            val.includes('Program Files') ||
            val.includes('Program%20Files');

        if (isBad) {
            el.setAttribute(attr.name, cleanText(val));
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
    duration: Date.now() - startTime,
    title: document.title,
    url: window.location.href
};
        } catch (e) { return { error: e.toString() }; }
    }) ()`;

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
                    console.error(`[DEBUG - SNAP] Exception in Port ${cdp.port} ctx ${ctx.id}: `, JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text));
                }

                if (res.result?.value) {
                    const val = res.result.value;
                    if (val.error) {
                        console.log(`[DEBUG - SNAP] Error in ctx ${ctx.id}: ${val.error} `);
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
                        url: val.url,
                        duration: val.duration // Add duration from the script's result
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
    const { scrollTop, scrollPercent } = ${JSON.stringify(options)
        };

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
    }) ()`;

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

// 1. Idempotency Check & Clear
const injectId = "inj_" + Date.now();
if (editor.getAttribute('data-last-inject') === ${safeText} && Date.now() - parseInt(editor.getAttribute('data-last-inject-time') || '0') < 1000) {
    return { ok: true, method: "idempotent_skip" };
}
editor.setAttribute('data-last-inject', ${safeText});
editor.setAttribute('data-last-inject-time', Date.now().toString());

editor.focus();
// Most robust clear for Lexical
try {
    const sel = window.getSelection();
    sel.selectAllChildren(editor);
    document.execCommand("delete", false, null);
} catch (e) {}

if (editor.textContent.length > 0) {
    editor.innerHTML = '<p dir="ltr"><br></p>'; // Force Lexical empty state
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

// 2. Insert Content
try { 
    document.execCommand("insertText", false, ${safeText}); 
} catch (e) {
    editor.textContent = ${safeText};
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${safeText} }));
}

// Optimization: Brief wait for Lexical to sync DOM
await new Promise(r => setTimeout(r, 60));

// 3. Find and Trigger Send
const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.button, [title*="Send"], [aria-label*="Send"]'));
const isActuallySend = (b) => {
    const label = (b.innerText + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + (b.className || '')).toLowerCase();
    if (label.includes('continue') || label.includes('繼續') || label.includes('stop') || label.includes('停止') || label.includes('cancel')) return false;
    return label.includes('send') || label.includes('submit') || label.includes('發送') || label.includes('送出') || 
           b.querySelector('svg.lucide-arrow-right, .lucide-send, svg[class*="send"]');
};

const submit = allButtons.find(isActuallySend);

if (submit && submit.offsetParent !== null) {
    submit.click();
    // Optimistic return
    return { ok: true, method: "click_send" };
} else {
    // Enter key fallback
    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
    return { ok: true, method: "enter_fallback" };
}
    }) ()`;

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
        } catch (e) { }

        // 2. Prepare Blob & DataTransfer
        const parts = "${base64Data}".split(',');
        const byteString = atob(parts[parts.length - 1]);
        const mimeString = parts[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: mimeString });
        const file = new File([blob], "upload.png", { type: mimeString });

        const dt = new DataTransfer();
        dt.items.add(file);
        // Critical for some apps: ensure files property is populated
        try {
            Object.defineProperty(dt, 'files', { value: [file], writable: false });
        } catch (e) { log('Could not define dt.files: ' + e.message); }

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
} catch (e) { }

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
    } catch (e) { log('Manual insertion failed: ' + e.message); }
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
            }) ()`;

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
        const state = { mode: 'Unknown', model: 'Unknown', usage: '', title: '' };
        
        // 抓取工作區名稱 (e.g., "yian-v1 - Antigravity" -> "yian-v1")
        let docTitle = document.title || "";
        let rawTitle = docTitle.split(' - ')[0].trim();
        state.title = rawTitle.length > 18 ? rawTitle.substring(0, 15) + '...' : rawTitle;

        const allEls = Array.from(document.querySelectorAll('*'));
        for (const el of allEls) {
            if (el.innerText === 'Fast' || el.innerText === 'Planning') { state.mode = el.innerText; break; }
        }
        const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText && el.innerText.length < 80);

        // 1. 抓取用量資訊 (包含 | 或 %)
        const usageNode = textNodes.find(el => (el.innerText.includes('|') || el.innerText.includes('%')) && (el.closest('[class*="statusbar"]') || el.closest('[class*="status-bar"]')));
        if (usageNode) state.usage = usageNode.innerText.trim();

        // 2. 抓取潛在型號標籤 (過濾掉用量與雜訊)
        const candidates = textNodes.filter(el => {
            const t = el.innerText.trim();
            // 基本型號關鍵字
            const hasModel = ["Gemini", "Claude", "GPT", "Grok", "o1", "Sonnet", "Opus"].some(k => t.includes(k));
            if (!hasModel) return false;
            
            // 過濾用量資訊
            if (t.includes('|') || t.includes('%')) return false;
            
            // --- 強化過濾器：過濾掉看起來像標題或對話內容的長句子 ---
            // 正常型號名稱通常不會超過 35 個字
            if (t.length > 35) return false;
            // 過濾掉包含常見「非型號」動詞或雜訊詞的文本
            const noiseWords = ["Clarifying", "version", "chat", "history", "message", "how to", "what is", "about"];
            if (noiseWords.some(w => t.toLowerCase().includes(w))) return false;
            
            return true;
        });

        const bestMatch = candidates.find(el => el.closest('button') && (el.innerText.includes('Gemini') || el.innerText.includes('Claude') || el.innerText.includes('GPT'))) ||
            candidates.find(el => el.closest('button')) ||
            candidates.find(el => el.className.includes('opacity-70') || el.className.includes('ellipsis')) ||
            candidates[0];

        if (bestMatch) state.model = bestMatch.innerText.trim();
        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;
    for (const cdp of cdpList) {
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: EXP, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                const val = res.result?.value;
                if (val && !val.error && (val.mode !== 'Unknown' || val.model !== 'Unknown')) return val;
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

        // 1. 偵測選單是否已經開啟 (檢查畫面上是否有包含目標文字的選項)
        const isMenuOpen = () => {
            const dialog = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], div'))
                .find(d => d.offsetHeight > 0 && d.innerText.includes('${safeModel}'));
            return !!dialog;
        };

        if (!isMenuOpen()) {
            // 2. 尋找模型選擇按鈕 (增加「代碼過濾器」防止點到專案原始碼)
            const candidates = allEls.filter(el => {
                const t = el.textContent || '';
                // 排除明顯是代碼的內容、排除過長的文本、排除 IDE 本身的標籤
                if (t.includes('export async function') || t.includes('allEls.filter') || t.length > 150) return false;
                return ["Gemini", "Claude", "GPT", "Model", "Sonnet", "Opus"].some(k => t.includes(k));
            });

            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    const isBtn = current.tagName === 'BUTTON' || style.cursor === 'pointer';
                    // 額外保險：排除 class 包含編輯器特徵的標籤
                    const isEditor = current.className && typeof current.className === 'string' &&
                        (current.className.includes('monaco') || current.className.includes('editor'));

                    if (isBtn && !isEditor) {
                        if (current.querySelector('svg') || current.innerText.includes('Model')) {
                            modelBtn = current; break;
                        }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }

            if (!modelBtn) return { error: 'Model selector not found' };

            // 3. 打開選單
            modelBtn.click();
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. 定位選單並選擇目標
        const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], div'))
            .find(d => d.offsetHeight > 0 && d.innerText.includes('${safeModel}'));
        if (!visibleDialog) return { error: 'Model list not found or not opened' };

        const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));

        // --- 回歸穩定點擊邏輯 ---
        let target = null;
        const isThinking = '${safeModel}'.includes('(Thinking)');
        const baseName = '${safeModel}'.replace('(Thinking)', '').trim();

        // Step A: 精確文本匹配
        target = allDialogEls.find(el => (el.innerText || "").trim() === '${safeModel}' && el.offsetHeight > 0);

        // Step B: 關鍵字+Thinking狀態匹配
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
            // 1. 尋找最具互動性的容器 (如 VS Code 的 monaco-list-row)
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

            // 2. 模擬完整互動序列
            target.scrollIntoView({ block: 'center', inline: 'center' });
            if (target.focus) target.focus();
            await new Promise(r => setTimeout(r, 100));

            const rect = target.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

            // A. 滑鼠序列
            target.dispatchEvent(new MouseEvent('mousedown', opts));
            await new Promise(r => setTimeout(r, 50));
            target.dispatchEvent(new MouseEvent('mouseup', opts));
            target.click();
            target.dispatchEvent(new MouseEvent('click', opts));

            // B. 鍵盤序列 (備援，這在 VS Code 菜單中非常有效)
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));

            // C. 強制關閉選單 (解決選單殘留問題)
            await new Promise(r => setTimeout(r, 200));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            document.body.click();

            return {
                success: true,
                selected: '${safeModel}',
                clickedTag: target.tagName,
                clickedClass: target.className.substring(0, 50),
                rect: { x, y }
            };
        }
        return { error: 'Model option not found in list', debug: { keywords, isThinking, matchesCount: matches.length } };
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
    const debug = { steps: [] };
    try {
        // 1. Find the model selector button
        const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model", "Sonnet", "Opus"];
        const allEls = Array.from(document.querySelectorAll('*'));

        const candidates = allEls.filter(el => {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.includes('export async function') || t.length > 100 || t.length < 2) return false;
            return KNOWN_KEYWORDS.some(k => t.includes(k)) && el.offsetHeight > 0;
        });
        debug.steps.push({ name: 'find_candidates', count: candidates.length });

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

        if (!modelBtn) return { error: 'Model selector button not found', debug };
        debug.steps.push({ name: 'click_button', text: modelBtn.innerText.substring(0, 30) });

        // 2. Click to open
        modelBtn.click();
        await new Promise(r => setTimeout(r, 1000));

        // 3. Find the dialog
        const dialogSelectors = '[role="dialog"], [role="listbox"], .monaco-menu-container, [class*="menu"], [class*="dropdown"]';
        const dialogs = Array.from(document.querySelectorAll(dialogSelectors))
            .filter(d => d.offsetHeight > 0 && d !== modelBtn && !d.contains(modelBtn));

        debug.steps.push({ name: 'find_dialogs', count: dialogs.length });

        const visibleDialog = dialogs.find(d => {
            const txt = d.innerText || '';
            return (txt.includes('Claude') || txt.includes('Gemini') || txt.includes('GPT'));
        }) || dialogs[0];

        if (!visibleDialog) return { error: 'Model list dialog not found', debug, htmlSnippet: document.body.innerHTML.substring(0, 500) };

        // 4. Extract all valid options
        let rawOptions = Array.from(visibleDialog.querySelectorAll('*'))
            .filter(el => {
                const text = (el.innerText || "").trim();
                if (!text || text.length < 3 || text.length > 80) return false;

                const style = window.getComputedStyle(el);
                const isClickable = el.tagName === 'BUTTON' ||
                    style.cursor === 'pointer' ||
                    el.getAttribute('role') === 'option' ||
                    el.className.includes('menu-item');

                const noise = ["Search", "Model", "Close", "Back", "×", "✓", "New", "NEW"];
                if (noise.some(n => text === n)) return false;

                return isClickable && el.offsetHeight > 0;
            })
            .map(el => {
                // Clone to remove children that might be badges
                const clone = el.cloneNode(true);
                Array.from(clone.children).forEach(child => {
                    const ct = child.innerText.trim().toUpperCase();
                    if (ct === 'NEW' || ct === 'NEW!' || child.classList.contains('badge')) child.remove();
                });
                let t = clone.innerText.trim();
                // Final cleanup of remaining "New" text and newlines
                t = t.replace(/\\n/g, ' ').replace(/\\s*New$/i, '').trim();
                return t;
            })
            .filter(v => v.length > 3);

        // Deduplicate: If one is a substring of another, keep the longer one
        rawOptions.sort((a, b) => b.length - a.length);
        const options = [];
        for (const opt of rawOptions) {
            if (!options.some(existing => existing.includes(opt) || opt.includes(existing))) {
                options.push(opt);
            } else if (options.some(existing => existing.includes(opt))) {
                // Skip, already have a more complete name
            } else {
                // Current one is better (longer/more specific coverage) - shouldn't happen due to sort
            }
        }
        // Final deduplicate for exact matches
        const finalOptions = options.filter((v, i, a) => a.indexOf(v) === i);

        debug.steps.push({ name: 'extract_options', count: options.length });

        // 5. Close the menu
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        setTimeout(() => document.body.click(), 100);

        return { models: finalOptions, debug };
    } catch (err) {
        return { error: err.toString(), debug };
    }
})()`;


    for (const cdp of cdpList) {
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: EXP, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);

                if (res.exceptionDetails) {
                    console.error(`❌[discoverModels] JS Execution Error in Port ${cdp.port}: `, res.exceptionDetails.exception?.description || res.exceptionDetails.text);
                    continue;
                }

                if (res.result?.value?.models) return res.result.value;
                if (res.result?.value?.error) {
                    console.warn(`⚠️[discoverModels] Logic Error on Port ${cdp.port}: `, res.result.value.error);
                }
            } catch (e) {
                console.error(`❌[discoverModels] CDP Communication Error: `, e.message);
            }
        }
    }
    return { error: 'Model discovery failed' };
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
    } catch (err) {
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
        const skipWords = ['new chat', 'settings', 'home', 'account', 'upgrade', 'help', 'log in', 'sign up', 'clear all'];
        const historyList = document.querySelector('[class*="history-list"], [class*="ConversationList"]');
        
        if (!historyList) {
            const sidebar = document.querySelector('nav, [class*="sidebar"]');
            if (!sidebar) return { error: 'History container not found' };

            const possibleItems = Array.from(sidebar.querySelectorAll('a, button, [role="link"]'))
                .filter(el => {
                    const text = el.innerText.trim().toLowerCase();
                    return el.offsetParent !== null && 
                           text.length > 8 && 
                           text.length < 100 && 
                           !skipWords.some(w => text.includes(w)) &&
                           !el.closest('[aria-hidden="true"]');
                });

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
            })
            .filter(item => !skipWords.some(w => item.title.toLowerCase().includes(w)));

        return { success: true, items };
    } catch (err) {
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
        } catch (err) {
    return { error: err.toString() };
}
    }) ()`;

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
