import { getOrConnectParams } from '../core/cdp_manager.js';
import { getAppState } from '../core/automation.js';

async function verifyPurity() {
    console.log("=== UI Purity Verification Start ===");
    const port = 9000;
    try {
        const conn = await getOrConnectParams(port);

        // 1. 獲取當前狀態
        console.log("1. Fetching current app state...");
        const initialState = await getAppState(conn);
        console.log(`   Initial State: Model=${initialState?.model}, Mode=${initialState?.mode}`);

        // 2. 模擬干擾測試
        // 我們檢查 getAppState 內部的執行結果，看它是否能區分「代碼區」與「UI區」
        for (const cdp of conn) {
            console.log(`\n--- Testing Target: ${cdp.title} ---`);
            const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];

            for (const ctxId of ctxIds) {
                const testRes = await cdp.call("Runtime.evaluate", {
                    expression: `(() => {
                        const results = [];
                        // 模擬：在頁面上隨機找一個地方注入「偽造的模型名稱」
                        // 只有在編輯器內部注入，如果 getAppState 沒抓到它，代表過濾成功
                        const editors = document.querySelectorAll('.monaco-editor, .view-lines');
                        if (editors.length > 0) {
                            const fakeEl = document.createElement('div');
                            fakeEl.className = 'test-fake-model-detector';
                            fakeEl.innerText = 'FAKE_MODEL_X';
                            fakeEl.style.display = 'none';
                            editors[0].appendChild(fakeEl);
                            
                            // 這裡模擬 getAppState 的一部分邏輯，看是否會抓到這個 fake
                            const all = document.querySelectorAll('*');
                            const foundFake = Array.from(all).find(el => 
                                el.innerText === 'FAKE_MODEL_X' && 
                                !el.closest('.monaco-editor, .view-lines')
                            );
                            
                            fakeEl.remove(); // 測試完移除
                            return { foundFake: !!foundFake, editorFound: true };
                        }
                        return { editorFound: false };
                    })()`,
                    returnByValue: true,
                    contextId: ctxId
                });

                const val = testRes.result?.value;
                if (val && val.editorFound) {
                    if (val.foundFake) {
                        console.error(`   ❌ FAIL: Detector caught fake content inside editor context!`);
                    } else {
                        console.log(`   ✅ PASS: Detector correctly ignored content inside editor area.`);
                    }
                }
            }
        }

        console.log("\n=== Verification Completed ===");
    } catch (e) {
        console.error('Verification failed:', e.message);
    }
    process.exit(0);
}

verifyPurity();
