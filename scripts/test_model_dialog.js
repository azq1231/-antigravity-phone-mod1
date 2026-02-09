
import { getOrConnectParams } from '../core/cdp_manager.js';

async function testModelDialog() {
    const port = 9000;
    console.log(`🔍 Testing Model Dialog on Port ${port}...`);

    try {
        const cdp = await getOrConnectParams(port);

        const SCRIPT = `(async () => {
            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model"];
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                const txt = el.textContent;
                return KNOWN_KEYWORDS.some(k => txt.includes(k));
            });

            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                        if (current.querySelector('svg.lucide-chevron-up') || current.innerText.includes('Model')) {
                            modelBtn = current;
                            break;
                        }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }

            if (!modelBtn) return "Selector button NOT found";
            
            modelBtn.click();
            await new Promise(r => setTimeout(r, 800));
            
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], div'))
                .filter(d => d.offsetHeight > 10 && d.innerText.length > 5);
                
            return {
                dialogCount: dialogs.length,
                contents: dialogs.map(d => ({
                    tag: d.tagName,
                    id: d.id,
                    className: d.className,
                    text: d.innerText.substring(0, 300)
                }))
            };
        })()`;

        const ctx = cdp.contexts[0];
        const res = await cdp.call("Runtime.evaluate", {
            expression: SCRIPT,
            returnByValue: true,
            awaitPromise: true,
            contextId: ctx.id
        });

        console.log(JSON.stringify(res.result.value, null, 2));

    } catch (e) {
        console.error("Test failed:", e);
    }
}

testModelDialog();
