import { simpleHash } from './utils.js';
import { cleanContent } from './auto_sanitizer.js';

export async function captureSnapshot(cdpList) {
    const CAPTURE_SCRIPT = `(() => {
        try {
            const startTime = Date.now();
            const body = document.body;
            if (!body) return { error: 'No body' };
            
            const isChatContainer = (el) => el && (el.id === 'conversation' || el.id === 'chat' || el.id === 'cascade');
            const exactTarget = [
                document.querySelector('#conversation'),
                document.querySelector('#chat'),
                document.querySelector('#cascade')
            ].find(el => el && (el.offsetHeight > 0 || isChatContainer(el)));

            const isVisible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            };

            const looseTarget = [
                document.querySelector('main'),
                document.querySelector('[role="main"]')
            ].find(isVisible);
            
            const target = exactTarget || looseTarget;
            const matchQuality = exactTarget ? 'exact' : (looseTarget ? 'loose' : 'fallback');
            const root = target || body;
            
            // 2. Capture CSS
            const rules = [];
            const skipPrefixes = ['.monaco-', '.codicon-', '.mtk', '.monaco-editor', '.margin-view-overlays'];
            try {
                for (const sheet of document.styleSheets) {
                    try {
                        if (sheet.href && (sheet.href.includes('monaco') || sheet.href.includes('codicon'))) continue;
                        for (const rule of sheet.cssRules) {
                            const selector = rule.selectorText || '';
                            if (skipPrefixes.some(p => selector.includes(p))) continue;
                            if (rule.cssText.includes('@font-face')) continue;
                            rules.push(rule.cssText);
                        }
                    } catch (e) { }
                }
            } catch(e) {}
            const allCSS = rules.join('\\n');

            // 3. Scroll Info
            const scrollEl = root.querySelector('.overflow-y-auto, [data-scroll-area]') || root;
            const scrollInfo = {
                scrollTop: scrollEl.scrollTop || 0,
                scrollHeight: scrollEl.scrollHeight || 0,
                clientHeight: scrollEl.clientHeight || 0
            };

            // 4. Serialize & Clean HTML
            const clone = root.cloneNode(true);
            
            // A. 移除互動區域
            const interactionSelectors = [
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '[contenteditable="true"]',
                '.monaco-inputbox',
                '.quick-input-widget'
            ];

            interactionSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => {
                    const isInput = el.querySelector('textarea, input, [contenteditable="true"]') || 
                                    el.getAttribute('placeholder')?.includes('Ask');
                    if (isInput || selector.includes('monaco') || selector.includes('widget')) el.remove();
                });
            });

            // B. 属性清洗
            clone.querySelectorAll('*').forEach(el => {
                const attrsToRemove = [];
                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i];
                    if (attr.name.startsWith('data-') && !attr.name.includes('scroll')) {
                        attrsToRemove.push(attr.name);
                    }
                }
                attrsToRemove.forEach(a => el.removeAttribute(a));
                
                // 噪音過濾 (文本相關)
                const text = (el.innerText || '').toLowerCase();
                if (text.includes('review changes') || text.includes('context found') || text.includes('ask anything')) {
                    if (el.children.length < 5) el.remove();
                }
            });

            return {
                html: clone.outerHTML,
                css: allCSS,
                scrollInfo: scrollInfo,
                matchQuality: matchQuality,
                duration: Date.now() - startTime,
                title: document.title,
                url: window.location.href,
                hasFocus: document.hasFocus(),
                visibility: document.visibilityState
            };
        } catch (e) { return { error: e.toString() }; }
    }) ()`;

    const candidates = [];
    for (const cdp of cdpList) {
        const contexts = (cdp.contexts && cdp.contexts.length > 0) ? cdp.contexts : [{ id: undefined }];
        for (const ctx of contexts) {
            try {
                const params = { expression: CAPTURE_SCRIPT, returnByValue: true };
                if (ctx.id !== undefined) params.contextId = ctx.id;

                const res = await cdp.call("Runtime.evaluate", params);
                if (res.result?.value) {
                    const val = res.result.value;
                    if (val.error) {
                        console.log(`[V4-SNAP] Context ${ctx.id} reported error: ${val.error}`);
                        continue;
                    }
                    if (!val.html) {
                        console.log(`[V4-SNAP] Context ${ctx.id} returned empty HTML`);
                        continue;
                    }

                    val.html = cleanContent(val.html || '');
                    val.css = cleanContent(val.css || '');

                    candidates.push({
                        ...val,
                        hash: simpleHash(val.html),
                        targetTitle: cdp.title
                    });
                } else {
                    // console.log(`[V4-SNAP] Context ${ctx.id} evaluation failed or returned null`);
                }
            } catch (e) { 
                console.error(`[V4-SNAP] Exception processing context ${ctx.id}:`, e.message);
            }
        }
    }

    if (candidates.length === 0) return { error: 'no snapshot found' };

    const qualityScore = { exact: 1000000, loose: 1000, fallback: 0 };
    candidates.sort((a, b) => {
        // 1. 優先比對品質 (exact > loose > fallback)
        const qa = (qualityScore[a.matchQuality] || 0) + (a.matchQuality === 'exact' ? 500000 : 0);
        const qb = (qualityScore[b.matchQuality] || 0) + (b.matchQuality === 'exact' ? 500000 : 0);
        if (qa !== qb) return qb - qa;
        
        // 2. 只有品質相同時，比對可見性 (visible 絕對優先)
        if (a.visibility !== b.visibility) return a.visibility === 'visible' ? -1 : 1;

        // 3. 比對焦點
        if (a.hasFocus !== b.hasFocus) return a.hasFocus ? -1 : 1;
        
        // 4. 特殊處理：如果是新開的對話（長度很短但包含聊天容器），賦予一個虛擬長度加成
        // 避免被 100KB+ 的舊對話「長度壓制」
        const getEffectiveLength = (c) => {
            let len = c.html.length;
            if (c.matchQuality === 'exact' && len < 10000) len += 200000; // 賦予新對話巨大的競爭力
            return len;
        };

        return getEffectiveLength(b) - getEffectiveLength(a);
    });

    return candidates[0];
}

export async function injectScroll(cdpList, options) {
    const SCRIPT = `(() => {
        const { scrollTop, scrollPercent } = ${JSON.stringify(options)};
        const findScrollContainer = () => {
            const candidates = document.querySelectorAll('.overflow-y-auto, [data-scroll-area]');
            for (const el of candidates) if (el.scrollHeight > el.clientHeight) return el;
            const chat = document.querySelector('#conversation') || document.querySelector('#chat') || document.querySelector('#cascade');
            if (chat && chat.scrollHeight > chat.clientHeight) return chat;
            return document.documentElement;
        };
        const target = findScrollContainer();
        if (typeof scrollPercent === 'number' && scrollPercent >= 0) {
            target.scrollTop = scrollPercent * (target.scrollHeight - target.clientHeight);
        } else if (typeof scrollTop === 'number') {
            target.scrollTop = scrollTop;
        }
        return { success: true };
    })()`;

    for (const cdp of cdpList) {
        for (const ctx of (cdp.contexts || [{id:undefined}])) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.success) return { success: true };
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}
