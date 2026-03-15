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
    const CHECK_SCRIPT = `(async () => {
        const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
        const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
        const busyEl = cancel || stopBtn;
        if (!${force} && busyEl && !!busyEl.offsetParent && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

        const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')].filter(el => !!el.offsetParent);
        if (editors.length === 0) return { ok: false, error: "no_editor" };
        
        const editor = editors[editors.length - 1];
        editor.focus();

        // 徹底清空並避免 TrustedHTML 限制
        while (editor.firstChild) {
            editor.removeChild(editor.firstChild);
        }
        const p = document.createElement('p');
        p.setAttribute('dir', 'ltr');
        p.appendChild(document.createElement('br'));
        editor.appendChild(p);

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
    })()`;

    for (const cdp of cdpList) {
        // 優先嘗試所有 contexts，加上 undefined (主環境)
        const contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        
        for (const ctxId of contexts) {
            try {
                const params = { expression: CHECK_SCRIPT, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                
                const checkRes = await cdp.call("Runtime.evaluate", params);

                if (checkRes?.result?.value?.reason === 'busy') return checkRes.result.value;

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
                    const fallbackRes = await cdp.call("Runtime.evaluate", {
                        expression: `(() => {
                            const editor = [...document.querySelectorAll('[data-lexical-editor="true"]')].at(-1);
                            if (editor && editor.innerText.trim().length > 0) {
                                const btn = document.querySelector('button[data-tooltip-id*="send"]') || 
                                            Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Send') || b.ariaLabel?.includes('Send'));
                                if (btn && !btn.disabled) {
                                    btn.click();
                                    return "clicked_fallback";
                                }
                                return "text_not_cleared_but_no_button";
                            }
                            return "cleared";
                        })()`,
                        returnByValue: true,
                        contextId: ctxId
                    });

                    return { ok: true, method: "cdp_v4_smart_send", status: fallbackRes?.result?.value };
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
            let editors = [...document.querySelectorAll('[data-lexical-editor="true"]')].filter(el => !!el.offsetParent);
            let target = editors[editors.length - 1];

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
            
            // 4. 改用輪詢偵測：一旦偵測到圖片產生就開始下一步 (Max 1s)
            for (let i = 0; i < 10; i++) {
                if (getImgStatus() > initialCount) {
                    log('Image detected after ' + (i * 100) + 'ms');
                    break;
                }
                await new Promise(r => setTimeout(r, 100));
            }

            // 5. 尋找與點擊發送按紐 (精確排除 Plan/Mode 按鈕)
            // 增加智能等待：等候按紐不再處於 disabled 狀態 (Lexical 處理圖片時常會暫時禁用按紐)
            const waitForReady = async () => {
                for (let j = 0; j < 20; j++) {
                    const candidates = Array.from(document.querySelectorAll('button')).filter(btn => {
                        if (btn.offsetParent === null) return false;
                        const text = (btn.innerText || "").toLowerCase();
                        const aria = (btn.getAttribute('aria-label') || "").toLowerCase();
                        const tip = (btn.getAttribute('data-tooltip-id') || "").toLowerCase();
                        if (text.includes('plan') || text.includes('fast') || text.includes('mode') || aria.includes('plan')) return false;
                        if (aria.includes('send') || tip.includes('send') || aria.includes('發送') || text.includes('發送')) return true;
                        const svg = btn.querySelector('svg');
                        if (svg) {
                            const cls = (svg.getAttribute('class') || "").toLowerCase();
                            if (cls.includes('send') || (cls.includes('arrow') && cls.includes('up') && !cls.includes('chevron'))) return true;
                        }
                        return false;
                    });
                    
                    if (candidates.length > 0) {
                        const best = candidates.sort((a, b) => {
                            const ra = a.getBoundingClientRect();
                            const rb = b.getBoundingClientRect();
                            return (rb.right + rb.bottom) - (ra.right + ra.bottom);
                        })[0];
                        
                        // 檢查是否 Ready (非 disabled 且透明度正常)
                        const style = window.getComputedStyle(best);
                        if (!best.disabled && parseFloat(style.opacity || "1") > 0.8) {
                            log('Send button is ready at poll ' + j);
                            return best;
                        }
                    }
                    await new Promise(r => setTimeout(r, 100));
                }
                return null;
            };

            const sendBtn = await waitForReady();
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
        const contexts = [undefined, ...cdp.contexts.map(c => c.id)];
        for (const ctxId of contexts) {
            try {
                const params = { expression: EXPRESSION, returnByValue: true, awaitPromise: true };
                if (ctxId !== undefined) params.contextId = ctxId;
                const res = await cdp.call("Runtime.evaluate", params);
                const val = res.result?.value;

                if (val && val.readyForCdp) {
                    // 1. 物理輸入文字前綴 (Lexical 兼容性較佳)

                    if (text) {
                        console.log('  [CDP] Inserting text prefix...');
                        await cdp.call('Input.insertText', { text: text + " " });
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
                        await new Promise(r => setTimeout(r, 200));
                    }

                    // 2. 穩定等待 (改為極短 100ms，因為 JS 端已經完成 Ready 偵測)
                    await new Promise(r => setTimeout(r, 100));

                    // 3. 執行發送 - 策略 1: 物理坐標點擊
                    let sentSuccessful = false;
                    if (val.rect) {
                        console.log('  [CDP] Triggering hardware click...');
                        const mouseBase = { x: Math.floor(val.rect.x), y: Math.floor(val.rect.y), button: 'left', clickCount: 1 };
                        await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouseBase });
                        await new Promise(r => setTimeout(r, 30));
                        await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouseBase });

                        // 快速驗證發送 (僅等待 200ms)
                        await new Promise(r => setTimeout(r, 200));
                        const checkRes = await cdp.call("Runtime.evaluate", {
                            expression: `(document.querySelector('[data-lexical-editor="true"]')?.innerText || "").trim().length === 0`,
                            returnByValue: true
                        });
                        if (checkRes.result?.value) sentSuccessful = true;
                    }

                    // 4. 強制視覺清空與備援 - 使用硬體模擬 Control+A + Backspace
                    // 即使點擊看起來成功，如果編輯器還不空，我們立刻用硬體刪除戳它
                    if (!sentSuccessful) {
                        console.log('  [CDP] Executing Hardware Snap-Clear (Ctrl+A + Backspace)...');
                        await cdp.call("Runtime.evaluate", { expression: `document.querySelector('[data-lexical-editor="true"]')?.focus()` });

                        // 1. Control + A (全選)
                        const ctrlMask = 2; // Control key modifier
                        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: ctrlMask });
                        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: ctrlMask });

                        // 2. Backspace (刪除)
                        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', windowsVirtualKeyCode: 8 });
                        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8 });

                        // 3. 最後補一個 Enter 確保一定送出
                        const kEnter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
                        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...kEnter });
                        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...kEnter });
                        sentSuccessful = true;
                    }

                    return { ok: true, method: sentSuccessful ? "cdp_fast_hardware_send" : "cdp_v4_legacy", logs: val.logs };
                }
                if (val) results.push(val);
            } catch (e) { }
        }
    }

    return { ok: false, error: "no_editor_found_all_contexts", results: results };
}

