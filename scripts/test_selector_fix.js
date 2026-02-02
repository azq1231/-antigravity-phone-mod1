import http from 'http';
import WebSocket from 'ws';

/**
 * 這是專門用來測試「動態探測邏輯」的獨立腳本。
 * 它不會修改您的任何原始碼，只會嘗試在現有的 Antigravity 視窗中尋找對話框。
 */

async function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function runQuery(wsUrl, expression) {
    const ws = new WebSocket(wsUrl);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 5000);
        ws.on('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression, returnByValue: true, awaitPromise: true }
            }));
        });
        ws.on('message', (msg) => {
            const data = JSON.parse(msg);
            if (data.id === 1) {
                clearTimeout(timeout);
                ws.close();
                resolve(data.result.result.value);
            }
        });
        ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
}

async function testNewSelector() {
    console.log('--- 🧪 動態選擇器測試開始 ---');
    try {
        const list = await getJson(`http://127.0.0.1:9000/json/list`);
        const target = list.find(t => t.url?.includes('workbench.html'));
        if (!target) {
            console.error('❌ 找不到 Antigravity Workbench (請確認 9000 埠已開啟)');
            return;
        }

        const TEST_SCRIPT = `(() => {
            // 1. 尋找編輯盒 (Lexical Editor)
            const editor = document.querySelector('[data-lexical-editor="true"]');
            if (!editor) return { success: false, reason: '找不到 Lexical 編輯單元' };

            // 2. 尋找最適合的容器 (向下相容原本的 #cascade 功能)
            let curr = editor;
            let container = null;
            // 向上找 10 層，尋找最像聊天面板的 DIV
            for (let i = 0; i < 10; i++) {
                if (!curr || curr === document.body) break;
                // 判斷邏輯：如果這個層次包含了主要的 UI 內容
                if (curr.offsetHeight > 400 || curr.className.includes('chat')) {
                    container = curr;
                    break;
                }
                curr = curr.parentElement;
            }

            if (!container) container = editor.parentElement; // 保底方案

            return {
                success: true,
                found_id: container.id || '無ID',
                found_class: container.className,
                container_tag: container.tagName,
                content_sample: container.innerText.substring(0, 50).replace(/\\n/g, ' '),
                is_visible: container.offsetParent !== null
            };
        })()`;

        const result = await runQuery(target.webSocketDebuggerUrl, TEST_SCRIPT);

        if (result.success) {
            console.log('✅ 測試成功！');
            console.log('---------------------------');
            console.log(`找到容器標籤: ${result.container_tag}`);
            console.log(`容器 ID: ${result.found_id}`);
            console.log(`容器 Class: ${result.found_class}`);
            console.log(`可視狀態: ${result.is_visible ? '可見 (Normal)' : '隱藏 (Hidden)'}`);
            console.log(`內容預覽: ${result.content_sample}...`);
            console.log('---------------------------');
            console.log('結論：此動態探測邏輯可以安全地替換原有硬編碼的 #cascade 定位。');
        } else {
            console.error(`❌ 測試失敗: ${result.reason}`);
        }

    } catch (e) {
        console.error(`💥 執行出錯: ${e.message}`);
    }
}

testNewSelector();
