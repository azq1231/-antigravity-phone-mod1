
import { getOrConnectParams } from '../core/cdp_manager.js';

async function testProSend() {
    const port = 9001;
    const text = "Stable Test " + Date.now();
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;

    const SCRIPT = `(async () => {
        const editor = document.querySelector('[data-lexical-editor="true"][contenteditable="true"]');
        if (!editor) return { error: "no_editor" };
        
        editor.focus();
        // Clear first
        editor.innerHTML = '<p dir="ltr"><br></p>';
        return { ok: true };
    })()`;

    await cdp.call("Runtime.evaluate", { expression: SCRIPT, awaitPromise: true });
    
    // Insert text
    await cdp.call('Input.insertText', { text: text });
    
    // Sync state
    const SYNC_SCRIPT = `(() => {
        const editor = document.querySelector('[data-lexical-editor="true"]');
        if (!editor) return;
        
        // Fire events to sync React/Lexical state
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Wait a bit for state to propagate
        return { 
            text: editor.innerText,
            buttonDisabled: document.querySelector('button[data-tooltip-id*="send"]')?.disabled
        };
    })()`;
    
    const syncRes = await cdp.call("Runtime.evaluate", { expression: SYNC_SCRIPT, returnByValue: true });
    console.log('Sync Result:', syncRes.result.value);
    
    // Try Enter
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await new Promise(r => setTimeout(r, 20));
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    
    await new Promise(r => setTimeout(r, 1000));
    
    const checkRes = await cdp.call("Runtime.evaluate", { 
        expression: `document.querySelector('[data-lexical-editor="true"]').innerText`,
        returnByValue: true 
    });
    console.log('Editor after Enter:', JSON.stringify(checkRes.result.value));
    
    if (checkRes.result.value.trim() !== "") {
        console.log('Enter failed to clear editor, trying button click...');
        const CLICK_SCRIPT = `(() => {
            const btn = document.querySelector('button[data-tooltip-id*="send"]') || 
                        Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Send'));
            if (btn && !btn.disabled) {
                btn.click();
                return "clicked";
            }
            return "failed_or_disabled";
        })()`;
        const clickRes = await cdp.call("Runtime.evaluate", { expression: CLICK_SCRIPT, returnByValue: true });
        console.log('Click result:', clickRes.result.value);
    } else {
        console.log('Enter successfully cleared editor.');
    }
    
    process.exit(0);
}

testProSend();
