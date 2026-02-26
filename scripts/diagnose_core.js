import { getOrConnectParams } from '../core/cdp_manager.js';

async function test() {
    console.log('--- Diagnosis Start ---');
    const port = 9001;
    try {
        const conns = await getOrConnectParams(port);
        console.log(`Connected to ${conns.length} contexts on port ${port}`);

        const EXPERIMENT = `(async () => {
            const editor = document.querySelector('[data-lexical-editor="true"]');
            if (!editor) return { error: "no_editor" };

            // Find Send Button
            const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
            const sendBtn = btns.find(b => (b.innerText + b.getAttribute('aria-label') + b.title).toLowerCase().includes('send') || b.querySelector('svg'));
            
            if (!sendBtn) return { error: "no_button" };

            const results = [];
            const check = (label) => {
                results.push({
                    step: label,
                    disabled: sendBtn.disabled,
                    classList: Array.from(sendBtn.classList).join(' '),
                    ariaDisabled: sendBtn.getAttribute('aria-disabled')
                });
            };

            check("Initial");

            editor.focus();
            document.execCommand("insertText", false, "Hello Diagnosis");
            check("After insertText");

            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Hello Diagnosis" }));
            check("After InputEvent");

            return { results, buttonHtml: sendBtn.outerHTML.substring(0, 400) };
        })()`;

        for (const conn of conns) {
            console.log(`Target: ${conn.title}`);
            const ctxIds = conn.contexts.length > 0 ? conn.contexts.map(c => c.id) : [undefined];
            for (const id of ctxIds) {
                const res = await conn.call("Runtime.evaluate", {
                    expression: EXPERIMENT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: id
                });
                if (res?.result?.value && !res.result.value.error) {
                    console.log(JSON.stringify(res.result.value, null, 2));
                    process.exit(0);
                }
            }
        }
    } catch (e) {
        console.error('Fatal:', e);
    }
}

test();
