import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnoseHistoryDeep(port = 9000) {
    console.log(`\n--- [Deep Diagnosis] Deep Scanning Port ${port} ---`);
    const cdpList = await getOrConnectParams(port);

    for (const cdp of cdpList) {
        // 排除明顯無關的頁面
        if (cdp.title.includes('Launchpad')) continue;
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🎯 Target: ${cdp.title}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        for (const ctx of cdp.contexts) {
            console.log(`\n  [Context ID: ${ctx.id}]`);

            // 該腳本會遍歷當前 Context 下的所有 Frame 並尋找歷史紀錄特徵
            const EXP = `(async () => {
                const results = [];
                
                function scanFrame(win, depth = 0) {
                    try {
                        const path = depth === 0 ? "top" : "frame_" + depth;
                        const doc = win.document;
                        
                        // 1. 尋找可能的歷史列表容器
                        const containers = Array.from(doc.querySelectorAll('div, nav, ul'))
                            .filter(el => {
                                const cls = el.className.toLowerCase();
                                return cls.includes('history') || cls.includes('conversation') || cls.includes('list');
                            })
                            .map(el => ({ tag: el.tagName, class: el.className, textLen: el.innerText.length }));

                        // 2. 尋找列表項文字 (核心)
                        const items = Array.from(doc.querySelectorAll('div, a, span, li'))
                            .filter(el => {
                                const text = el.innerText.trim();
                                // 過濾掉太短（導航按鈕）或太長（正文）的內容
                                return text.length > 5 && text.length < 150 && el.offsetParent !== null;
                            })
                            .map(el => el.innerText.trim());

                        results.push({
                            depth,
                            url: win.location.href,
                            containers: containers.slice(0, 3),
                            textSample: items.slice(0, 15)
                        });

                        // 遞迴掃描子 Frame
                        for (let i = 0; i < win.frames.length; i++) {
                            scanFrame(win.frames[i], depth + 1);
                        }
                    } catch (e) {
                        // 跨域 iframe 會報錯，這是預期的
                    }
                }

                scanFrame(window);
                return JSON.stringify(results);
            })()`;

            try {
                const res = await cdp.call('Runtime.evaluate', {
                    expression: EXP,
                    contextId: ctx.id,
                    returnByValue: true,
                    awaitPromise: true
                });

                const frames = JSON.parse(res.result.value || '[]');
                frames.forEach(f => {
                    if (f.textSample.length === 0) return;
                    console.log(`    📍 Frame Depth: ${f.depth}`);
                    console.log(`    📍 URL: ${f.url}`);
                    if (f.containers.length > 0) {
                        console.log(`    📍 Found Containers: ${f.containers.map(c => c.class).join(' | ')}`);
                    }
                    console.log(`    📍 Sample Texts:`);
                    // 尋找看起來像對話標題的文字
                    const meaningfulItems = f.textSample.filter(t => t.split(' ').length > 1 || t.length > 10);
                    meaningfulItems.slice(0, 8).forEach(t => console.log(`       - "${t}"`));
                });
            } catch (e) {
                console.log(`    ⚠️ Eval failed: ${e.message}`);
            }
        }
    }
}

diagnoseHistoryDeep(9000);
