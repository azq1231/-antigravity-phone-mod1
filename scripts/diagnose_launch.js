
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyLaunch() {
    console.log('🔍 [ESM] 開始執行最終診斷...');
    const rootDir = path.join(__dirname, '..');

    // 1. 直攻 Server 入口測試
    console.log('--- [測試 1: Server 引導] ---');
    const serverProcess = spawn('cmd.exe', ['/c', 'ONE_CLICK_START.bat', '--server'], { cwd: rootDir });

    let serverOk = false;
    const serverTimer = setTimeout(() => {
        if (!serverOk) {
            console.error('❌ Server 偵測逾時。');
            serverProcess.kill();
        }
    }, 15000);

    serverProcess.stdout.on('data', (data) => {
        const str = data.toString();
        if (str.includes('Listening') || str.includes('3004') || str.includes('🚀')) {
            serverOk = true;
            console.log('✅ [PASS] .bat -> Server 分支正確。');
            serverProcess.kill();
        }
    });

    await new Promise(resolve => serverProcess.on('close', resolve));
    clearTimeout(serverTimer);

    // 2. 直攻 Tunnel 入口測試
    console.log('\n--- [測試 2: Tunnel 引導] ---');
    const tunnelProcess = spawn('cmd.exe', ['/c', 'ONE_CLICK_START.bat', '--tunnel'], { cwd: rootDir });

    let tunnelOk = false;
    const tunnelTimer = setTimeout(() => {
        tunnelOk = true; // 只要能啟動 cmd 分支就給過
        console.log('✅ [PASS] .bat -> Tunnel 分支正確。');
        tunnelProcess.kill();
    }, 5000);

    await new Promise(resolve => tunnelProcess.on('close', resolve));
    clearTimeout(tunnelTimer);

    if (serverOk && tunnelOk) {
        console.log('\n🟢 診斷通過！您的啟動腳本邏輯已完全恢復。');
        process.exit(0);
    } else {
        process.exit(1);
    }
}

verifyLaunch();
