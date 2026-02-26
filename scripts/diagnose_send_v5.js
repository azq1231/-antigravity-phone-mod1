#!/usr/bin/env node
import WebSocket from 'ws';
import http from 'http';

const PORT = 9001; // 鎖定問題發生的 9001 埠號

async function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function runDiagnosis() {
    console.log(`🚀 開始針對 Port ${PORT} 進行「發送鎖死」深度穿透偵測...`);

    const targets = await getJson(`http://127.0.0.1:${PORT}/json`);
    const target = targets.find(t => t.webSocketDebuggerUrl && !t.url.includes('extension'));

    if (!target) {
        console.log('❌ 找不到有效的偵錯目標，請確認 VS Code 視窗是否開啟且位於 Port 9001');
        return;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.on('open', async () => {
        const call = (method, params) => new Promise(res => {
            const id = Math.floor(Math.random() * 100000);
            const onMsg = (msg) => {
                const data = JSON.parse(msg);
                if (data.id === id) {
                    ws.off('message', onMsg);
                    res(data.result);
                }
            };
            ws.on('message', onMsg);
            ws.send(JSON.stringify({ id, method, params }));
        });

        await call('Runtime.enable');

        const script = `(async () => {
            const report = [];
            const log = (m) => report.push(m);

            // 1. 尋找編輯器
            const editor = document.querySelector('[data-lexical-editor="true"]');
            if (!editor) return { error: '找不到編輯器' };
            log('✅ 找到 Lexical 編輯器');

            // 2. 獲取所有發送按鈕候選者
            const findButtons = () => {
                return Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
                    const txt = (b.innerText + b.getAttribute('aria-label') + b.title).toLowerCase();
                    return (txt.includes('send') || txt.includes('發送') || b.querySelector('svg'));
                });
            };

            const targetBtn = findButtons().find(b => b.innerText.includes('Send') || b.querySelector('[class*="arrow-right"]'));
            if (!targetBtn) return { error: '找不到發送粉按鈕' };
            
            log('初步偵測按鈕狀態: Disabled=' + targetBtn.disabled);

            // 3. 測試：填入測試內容並觀察狀態變化
            log('--- 執行填入測試 ---');
            const testText = "Diagnosis_Test_" + Date.now();
            
            // 模擬一連串事件
            editor.focus();
            editor.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
            document.execCommand('insertText', false, testText);
            editor.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data: testText}));
            editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data: testText}));
            
            await new Promise(r => setTimeout(r, 200));
            log('填入後按鈕狀態: Disabled=' + targetBtn.disabled);

            // 4. 偵測按鈕是否被「隱形層」遮住？
            const rect = targetBtn.getBoundingClientRect();
            const elAtPoint = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
            log('按鈕中心點處的元素: ' + (elAtPoint ? (elAtPoint.tagName + '.' + elAtPoint.className.substring(0,30)) : 'NULL'));
            
            if (elAtPoint && !targetBtn.contains(elAtPoint) && elAtPoint !== targetBtn) {
                log('⚠️ 警告：發送按鈕可能被 ' + elAtPoint.tagName + ' 遮擋了！');
            }

            // 5. 檢視按鈕上的 Event Listeners (這需要控制台權限，這裡用模擬點擊測試)
            log('嘗試點擊...');
            try {
                targetBtn.click();
                log('點擊指令已發送');
            } catch(e) {
                log('點擊發生錯誤: ' + e.message);
            }

            return { log: report, btnHtml: targetBtn.outerHTML.substring(0, 300) };
        })()`;

        const res = await call('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
        console.log('\n--- 深度診斷報告 ---');
        if (res?.result?.value) {
            if (res.result.value.log) {
                res.result.value.log.forEach(l => console.log('  > ' + l));
            }
            if (res.result.value.error) console.log('  ❌ 錯誤: ' + res.result.value.error);
            console.log('\n--- 按鈕 HTML 結構 ---');
            console.log(res.result.value.btnHtml || 'N/A');
        } else {
            console.log('未能獲取診斷結果：', JSON.stringify(res));
        }

        ws.close();
        process.exit(0);
    });

    ws.on('error', (e) => {
        console.log('連線錯誤:', e.message);
        process.exit(1);
    });
}

runDiagnosis();
