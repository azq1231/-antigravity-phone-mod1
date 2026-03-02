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
            let cleaned = cleanText(val);
            if (el.tagName === 'IMG' && attr.name === 'src' && cleaned.includes('#')) {
                cleaned = blankGif;
            }
            el.setAttribute(attr.name, cleaned);
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
    const EXPRESSION_CHECK = `(async () => {
    const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
    const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
    const busyEl = cancel || stopBtn;
    if (!${force} && busyEl && busyEl.offsetParent !== null && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

    const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
    const editor = editors.at(-1);
    if (!editor) return { ok: false, error: "editor_not_found" };

    // Nuclear Clear Check
    editor.focus();
    try {
        editor.innerHTML = '<p dir="ltr"><br></p>'; 
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
    } catch(e) {}
    
    return { ok: true, ready: true };
})()`;

    for (const cdp of cdpList) {
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                // 1. JS 階段：檢查狀態、對焦並清空輸入框
                const params = { expression: EXPRESSION_CHECK, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);

                if (res.result?.value?.reason === 'busy') return res.result.value;
                if (res.result?.value?.ready) {

                    // 2. CDP 底層階段：發送純文字 (徹底防止重複與 React 干擾)
                    await cdp.call('Input.insertText', { text: text });

                    await new Promise(r => setTimeout(r, 150));

                    // 3. CDP 底層階段：發送實體 Enter (無效化所有防護盾的終極點擊)
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
                    await new Promise(r => setTimeout(r, 20));
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });

                    return { ok: true, method: "cdp_input_enter" };
                }
            } catch (e) { }
        }
    }
    return { ok: false, error: "no_editor_found" };
}

export async function injectImage(cdpList, base64Data, text = null) {
    const results = [];

    // CDP 腳本：多重補強注入
    const EXPRESSION = `(async () => {
        const logs = [];
        const log = (m) => logs.push(\`[\${new Date().toISOString().split('T')[1]}] \${m}\`);

        try {
            let editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
            let target = editors.at(-1);

            if (!target) {
                let candidates = Array.from(document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'))
                    .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
                candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
                target = candidates[0];
            }

            if (!target) return { ok: false, error: "no_editor_found", logs: logs };

            // 1. 穩定光標定位 (不再使用 selectAll/delete，避免清空)
            target.focus();
            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(false); // 固定在末尾
                selection.removeAllRanges();
                selection.addRange(range);
            }

            // 2. 準備數據
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
            Object.defineProperty(dt, 'files', { value: [file], writable: false });

            const getImgStatus = () => document.querySelectorAll('img').length + document.querySelectorAll('[class*="chip"]').length;
            const initialCount = getImgStatus();

            // 3. 嘗試注入 (僅使用最穩定的 Paste)
            log('Injecting Image...');
            target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
            
            // 稍作等待以確保 Lexical 分配了 DecoratorNode
            await new Promise(r => setTimeout(r, 1000));

            // 4. 發送按紐物理偵測 (不論有無按紐點擊，最後都交由 CDP 入口)
            const findSend = () => {
                const explicit = document.querySelector('button[data-tooltip-id*="send"], button[aria-label*="Send"], button[aria-label*="發送"]');
                if (explicit && explicit.offsetParent !== null) return explicit;
                const svgs = Array.from(document.querySelectorAll('button svg')).filter(svg => {
                    const cls = (svg.getAttribute('class') || "").toLowerCase();
                    return cls.includes('send') || cls.includes('arrow') || cls.includes('up');
                });
                return svgs.length > 0 ? svgs[0].closest('button') : null;
            };

            const sendBtn = findSend();
            let rect = null;
            if (sendBtn) {
                const r = sendBtn.getBoundingClientRect();
                rect = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }

            return { 
                ok: true, 
                readyForCdp: true, 
                injected: getImgStatus() > initialCount,
                rect: rect, 
                logs: logs 
            };
        } catch (e) {
            return { ok: false, error: e.toString(), logs: logs };
        }
    })()`;

    for (const cdp of cdpList) {
        const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                const val = res.result?.value;

                if (val && val.readyForCdp) {
                    // CDP 物理輸入文字
                    if (text) {
                        console.log('  [CDP] Inserting text via hardware bridge...');
                        await cdp.call('Input.insertText', { text: " " + text });
                        await new Promise(r => setTimeout(r, 600)); // 增加緩衝以防衝突
                    }

                    // 等待 Lexical 解析與按鈕啟用
                    console.log('  [CDP] Waiting for Lexical stability (3s)...');
                    await new Promise(r => setTimeout(r, 3000));

                    // 策略 1: CDP 物理坐標點擊 (最穩定的點擊法)
                    if (val.rect) {
                        console.log('  [CDP] Triggering physical mouse click at', val.rect);
                        const mouseBase = { x: Math.floor(val.rect.x), y: Math.floor(val.rect.y), button: 'left', clickCount: 1 };
                        await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouseBase });
                        await new Promise(r => setTimeout(r, 50));
                        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouseBase });
                        return { ok: true, method: "cdp_physical_click", logs: val.logs };
                    }

                    // 策略 2: CDP 實體 Enter 備援 (同步 injectMessage 的成功參數)
                    console.log('  [CDP] Triggering hardware Enter fallback...');
                    const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 };
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
                    await new Promise(r => setTimeout(r, 50));
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...k });

                    return { ok: true, method: "cdp_image_blind_ninja_v2", logs: val.logs };
                }
                if (val) results.push(val);
            } catch (e) { }
        }
    }

    return { ok: false, error: "no_editor_found_all_contexts", results: results };
}