export async function getDetailedUsage(cdpList, port = 9001) {
    const { getOrConnectParams } = await import('./cdp_manager.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const EXTRACT_SCRIPT = `(async () => {
        const getGroupKey = (name) => {
            const n = (name || "").toLowerCase();
            if (n.includes('flash')) return "Gemini 3 Flash";
            if (n.includes('pro')) return "Gemini 3 Pro (H/L)";
            if (n.includes('gpt') || n.includes('claude') || n.includes('4o')) return "Claude / GPT-4o";
            return name;
        };

        // --- Aria label extraction (for status bar) ---
        const labels = Array.from(document.querySelectorAll('.statusbar-item-label, .statusbar-item a, .statusbar-item span, .statusbar-item')).filter(el => {
            const t = (el.innerText || "").trim();
            return t.includes('%') && el.offsetParent !== null;
        });
        const allAriaLabels = [];
        for (const l of labels) {
            let el = l;
            while (el && !el.classList?.contains('statusbar-item')) {
                if (el.parentElement) el = el.parentElement; else break;
            }
            if (el) {
                const aria = el.getAttribute('aria-label') || el.querySelector('[aria-label]')?.getAttribute('aria-label') || "";
                if (aria) allAriaLabels.push(aria);
            }
        }

        const rawResults = {};
        allAriaLabels.forEach(ariaLabel => {
            const regexTable = /[|] .*?[*][*]([^*]+)[*][*] [|] .*? [|] ([0-9.]+)%[^0-9]*?([0-9hms ]+)[(]([^)]+)[)] [|]/g;
            let match;
            while ((match = regexTable.exec(ariaLabel)) !== null) {
                rawResults[match[1].trim()] = { percent: match[2].trim() + "%", countdown: match[3].trim(), eta: match[4].trim() };
            }
            const lines = ariaLabel.split('\\n');
            for (const line of lines) {
                if (line.includes('%') && (line.includes('→') || line.includes('|'))) {
                    const parts = line.split('|');
                    if (parts.length >= 4) {
                        const namePart = parts[1].replace(/\\*/g, '').replace('🟢', '').trim();
                        if (namePart && (!rawResults[namePart] || rawResults[namePart].countdown === 'N/A')) {
                            const m = parts[3].trim().match(/([0-9.]+)%.*?([0-9hms ]+)[(]([^)]+)[)]/);
                            if (m) rawResults[namePart] = { percent: m[1] + "%", countdown: m[2].trim(), eta: m[3].trim() };
                        }
                    }
                }
            }
        });

        const finalData = {};
        Object.keys(rawResults).forEach(name => {
            const key = getGroupKey(name);
            if (!finalData[key] || (finalData[key].countdown === 'N/A' && rawResults[name].countdown !== 'N/A')) finalData[key] = rawResults[name];
        });

        // --- Settings window: "Refreshes in" or "80% 3h 49m" extraction (Robust) ---
        const pageText = document.body.innerText || "";
        const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);
        
        // 嘗試捕獲拼接格式: "Gemini 3 Flash80% 3h 49m"
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const mConcat = line.match(/(.*?)([0-9.]+)%\s*([0-9d hms,]+)/i);
            if (mConcat) {
                const name = mConcat[1].trim();
                const key = getGroupKey(name);
                if (key && name.length < 50) {
                     finalData[key] = { percent: mConcat[2] + "%", countdown: mConcat[3].trim(), eta: "N/A" };
                     continue; // 優先處理拼接格式
                }
            }
            
            if (line.includes('Refreshes in')) {
                const modelName = lines[i-1] || "Unknown";
                const match = line.match(/Refreshes in (\\d+) hours?, (\\d+) minutes?/i) || 
                              line.match(/Refreshes in (\\d+) minutes?/i);
                if (match) {
                    const key = getGroupKey(modelName);
                    const countdown = match.length === 3 ? (match[1] + "h " + match[2] + "m") : (match[1] + "m");
                    if (!finalData[key] || finalData[key].countdown === 'N/A') {
                        finalData[key] = { percent: "Usage Only", countdown, eta: "N/A" };
                    }
                }
            }
        }
        const hasData = Object.keys(finalData).length > 0;
        return { success: hasData, data: finalData };
    })()`;

    const GET_STATUS_BAR_COORDS = `(() => {
        const forbidden = ['TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE'];
        const els = Array.from(document.querySelectorAll('*')).filter(e => {
            if (forbidden.includes(e.tagName)) return false;
            const label = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || '')).toLowerCase();
            return label.includes('antigravity') || label.includes('auto accept') || label.includes('background');
        });
        els.sort((a, b) => {
            const isA = a.classList.contains('statusbar-item') || a.closest('.statusbar-item');
            const isB = b.classList.contains('statusbar-item') || b.closest('.statusbar-item');
            if (isA && !isB) return -1;
            if (!isA && isB) return 1;
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        });
        const target = els.find(e => {
            if (e.tagName === 'BODY' || e.tagName === 'HTML') return false;
            const rect = e.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2; 
        });
        if (target) {
            const rect = target.getBoundingClientRect();
            return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) };
        }
        return null;
    })()`;

    const GET_ADVANCED_COORDS = `(() => {
        const forbidden = ['TEXTAREA', 'INPUT', 'SCRIPT', 'STYLE'];
        const els = Array.from(document.querySelectorAll('*')).filter(el => {
            if (forbidden.includes(el.tagName)) return false;
            return el.innerText && el.innerText.trim() === 'Advanced Settings';
        });
        els.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        });
        const target = els.find(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2 && rect.width < 400;
        });
        if (target) {
            const rect = target.getBoundingClientRect();
            return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) };
        }
        return null;
    })()`;

    const GET_MODELS_COORDS = `(() => {
        const els = Array.from(document.querySelectorAll('*')).filter(e => {
            const t = (e.innerText || "").trim();
            return t === 'Models' || (t.includes('Models') && t.length < 15);
        });
        els.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.width * ra.height) - (rb.width * rb.height);
        });
        const target = els.find(e => {
            const rect = e.getBoundingClientRect();
            return rect.width > 2 && rect.height > 2;
        });
        if (target) {
            const rect = target.getBoundingClientRect();
            return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) };
        }
        return null;
    })()`;

    async function evalDirect(cdp, script) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true, awaitPromise: true }).catch(() => null);
            let val = res?.result?.value;
            if (val?.success && val?.data) return { success: true, data: val.data };
            for (const ctx of (cdp.contexts || [])) {
                const resC = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true, awaitPromise: true, contextId: ctx.id }).catch(() => null);
                let valC = resC?.result?.value;
                if (valC?.success && valC?.data) return { success: true, data: valC.data };
            }
        } catch (e) {}
        return null;
    }

    async function physicalClick(cdp, script) {
        let coords = null;
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true }).catch(() => null);
            if (res?.result?.value?.x) coords = res.result.value;
        } catch (e) {}
        if (!coords) {
            for (const ctx of (cdp.contexts || [])) {
                try {
                    const res = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true, contextId: ctx.id }).catch(() => null);
                    if (res?.result?.value?.x) {
                        coords = res.result.value;
                        break;
                    }
                } catch (e) {}
            }
        }
        if (coords && coords.x && coords.y) {
            await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
            await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
            return true;
        }
        return false;
    }

    // --- PHASE 1: Try current targets ---
    for (const cdp of cdpList) {
        const result = await evalDirect(cdp, EXTRACT_SCRIPT);
        if (result?.success) return result;
    }

    // --- PHASE 2: Trigger Settings ---
    let freshConns = await getOrConnectParams(port, true).catch(() => cdpList);
    let settingsTarget = freshConns.find(c => c.title === 'Settings');

    if (settingsTarget) {
        for (let i = 0; i < 2; i++) {
            await physicalClick(settingsTarget, GET_MODELS_COORDS);
            await sleep(1500);
            const result = await evalDirect(settingsTarget, EXTRACT_SCRIPT);
            if (result?.success) return result;
        }
    }

    const workbench = freshConns.find(c => c.title.includes('Antigravity') || (c.title && c.title.includes('ubuntu')) || (c.title && c.title.includes('rocket')));
    if (!workbench) return { success: false, error: 'No workbench found' };

    let triggered = false;
    for (let i = 0; i < 3; i++) {
        if (await physicalClick(workbench, GET_STATUS_BAR_COORDS)) {
            await sleep(2000);
            for (let j = 0; j < 3; j++) {
                if (await physicalClick(workbench, GET_ADVANCED_COORDS)) {
                    triggered = true;
                    await sleep(4000);
                    break;
                }
                await sleep(1000);
            }
        }
        if (triggered) break;
        await sleep(2000);
    }

    // Reconnect to find spawned Settings
    for (let r = 0; r < 6; r++) {
        await sleep(1000);
        freshConns = await getOrConnectParams(port, true).catch(() => freshConns);
        settingsTarget = freshConns.find(c => c.title === 'Settings');
        if (settingsTarget) break;
    }

    // Final navigation and extraction
    for (let r = 0; r < 5; r++) {
        const clicked = await physicalClick(settingsTarget, GET_MODELS_COORDS);
        await sleep(2000); // Wait for load
        const result = await evalDirect(settingsTarget, EXTRACT_SCRIPT);
        if (result?.success) return result;
        
        // If not successful, try to click again or wait more
        if (!clicked) await sleep(1000);
    }

    return { success: false, error: 'Extraction failed after trigger' };
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
    // CRITICAL: A server restart (node scripts/reboot.js) is MANDATORY after modifying core/*.js files.
    let bestState = { mode: 'Unknown', model: 'Unknown', usage: '', title: '' };
    
    // 優先選取包含 [WSL] 或具有專案特徵的 Workbench，避免選到背景輔助視窗
    const targetCdp = cdpList.find(c => c.title && c.title.includes(' [WSL:')) || // Port 9001 特徵
                      cdpList.find(c => c.title && !/Launchpad|Monitor|server|package|json|Extension|Terminal/i.test(c.title)) || 
                      cdpList.find(c => c.title && c.title !== 'Settings') ||
                      cdpList[0];

    if (!targetCdp) return bestState;
    
    // 1. 標題：顯示資料夾名稱 (專案名)
    let rawTitle = targetCdp.title || "";
    bestState.title = rawTitle.split(' - ')[0].replace(/ \[WSL:.*\]/, "").trim();

    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown', usage: '', title: (document.title || "").split(' - ')[0].replace(/ \\[WSL:.*\\]/, "").trim() };
        const isForbidden = (el) => el.closest('.monaco-editor, .view-lines, .terminal-container, .notifications-toasts');

        // 1. 偵測狀態列 (通用的狀態抓取)
        const statusItems = Array.from(document.querySelectorAll('.statusbar-item'));
        for (const item of statusItems) {
            if (isForbidden(item)) continue;
            const t = (item.innerText || "").trim();
            const aria = (item.getAttribute('aria-label') || "").trim();
            const combined = (t + " " + aria).toLowerCase();

            // 模式 (Fast/Planning)
            if (state.mode === 'Unknown') {
                if (t === 'Fast' || t === 'Planning') state.mode = t;
                else if (aria.includes('Speed: Fast') || t === '⚡ ON') state.mode = 'Fast';
                else if (aria.includes('Speed: Planning')) state.mode = 'Planning';
            }

            // 模型
            if (state.model === 'Unknown') {
                if (combined.includes('gemini')) state.model = 'Gemini 3 Flash';
                else if (combined.includes('claude')) state.model = 'Claude 3.5 Sonnet';
                else if (combined.includes('gpt')) state.model = 'GPT-4o';
            }

            // 用量 (統一 9000/9001 邏輯：必須包含 %，排除垃圾文字)
            if (state.usage === '' && !combined.includes('rocket') && !combined.includes('gitlens')) {
                if (aria.includes('%') && (aria.includes('|') || aria.includes(':'))) {
                    state.usage = aria;
                } else if (t.includes('%') && (t.includes('|') || t.includes(':'))) {
                    state.usage = t;
                }
            }
        }

        // 2. 模式 Toolbar 備援 (Port 9001 必須依靠此處)
        if (state.mode === 'Unknown') {
            const toolbar = document.querySelector('.flex.items-center.gap-0-5, [class*="items-center"][class*="gap-0.5"]');
            if (toolbar) {
                const txt = toolbar.innerText || "";
                if (txt.includes('Planning')) state.mode = 'Planning';
                else state.mode = 'Fast';
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
