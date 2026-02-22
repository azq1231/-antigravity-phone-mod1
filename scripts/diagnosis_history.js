import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseHistory(port = 9000) {
    console.log(`\n--- [Diagnosis] Checking Port ${port} History DOM ---`);
    try {
        const cdpList = await getOrConnectParams(port);
        if (!cdpList || cdpList.length === 0) {
            console.error('❌ No active CDP connections found on this port.');
            return;
        }

        for (const cdp of cdpList) {
            console.log(`\nChecking Target: ${cdp.title || 'Untitled'}`);
            for (const ctx of cdp.contexts) {
                console.log(`  Context ID: ${ctx.id}, Name: ${ctx.name || 'default'}`);

                const EXP = `(() => {
                    const results = {
                        title: document.title,
                        url: window.location.href,
                        bodyTextPreview: document.body.innerText.substring(0, 500).replace(/\\n/g, ' '),
                        allButtons: Array.from(document.querySelectorAll('button, a, [role="link"]'))
                            .map(el => ({ 
                                tag: el.tagName, 
                                class: el.className, 
                                text: el.innerText.trim(),
                                visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
                            }))
                            .filter(b => b.text.length > 2)
                            .slice(0, 20),
                        historySelectors: {
                            sidebar: !!document.querySelector('nav, [class*="sidebar"]'),
                            conversationList: !!document.querySelector('[class*="history-list"], [class*="ConversationList"]'),
                        }
                    };
                    return results;
                })()`;

                try {
                    const res = await cdp.ws.sendPromise('Runtime.evaluate', {
                        expression: EXP,
                        contextId: ctx.id,
                        returnByValue: true
                    });

                    if (res && res.result && res.result.value) {
                        const val = res.result.value;
                        console.log(`    📍 Title: ${val.title}`);
                        console.log(`    📍 URL: ${val.url}`);
                        console.log(`    📍 Sidebar Present: ${val.historySelectors.sidebar}`);
                        console.log(`    📍 ConvList Present: ${val.historySelectors.conversationList}`);
                        console.log(`    📍 Top 10 Interactive Elements:`);
                        val.allButtons.slice(0, 10).forEach(b => {
                            console.log(`       - [${b.tag}] "${b.text}" (Visible: ${b.visible}, Class: ${b.class})`);
                        });

                        // 關鍵分析：如果文字包含 "New Chat" 但不包含具體的對話標題，說明這可能只是主框架
                        const hasHistoryItems = val.allButtons.some(b => b.text.length > 10 && !b.text.includes('New Chat'));
                        console.log(`    🔍 Potential History Items Found: ${hasHistoryItems}`);
                    }
                } catch (e) {
                    console.log(`    ⚠️ Eval error in context ${ctx.id}: ${e.message}`);
                }
            }
        }
    } catch (err) {
        console.error('💥 Diagnosis Failed:', err);
    }
}

// 執行診斷
diagnoseHistory(9000);
