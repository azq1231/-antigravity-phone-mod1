#!/usr/bin/env node
/**
 * 診斷腳本: 測試訊息發送功能
 * 用途: 檢查為什麼無法發送訊息
 */

import http from 'http';

const SERVER_PORT = process.env.PORT || 3000;
const TEST_PORT = process.argv[2] || 9000;
const TEST_MESSAGE = process.argv[3] || '測試訊息';

console.log('=== 訊息發送診斷工具 ===');
console.log(`目標伺服器: http://localhost:${SERVER_PORT}`);
console.log(`目標 Port: ${TEST_PORT}`);
console.log(`測試訊息: "${TEST_MESSAGE}"`);
console.log('');

// 步驟 1: 檢查伺服器狀態
async function checkServerStatus() {
    console.log('📡 [步驟 1] 檢查伺服器狀態...');
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${SERVER_PORT}/snapshot?port=${TEST_PORT}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('✅ 伺服器運行正常');
                    console.log(`   狀態碼: ${res.statusCode}`);
                    resolve(true);
                } else if (res.statusCode === 503) {
                    console.log('⚠️  CDP 未連線 (503)');
                    console.log('   可能原因: Antigravity 未在 Port ' + TEST_PORT + ' 運行');
                    resolve(false);
                } else {
                    console.log(`⚠️  異常狀態碼: ${res.statusCode}`);
                    resolve(false);
                }
            });
        });
        req.on('error', (e) => {
            console.log('❌ 伺服器無法連線:', e.message);
            reject(e);
        });
        req.setTimeout(5000, () => {
            req.destroy();
            console.log('❌ 連線逾時');
            reject(new Error('Timeout'));
        });
    });
}

// 步驟 2: 嘗試發送訊息
async function sendTestMessage() {
    console.log('\n📤 [步驟 2] 嘗試發送測試訊息...');
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ message: TEST_MESSAGE });

        const options = {
            hostname: 'localhost',
            port: SERVER_PORT,
            path: `/send?port=${TEST_PORT}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log(`   狀態碼: ${res.statusCode}`);
                    console.log('   回應:', JSON.stringify(result, null, 2));

                    if (result.success) {
                        console.log('✅ 訊息發送成功!');
                        console.log(`   方法: ${result.method}`);
                    } else {
                        console.log('❌ 訊息發送失敗');
                        if (result.details) {
                            console.log('   詳細資訊:', JSON.stringify(result.details, null, 2));

                            // 診斷具體錯誤
                            if (result.details.reason === 'busy') {
                                console.log('\n🔍 診斷: Antigravity 正在生成回應 (busy)');
                                console.log('   建議: 等待當前回應完成後再試');
                            } else if (result.details.error === 'editor_not_found') {
                                console.log('\n🔍 診斷: 找不到編輯器元素 (editor_not_found)');
                                console.log('   建議: 檢查 Antigravity 介面是否正常顯示');
                            } else if (result.details.reason === 'no_context') {
                                console.log('\n🔍 診斷: CDP 執行上下文遺失 (no_context)');
                                console.log('   建議: 重新啟動 Antigravity 或伺服器');
                            }
                        }
                    }
                    resolve(result);
                } catch (e) {
                    console.log('❌ 無法解析回應:', data);
                    reject(e);
                }
            });
        });

        req.on('error', (e) => {
            console.log('❌ 請求失敗:', e.message);
            reject(e);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            console.log('❌ 請求逾時');
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

// 步驟 3: 檢查 CDP 連線詳情
async function checkCDPDetails() {
    console.log('\n🔌 [步驟 3] 檢查 CDP 連線詳情...');
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${TEST_PORT}/json/list`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data);
                    console.log(`   找到 ${targets.length} 個 CDP 目標`);

                    const workbench = targets.find(t => t.url?.includes('workbench.html'));
                    const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);

                    if (workbench) {
                        console.log('✅ 找到 workbench.html');
                        console.log(`   標題: ${workbench.title}`);
                        console.log(`   URL: ${workbench.url}`);
                    } else if (page) {
                        console.log('⚠️  未找到 workbench.html,但有 page 類型目標');
                        console.log(`   標題: ${page.title}`);
                        console.log(`   類型: ${page.type}`);
                    } else {
                        console.log('❌ 未找到有效的 CDP 目標');
                        console.log('   所有目標:', JSON.stringify(targets.map(t => ({
                            type: t.type,
                            title: t.title,
                            url: t.url?.substring(0, 50)
                        })), null, 2));
                    }
                    resolve(targets);
                } catch (e) {
                    console.log('❌ 無法解析 CDP 目標列表');
                    reject(e);
                }
            });
        }).on('error', (e) => {
            console.log('❌ 無法連線到 CDP (Port ' + TEST_PORT + ')');
            console.log('   錯誤:', e.message);
            console.log('   可能原因: Antigravity 未在此 Port 運行');
            reject(e);
        });
    });
}

// 主流程
(async () => {
    try {
        await checkServerStatus();
        await checkCDPDetails();
        await sendTestMessage();

        console.log('\n=== 診斷完成 ===');
        console.log('如果訊息發送失敗,請檢查上方的診斷資訊');

    } catch (e) {
        console.error('\n❌ 診斷過程發生錯誤:', e.message);
        process.exit(1);
    }
})();
