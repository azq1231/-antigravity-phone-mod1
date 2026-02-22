import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseHistoryCorrect(port = 9000) {
    console.log(`\n--- [Diagnosis] Scanning Port ${port} ---`);
    const cdpList = await getOrConnectParams(port);

    for (const cdp of cdpList) {
        if (cdp.title.includes('Launchpad')) continue;
        console.log(`\nTarget: ${cdp.title}`);

        for (const ctx of cdp.contexts) {
            console.log(`  Context: ${ctx.id} (${ctx.name || 'main'})`);

            const EXP = `(() => {
                const els = Array.from(document.querySelectorAll('a, button, [role="link"], .history-item, [class*="Conversation"]'));
                return els.map(el => el.innerText.trim()).filter(t => t.length > 2).slice(0, 20);
            })()`;

            try {
                const res = await cdp.call('Runtime.evaluate', {
                    expression: EXP,
                    contextId: ctx.id,
                    returnByValue: true
                });

                const texts = res && res.result ? res.result.value : [];
                console.log(`    Texts: ${texts.join(' | ')}`);
            } catch (e) {
                console.log(`    Error: ${e.message}`);
            }
        }
    }
}

diagnoseHistoryCorrect(9000);
