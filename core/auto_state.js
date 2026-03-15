export async function getAppState(cdpList) {
    const EXP = `(() => {
        const state = { mode: 'Unknown', model: 'Unknown', usage: '' };
        const statusItems = Array.from(document.querySelectorAll('.statusbar-item'));
        
        // 1. 優先從狀態列抓取
        for (const item of statusItems) {
            const t = (item.innerText || "").trim();
            const aria = (item.getAttribute('aria-label') || "").trim().toLowerCase();
            
            if (t === 'Fast' || t === 'Planning') state.mode = t;
            
            // 模型識別改良：優先從文本
            if (t.includes('Gemini') || aria.includes('gemini')) state.model = t.includes('Gemini') ? t : 'Gemini 3 Flash';
            else if (t.includes('Claude') || aria.includes('claude')) state.model = t.includes('Claude') ? t : 'Claude 3.5 Sonnet';
            
            if (aria.includes('%') || t.includes('%')) state.usage = t || aria;
        }

        // 2. 如果沒抓到模式，進行全域掃描 (處理新版 UI 可能將模式移出狀態列的情況)
        if (state.mode === 'Unknown') {
            const modeEl = Array.from(document.querySelectorAll('button span, div span, button')).find(el => {
                const text = el.innerText.trim();
                return (text === 'Fast' || text === 'Planning') && el.offsetWidth > 0;
            });
            if (modeEl) state.mode = modeEl.innerText.trim();
        }

        // 3. 模型再次確認 (如果 model 還是 Unknown)
        if (state.model === 'Unknown') {
            const modelEl = Array.from(document.querySelectorAll('button')).find(el => {
                const t = el.innerText;
                return (t.includes('Gemini') || t.includes('Claude') || t.includes('GPT')) && el.offsetWidth > 0;
            });
            if (modelEl) state.model = modelEl.innerText.trim();
        }

        return state;
    })()`;
    const target = cdpList.find(c => c.title.includes('WSL')) || cdpList[0];
    if (target) {
        const res = (await target.call("Runtime.evaluate", { expression: EXP, returnByValue: true })).result?.value;
        if (res) return res;
    }
    return { mode: 'Unknown', model: 'Unknown', usage: '' };
}

export async function setMode(cdpList, mode) {
    const EXP = `(async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Fast') || b.innerText.includes('Planning'));
        if (btn) {
            if (btn.innerText.includes('${mode}')) return { success: true };
            btn.click(); await new Promise(r=>setTimeout(r,500));
            const opt = Array.from(document.querySelectorAll('div, button, span')).find(el => el.innerText.trim() === '${mode}');
            if (opt) { opt.click(); return { success: true }; }
        }
        return { ok: false };
    })()`;
    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true });
        if (res.result?.value?.success) return res.result.value;
    }
    return { error: 'Failed' };
}

export async function setModel(cdpList, modelName) {
    const EXP = `(async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => ["Gemini", "Claude", "GPT", "Model"].some(k => b.innerText.includes(k)));
        if (btn) {
            btn.click(); await new Promise(r=>setTimeout(r,800));
            const opt = Array.from(document.querySelectorAll('*')).find(el => el.innerText.includes('${modelName}') && el.offsetHeight > 0);
            if (opt) { opt.click(); return { success: true }; }
        }
        return { ok: false };
    })()`;
    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true });
        if (res.result?.value?.success) return res.result.value;
    }
    return { error: 'Failed' };
}

export async function discoverModels(cdpList) {
    const EXP = `(async () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => ["Gemini", "Claude", "GPT", "Model"].some(k => b.innerText.includes(k)));
        if (!btn) return { error: 'Not found' };
        btn.click(); await new Promise(r=>setTimeout(r,800));
        const items = Array.from(document.querySelectorAll('[role="dialog"] *')).map(el => el.innerText.trim()).filter(t => t.length > 3 && (t.includes('Gemini') || t.includes('Claude') || t.includes('GPT')));
        document.body.click(); 
        return { models: [...new Set(items)] };
    })()`;
    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true });
        if (res.result?.value?.models) return res.result.value;
    }
    return { error: 'Failed' };
}

export async function startNewChat(cdpList) {
    const EXP = `(async () => {
        const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]') || 
                   Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-plus') || b.innerText.includes('New Chat'));
        if (btn) { btn.click(); return { success: true }; }
        return { error: 'Not found' };
    })()`;
    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true });
        if (res.result?.value?.success) { await new Promise(r=>setTimeout(r,500)); return { success: true }; }
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
        const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true });
        if (res.result?.value?.success) return res.result.value;
    }
    return { error: 'Failed' };
}

export async function getChatHistory(cdpList) { return { success: false, error: 'Disabled' }; }
