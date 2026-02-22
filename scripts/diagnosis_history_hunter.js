import { findAllInstances } from '../core/cdp_manager.js';
import { connectCDP } from '../core/cdp_manager.js';

async function historyHunter() {
    console.log(`\n🕵️ [History Hunter] Starting Global Search for Chat History...`);
    const instances = await findAllInstances();

    for (const inst of instances) {
        console.log(`\n📦 Checking Port: ${inst.port}`);

        for (const target of inst.targets) {
            console.log(`  🔍 Target: ${target.title} (${target.url.substring(0, 50)}...)`);
            try {
                const conn = await connectCDP(target.url);

                // 掃描這個 Target 的所有 Contexts
                for (const ctx of conn.contexts) {
                    const EXP = `(() => {
                        // 找尋所有可能是對話標題的元素
                        const elements = Array.from(document.querySelectorAll('div, a, span, p, li'))
                            .filter(el => {
                                const t = el.innerText.trim();
                                const hasLongText = t.split(' ').length > 2 || t.length > 20;
                                return el.offsetParent !== null && hasLongText && t.length < 200;
                            })
                            .map(el => el.innerText.trim());
                        
                        // 檢查常見的歷史紀錄特徵關鍵字
                        const keywords = ['Yesterday', 'Last 7 Days', 'Previous', 'Chat History', 'Conversation'];
                        const hasKeywords = document.body.innerText.match(/Yesterday|Today|Previous|Chat History/i);
                        
                        return {
                            count: elements.length,
                            hasKeywords: !!hasKeywords,
                            samples: elements.slice(0, 20)
                        };
                    })()`;

                    const res = await conn.call('Runtime.evaluate', {
                        expression: EXP,
                        contextId: ctx.id,
                        returnByValue: true
                    });

                    const data = res && res.result ? res.result.value : null;
                    if (data && (data.hasKeywords || data.count > 10)) {
                        console.log(`    ✅ [HIT!] Context ${ctx.id}: Found ${data.count} potential items.`);
                        if (data.hasKeywords) console.log(`    🌟 Keywords detected in this context!`);
                        console.log(`    📝 Sample items:`);
                        data.samples.slice(0, 10).forEach(s => console.log(`       - "${s.substring(0, 80)}"`));
                    }
                }
                conn.close();
            } catch (e) {
                console.log(`    ❌ Error connecting/eval: ${e.message}`);
            }
        }
    }
    console.log(`\n🏁 [History Hunter] Search Complete.`);
}

historyHunter();