export async function getDetailedUsage(cdpList) {
    const SCRIPT = `(async () => {
    const labels = Array.from(document.querySelectorAll('.statusbar-item-label, .statusbar-item a, .statusbar-item span, .statusbar-item')).filter(el => {
        const t = (el.innerText || "").trim();
        return t.includes('%') && el.offsetParent !== null;
    });

    const allAriaLabels = [];
    let firstTargetLabel = null;

    for (const l of labels) {
        let el = l;
        while (el && !el.classList?.contains('statusbar-item')) {
            if (el.parentElement) el = el.parentElement;
            else break;
        }
        if (el) {
            const aria = el.getAttribute('aria-label') || el.querySelector('[aria-label]')?.getAttribute('aria-label') || "";
            if (aria.includes('配額') || aria.includes('100%') || aria.includes('%')) {
                allAriaLabels.push(aria);
                if (!firstTargetLabel) firstTargetLabel = l;
            }
        }
    }

    if (allAriaLabels.length === 0) {
        for (const l of labels) {
            const aria = l.getAttribute('aria-label') || l.title || "";
            if (aria.includes('%')) {
                allAriaLabels.push(aria);
                if (!firstTargetLabel) firstTargetLabel = l;
            }
        }
    }

    if (allAriaLabels.length === 0 && !firstTargetLabel) return { error: 'Label not found' };

    const rawResults = {};
    let found = false;

    allAriaLabels.forEach(ariaLabel => {
        // 1. Process markdown table rows
        const regex = /[|] .*?[*][*]([^*]+)[*][*] [|] .*? [|] ([0-9.]+)%[^0-9]*?([0-9hms ]+)[(]([^)]+)[)] [|]/g;
        let match;
        while ((match = regex.exec(ariaLabel)) !== null) {
            found = true;
            rawResults[match[1].trim()] = {
                percent: match[2].trim() + "%",
                countdown: match[3].trim(),
                eta: match[4].trim()
            };
        }

        // 2. Process basic lines (fallback)
        const lines = ariaLabel.split('\\n');
        for (const line of lines) {
            if (line.includes('%') && (line.includes('→') || line.includes('|'))) {
                const parts = line.split('|');
                if (parts.length >= 4) {
                    const namePart = parts[1].replace(/\\*/g, '').replace('🟢', '').trim();
                    if (namePart && (!rawResults[namePart] || rawResults[namePart].eta === 'N/A')) {
                        const valPart = parts[3].trim();
                        const m = valPart.match(/([0-9.]+)%.*?([0-9hms ]+)[(]([^)]+)[)]/);
                        if (m) {
                            rawResults[namePart] = { percent: m[1] + "%", countdown: m[2].trim(), eta: m[3].trim() };
                            found = true;
                        }
                    }
                }
            }
        }
    });

    // 3. Logic: Grouping and merging
    const grouped = {};
    const getGroupKey = (name) => {
        const n = name.toLowerCase();
        if (n.includes('flash')) return "Gemini 3 Flash";
        if (n.includes('pro')) return "Gemini 3 Pro (H/L)";
        if (n.includes('gpt') || n.includes('claude') || n.includes('4o')) return "Claude / GPT-4o";
        return name; // Keep others as is
    };

    Object.keys(rawResults).forEach(name => {
        const key = getGroupKey(name);
        const data = rawResults[name];
        // If group already has data, prioritize the one with better info (non-N/A)
        if (!grouped[key] || (grouped[key].eta === 'N/A' && data.eta !== 'N/A')) {
            grouped[key] = data;
        }
    });

    if (found) return { success: true, data: grouped };

    // Final fallback: use visible text from label
    if (firstTargetLabel) {
        const rawText = (firstTargetLabel.innerText || "").replace(/\\s+/g, ' ');
        const parseLine = rawText.split('|').map(p => p.trim());
        const fallbackResults = {};
        parseLine.forEach(p => {
            const kv = p.split(':');
            if (kv.length >= 2) {
                const name = kv[0].replace('🟢', '').trim();
                const key = getGroupKey(name);
                fallbackResults[key] = { percent: kv[1].trim(), countdown: 'N/A', eta: 'N/A' };
                found = true;
            }
        });
        if (found) return { success: true, data: fallbackResults };
    }

    return { error: 'No data matches found' };
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

export async function openUsageDialog(cdpList) {
    const SCRIPT = `(() => {
    const labels = Array.from(document.querySelectorAll('.statusbar-item-label, .statusbar-item a, .statusbar-item span, .statusbar-item')).filter(el => {
        const t = (el.innerText || "").trim();
        return t.includes('%') && el.offsetParent !== null;
    });
    labels.sort((a, b) => a.innerText.length - b.innerText.length);
    const label = labels[0];
    if (label) {
        label.click();
        return { success: true };
    }
    return { error: 'Usage label not found' };
})()`;

    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}

export async function getAppState(cdpList) {
    let bestState = { mode: 'Unknown', model: 'Unknown', usage: '', title: '' };

    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown', usage: '', title: document.title || "" };

        // 定義禁區：編輯器、終端機、輸出視窗、通知區 (避免抓到 log 或代碼)
        const isForbidden = (el) => {
            return el.closest('.monaco-editor, .view-lines, .terminal-container, .part.panel, .notifications-toasts');
        };

        // 1. 精確定位：模型名稱與模式切換按鈕
        const toolbar = document.querySelector('.flex.items-center.gap-0-5, [class*="items-center"][class*="gap-0.5"]');
        if (toolbar) {
            const allItems = Array.from(toolbar.querySelectorAll('span, div')).filter(el => {
                return el.children.length === 0 && !isForbidden(el);
            });

            // 模式 (Fast/Planning)
            const modeNode = allItems.find(el => {
                const t = (el.innerText || "").trim();
                return t === 'Fast' || t === 'Planning';
            });
            if (modeNode) state.mode = modeNode.innerText.trim();

            // 模型 (長度優先，且不得超過 50 字)
            const modelCandidates = allItems.filter(el => {
                const t = (el.innerText || "").trim();
                return t.length < 50 && ["Gemini", "Claude", "GPT", "o1", "Sonnet"].some(k => t.includes(k)) && !t.includes('%');
            });
            if (modelCandidates.length > 0) {
                const sorted = modelCandidates.sort((a, b) => b.innerText.trim().length - a.innerText.trim().length);
                state.model = sorted[0].innerText.trim();
            }
        }

        // 2. 狀態列偵測 (用量)
        const statusItems = Array.from(document.querySelectorAll('.part.statusbar .statusbar-item'));
        if (statusItems.length > 0) {
            const usageItem = statusItems.find(el => {
                if (isForbidden(el)) return false;
                const t = (el.innerText || "").trim();
                return t.length < 200 && (t.includes('GP:') || t.includes('Group 1:') || t.includes('%')) && t.includes('|') && t.includes('%');
            });
            if (usageItem) state.usage = usageItem.innerText.trim();
        }

        // 3. 全局備援 (嚴格限制長度與禁區)
        if (state.model === 'Unknown') {
            const fallbackModel = Array.from(document.querySelectorAll('span, div')).find(el => {
                const t = (el.innerText || "").trim();
                if (el.children.length > 0 || t.length > 50 || isForbidden(el)) return false;
                return (t.includes('Gemini') || t.includes('Claude')) && !t.includes('|');
            });
            if (fallbackModel) state.model = fallbackModel.innerText.trim();
        }

        if (state.mode === 'Unknown') {
            const fallbackMode = Array.from(document.querySelectorAll('span, div, button, .statusbar-item, [aria-label]')).find(el => {
                if (isForbidden(el)) return false;
                if (el.children.length > 0 && !el.getAttribute('aria-label')) return false;
                const t = (el.innerText || "").trim();
                const label = el.getAttribute('aria-label') || "";
                return t === 'Fast' || t === 'Planning' || label.includes('Speed: Fast') || label.includes('Speed: Planning');
            });
            if (fallbackMode) {
                const t = (fallbackMode.innerText || "").trim();
                if (t === 'Fast' || t === 'Planning') state.mode = t;
                else if (fallbackMode.getAttribute('aria-label')) state.mode = fallbackMode.getAttribute('aria-label').includes('Fast') ? 'Fast' : 'Planning';
            }
        }

        // 4. 定位用量標籤 (單獨抓取文字，供 UI 點擊使用)
        const usageLabels = Array.from(document.querySelectorAll('.statusbar-item-label, .statusbar-item a, .statusbar-item span, .statusbar-item')).filter(el => {
            const t = (el.innerText || "").trim();
            // Match generic quota string with percentages and separators
            return t.includes('%') && t.includes('|') && el.offsetParent !== null;
        });
        // Prefer longer strings to capture the full combo (e.g. GP: 100% | GF: 100%)
        usageLabels.sort((a, b) => b.innerText.length - a.innerText.length);
        const usageLabel = usageLabels[0];
        if (usageLabel) state.usageText = usageLabel.innerText.trim();
        else if (state.usage) state.usageText = state.usage;

        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;

    for (const cdp of cdpList) {
        const ctxIds = (cdp.contexts && cdp.contexts.length > 0) ? cdp.contexts.map(c => c.id) : [undefined];
        for (const ctxId of ctxIds) {
            try {
                const params = { expression: EXP, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                const val = res.result?.value;
                if (val && !val.error) {
                    if (val.title && val.title.includes(' - ')) bestState.title = val.title.split(' - ')[0].trim();
                    else if (val.title && !bestState.title) bestState.title = val.title;

                    if (val.mode !== 'Unknown') bestState.mode = val.mode;
                    if (val.model !== 'Unknown') bestState.model = val.model;
                    if (val.usage) bestState.usage = val.usage;

                    // 如果在這個 Context 抓到了關鍵資訊，就判斷是否足夠
                    if (bestState.mode !== 'Unknown' && bestState.model !== 'Unknown' && bestState.usage) {
                        return bestState;
                    }
                }
            } catch (e) { }
        }
    }

    // 如果完全沒抓到有效資訊，回傳 null 觸發伺服器緩存
    if (bestState.mode === 'Unknown' && bestState.model === 'Unknown') return null;
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
    // 暫時停用此功能，因為 VS Code 跨域 Webview 隔離導致無法穩定點擊
    return { success: false, error: 'History feature is temporarily disabled for stability.' };
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
