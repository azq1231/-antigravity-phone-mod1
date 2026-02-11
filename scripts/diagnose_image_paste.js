
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseImagePaste() {
    console.log('[DIAGNOSE] Connecting to Port 9000...');
    try {
        const conn = await getOrConnectParams(9000);

        // Handle potential array return
        const cdpList = Array.isArray(conn) ? conn : [conn];

        // Define the diagnostic script to run inside browser
        const BROWSER_SCRIPT = `(async () => {
            const result = {
                step: 'init',
                logs: [],
                editorFound: false,
                pasteStatus: 'not_attempted'
            };
            
            function log(msg) { result.logs.push(msg); }

            try {
                // 1. Identify Editor Candidates
                log('Scanning for editors...');
                const candidates = Array.from(document.querySelectorAll(\`[data-lexical-editor="true"], textarea, div[contenteditable="true"]\`));
                
                result.candidates = candidates.map(el => ({
                    tag: el.tagName,
                    id: el.id,
                    className: el.className,
                    visible: el.offsetParent !== null,
                    lexical: el.getAttribute('data-lexical-editor')
                }));
                
                log(\`Found \${candidates.length} candidates\`);

                // 2. Select Target (Logic from previous attempts)
                const target = candidates.find(el => el.offsetParent !== null && (el.tagName === 'TEXTAREA' || el.getAttribute('data-lexical-editor')));
                
                if (!target) {
                    log('No suitable editor target found.');
                    return result;
                }

                result.editorFound = true;
                result.targetInfo = { tag: target.tagName, id: target.id };
                log(\`Selected target: \${target.tagName}#\${target.id}\`);

                // 3. Attempt Paste Simulation 
                target.focus();
                log('Focused target.');

                // Create dummy file
                const base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
                const res = await fetch(base64);
                const blob = await res.blob();
                const file = new File([blob], "diagnostic_pixel.png", { type: "image/png" });
                
                const dt = new DataTransfer();
                dt.items.add(file);
                
                log('Prepared DataTransfer with file.');

                // Hook event listener to see if event bubbles
                let eventCaught = false;
                const listener = (e) => {
                    eventCaught = true;
                    log(\`Event caught by listener. Type: \${e.type}, Files: \${e.clipboardData?.files?.length}\`);
                };
                target.addEventListener('paste', listener);

                const evt = new ClipboardEvent("paste", {
                    clipboardData: dt,
                    bubbles: true,
                    cancelable: true, 
                    composed: true
                });
                
                const dispatched = target.dispatchEvent(evt); // Returns false if prevented
                log(\`Dispatch result: \${dispatched}\`);
                
                target.removeEventListener('paste', listener);
                result.pasteStatus = eventCaught ? 'event_fired_and_caught' : 'event_fired_but_missed';

                // Check for DOM changes (naive check)
                await new Promise(r => setTimeout(r, 200));
                const imgs = document.querySelectorAll('img');
                result.imgCountAfter = imgs.length;

            } catch (e) {
                log(\`Error: \${e.toString()}\`);
                result.error = e.toString();
            }
            
            return result;
        })()`;

        // Execute on all contexts
        for (const cdp of cdpList) {
            const contexts = cdp.contexts || [];
            console.log(`[DIAGNOSE] Checking ${contexts.length} contexts on connection...`);

            for (const ctx of contexts) {
                console.log(`[DIAGNOSE] Running in context ${ctx.id}...`);
                try {
                    const res = await cdp.call("Runtime.evaluate", {
                        expression: BROWSER_SCRIPT,
                        returnByValue: true,
                        awaitPromise: true,
                        contextId: ctx.id
                    });

                    if (res.result.value) {
                        console.log('--- DIAGNOSTIC REPORT ---');
                        console.log(JSON.stringify(res.result.value, null, 2));
                        console.log('-------------------------');
                    }
                } catch (e) {
                    console.error(`[DIAGNOSE] Failed in context ${ctx.id}:`, e.message);
                }
            }
        }

    } catch (e) {
        console.error('[DIAGNOSE] Fatal error:', e);
    }
    process.exit(0);
}

diagnoseImagePaste();
