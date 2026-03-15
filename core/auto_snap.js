import { simpleHash } from './utils.js';

export async function captureSnapshot(cdpList) {
    const CAPTURE_SCRIPT = `(() => {
        try {
            const body = document.body;
            if (!body) return { error: 'No body' };
            const target = document.querySelector('#conversation') || document.querySelector('#chat') || document.querySelector('#cascade') || document.querySelector('main') || document.querySelector('[role="main"]') || body;
            const matchQuality = target.id ? 'exact' : (target.tagName === 'MAIN' ? 'loose' : 'fallback');
            
            const rules = [];
            try {
                for (const sheet of document.styleSheets) {
                    try {
                        if (sheet.href && (sheet.href.includes('monaco') || sheet.href.includes('codicon'))) continue;
                        for (const rule of sheet.cssRules) {
                            if (rule.cssText.includes('@font-face')) continue;
                            rules.push(rule.cssText);
                        }
                    } catch (e) { }
                }
            } catch(e) {}
            
            const scrollEl = target.querySelector('.overflow-y-auto, [data-scroll-area]') || target;
            const scrollInfo = { scrollTop: scrollEl.scrollTop || 0, scrollHeight: scrollEl.scrollHeight || 0, clientHeight: scrollEl.clientHeight || 0 };

            const clone = target.cloneNode(true);
            const interactionSelectors = ['.relative.flex.flex-col.gap-8', '.flex.grow.flex-col.justify-start.gap-8', 'div[class*="interaction-area"]', '[contenteditable="true"]', '.monaco-inputbox', '.quick-input-widget'];
            interactionSelectors.forEach(s => clone.querySelectorAll(s).forEach(el => el.remove()));

            const cleanText = (t) => {
                if (!t) return t;
                return t.replace(/[a-z]:[^"'> ]+?\\.gemini[\\\\\\/]+antigravity[\\\\\\/]+brain[\\\\\\/]+/gi, '/brain/')
                        .replace(/(?:[a-zA-Z0-9+.-]+:\\/\\/[^"'>\\s]*?(?=[a-zA-Z](:|%3A)))?(?:\\/+)?([a-zA-Z](:|%3A)(?:[\\\\\\/]|%2F|%5C|%20|\\s)+Program(?:[\\\\\\/]|%2F|%5C|%20|\\s)+Files)/gi, '/vscode-resources');
            };

            return {
                html: cleanText(clone.outerHTML),
                css: cleanText(rules.join('\\n')),
                scrollInfo,
                matchQuality,
                title: document.title
            };
        } catch (e) { return { error: e.toString() }; }
    })()`;

    const candidates = [];
    for (const cdp of cdpList) {
        for (const ctx of (cdp.contexts || [{id:undefined}])) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: CAPTURE_SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value && !res.result.value.error) {
                    candidates.push({ ...res.result.value, hash: simpleHash(res.result.value.html), targetTitle: cdp.title });
                }
            } catch (e) { }
        }
    }
    if (candidates.length === 0) return { error: 'no snapshot found' };
    const qualityScore = { exact: 3, loose: 1, fallback: 0 };
    candidates.sort((a,b) => (qualityScore[b.matchQuality]||0) - (qualityScore[a.matchQuality]||0) || b.html.length - a.html.length);
    return candidates[0];
}
