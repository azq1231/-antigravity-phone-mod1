
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    console.log('--- 🚀 Image Injection Scientific Diagnosis ---');
    const port = 9001; // 測試端口
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;

    const SCRIPT = `(async () => {
        const results = [];
        const log = (m) => results.push(\`[\${new Date().toISOString().split('T')[1]}] \${m}\`);
        
        let target = [...document.querySelectorAll('[data-lexical-editor="true"]')].at(-1);
        if (!target) return "No editor found";

        // 觀察者：監控圖片數量變化
        let imgCount = 0;
        const observer = new MutationObserver(() => {
            const current = document.querySelectorAll('img').length;
            if (current !== imgCount) {
                log(\`DOM Changed: Img count is now \${current}\`);
                imgCount = current;
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        log('Starting Diagnosis Sequence...');
        
        // 模擬數據
        const dt = new DataTransfer();
        dt.setData('text/plain', 'DIAGNOSIS_TEST_TEXT');
        
        log('Action: Dispatching Paste Event...');
        target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
        
        await new Promise(r => setTimeout(r, 500));
        
        log('Action: Dispatching BeforeInput Event...');
        target.dispatchEvent(new InputEvent('beforeinput', { dataTransfer: dt, inputType: 'insertFromPaste', bubbles: true }));

        await new Promise(r => setTimeout(r, 2000));
        
        log('Final Check: TextContent contains "DIAGNOSIS_TEST_TEXT"? ' + target.innerText.includes('DIAGNOSIS_TEST_TEXT'));
        log('Final Check: Images in DOM: ' + document.querySelectorAll('img').length);
        
        observer.disconnect();
        return results;
    })()`;

    try {
        const res = await cdp.call("Runtime.evaluate", {
            expression: SCRIPT,
            returnByValue: true,
            awaitPromise: true
        });
        console.log('Diagnosis Logs:');
        res.result.value.forEach(l => console.log('  ' + l));
    } catch (e) {
        console.error('Diagnosis Error:', e.message);
    }
}

diagnose();
