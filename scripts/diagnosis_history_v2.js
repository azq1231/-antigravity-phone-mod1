import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseHistorySimple(port = 9000) {
    console.log(`\n--- [Diagnosis] Scanning Port ${port} ---`);
    const cdpList = await getOrConnectParams(port);

    for (const cdp of cdpList) {
        if (cdp.title.includes('Launchpad')) continue;
        console.log(`\nTarget: ${cdp.title}`);

        for (const ctx of cdp.contexts) {
            console.log(`  Context: ${ctx.id} (${ctx.name || 'main'})`);

            // 嘗試獲取所有按鈕文字，看看歷史紀錄在哪個 Context
            const EXP = `JSON.stringify(Array.from(document.querySelectorAll('a, button, [role="link"], .history-item, [class*="Conversation"]'))
                .map(el => el.innerText.trim())
                .filter(t => t.length > 2)
                .slice(0, 30))`;

            try {
                const res = await cdp.ws.sendPromise('Runtime.evaluate', {
                    expression: EXP,
                    contextId: ctx.id,
                    returnByValue: true
                });

                const texts = JSON.parse(res.result.value || '[]');
                console.log(`    Texts: ${texts.join(' | ').substring(0, 300)}...`);
            } catch (e) {
                console.log(`    Error: ${e.message}`);
            }
        }
    }
}

diagnoseHistorySimple(9000);
