export async function injectScroll(cdpList, options) {
    const SCRIPT = `(async () => {
        const { scrollTop, scrollPercent } = ${JSON.stringify(options)};
        const target = document.querySelector('.overflow-y-auto, [data-scroll-area]') || document.documentElement;
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
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value?.success) return { success: true };
            } catch (e) { }
        }
    }
    return { error: 'Failed' };
}

export async function injectMessage(cdpList, text, force = false) {
    const CHECK_SCRIPT = `(() => {
        const editor = [...document.querySelectorAll('[data-lexical-editor="true"]')].filter(el => !!el.offsetParent).at(-1);
        if (!editor) return { ok: false };
        editor.focus();
        while (editor.firstChild) editor.removeChild(editor.firstChild);
        const p = document.createElement('p'); p.appendChild(document.createElement('br'));
        editor.appendChild(p);
        return { ok: true };
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of [undefined, ...cdp.contexts.map(c => c.id)]) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: CHECK_SCRIPT, returnByValue: true, contextId: ctx });
                if (res?.result?.value?.ok) {
                    await cdp.call('Input.insertText', { text: text });
                    const kEnter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...kEnter });
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...kEnter });
                    return { ok: true };
                }
            } catch (e) { }
        }
    }
    return { ok: false };
}

export async function injectImage(cdpList, base64Data, text = null) {
    const SCRIPT = `(() => {
        const editor = [...document.querySelectorAll('[data-lexical-editor="true"]')].at(-1);
        if (!editor) return { ok: false };
        editor.focus();
        const parts = "${base64Data}".split(',');
        const blob = new Blob([new Uint8Array(atob(parts[parts.length - 1]).split('').map(c=>c.charCodeAt(0)))], { type: "image/png" });
        const dt = new DataTransfer(); dt.items.add(new File([blob], "upload.png", { type: "image/png" }));
        editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
        return { ok: true };
    })()`;
    for (const cdp of cdpList) {
        for (const ctxId of [undefined, ...cdp.contexts.map(c => c.id)]) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctxId });
                if (res.result?.value?.ok) {
                    if (text) await cdp.call('Input.insertText', { text: text + " " });
                    const kEnter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...kEnter });
                    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...kEnter });
                    return { ok: true };
                }
            } catch (e) { }
        }
    }
    return { ok: false };
}
