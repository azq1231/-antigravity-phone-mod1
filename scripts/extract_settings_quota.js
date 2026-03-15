
import { getOrConnectParams } from '../core/cdp_manager.js';

async function extractSettingsQuota() {
    const port = 9001;
    try {
        const cdpList = await getOrConnectParams(port);
        for (const cdp of cdpList) {
            const SCRIPT = `(() => {
                const text = document.body.innerText;
                const creditsMatch = text.match(/Available AI Credits:\\s*(\\d+)/i);
                const quotaFull = text.includes('MODEL QUOTA') ? text.split('MODEL QUOTA')[1]?.substring(0, 1000) : "N/A";
                return {
                    credits: creditsMatch ? creditsMatch[1] : "N/A",
                    quotaFull: quotaFull
                };
            })()`;
            for (const ctx of cdp.contexts) {
                const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.credits !== "N/A" || res.result?.value?.quotaFull !== "N/A") {
                    console.log(`Target ${cdp.title}:`, JSON.stringify(res.result.value, null, 2));
                }
            }
        }
    } catch (e) { console.error(e); }
}

extractSettingsQuota();
