/**
 * Antigravity UI 定位診斷腳本 (Find UI Element v4)
 * 目的: 科學定位 Accept all 等按鈕的實際所在 Target 與 Context
 */

import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function deepSearch() {
    console.log("-----------------------------------------");
    console.log("🔍 [V4-FIND] 開始全域 UI 定位掃描...");
    console.log("-----------------------------------------");

    const instances = await findAllInstances();
    if (instances.length === 0) {
        console.error("❌ 未發現任何活動中的 Antigravity 實體 (請確認 --remote-debugging-port 已開啟)");
        return;
    }

    const TARGET_KEYWORDS = ["Accept all", "Allow Once", "Allow This Conversation", "Review Changes", "Reject all"];

    for (const inst of instances) {
        console.log(`\n📡 檢查 Port ${inst.port}...`);
        
        for (const target of inst.targets) {
            try {
                const cdp = await connectCDP(target.url);
                console.log(`   - 🎯 Target: ${target.title} (${target.url.substring(0, 50)}...)`);
                
                // 獲取所有 Contexts
                const contexts = (cdp.contexts && cdp.contexts.length > 0) ? cdp.contexts : [{ id: undefined }];
                
                for (const ctx of contexts) {
                    const SEARCH_SCRIPT = `(() => {
                        const findClickable = (root = document) => {
                            let found = [];
                            try {
                                const elements = Array.from(root.querySelectorAll('*'));
                                elements.forEach(el => {
                                    const text = (el.innerText || el.textContent || "").trim();
                                    const aria = (el.getAttribute('aria-label') || "").trim();
                                    
                                    if (${JSON.stringify(TARGET_KEYWORDS)}.some(k => text.includes(k) || aria.includes(k))) {
                                        found.push({
                                            tag: el.tagName,
                                            text: text.substring(0, 30),
                                            html: el.outerHTML.substring(0, 200),
                                            rect: el.getBoundingClientRect().toJSON(),
                                            visible: el.offsetHeight > 0
                                        });
                                    }

                                    if (el.shadowRoot) found = found.concat(findClickable(el.shadowRoot));
                                });
                            } catch (e) { }
                            return found;
                        };
                        return findClickable();
                    })()`;

                    const res = await cdp.call("Runtime.evaluate", { expression: SEARCH_SCRIPT, returnByValue: true, contextId: ctx.id });
                    const matches = res?.result?.value;
                    
                    if (matches && matches.length > 0) {
                        console.log(`     ✅ [MATCH] 於 Context ${ctx.id} 找到 ${matches.length} 個目標:`);
                        matches.forEach(m => {
                            console.log(`        > [${m.tag}] "${m.text}" | 可見: ${m.visible}`);
                            console.log(`          HTML: ${m.html}`);
                            console.log("          --------------------------------------");
                        });
                    }
                }
                cdp.close();
            } catch (e) {
                console.error(`     ❌ 連接失敗: ${e.message}`);
            }
        }
    }
    console.log("\n-----------------------------------------");
    console.log("🏁 掃描結束。");
}

deepSearch();
