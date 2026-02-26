
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function runSanityCheck() {
    console.log('--- [Sanity Check] Verifying server_v4.js Integrity ---');
    let errors = 0;

    const serverPath = join(rootDir, 'server_v4.js');
    if (!fs.existsSync(serverPath)) {
        console.error('❌ Error: server_v4.js not found!');
        process.exit(1);
    }

    const content = fs.readFileSync(serverPath, 'utf8');

    // 1. 檢查是否匯入了 getAppState
    const importRegex = /import\s+{[^}]*getAppState[^}]*}\s+from\s+['"]\.\/core\/automation\.js['"]/i;
    if (importRegex.test(content)) {
        console.log('✅ Found: getAppState import in automation.js reference');
    } else {
        console.error('❌ Error: getAppState is NOT imported from ./core/automation.js');
        errors++;
    }

    // 2. 檢查 APP_VERSION 定義
    if (content.includes('const APP_VERSION')) {
        console.log('✅ Found: APP_VERSION definition');
    } else {
        console.error('❌ Error: APP_VERSION is not defined (Missing reference for syncAppState)');
        errors++;
    }

    // 3. 檢查是否存在基本的語法結構 (基本安全性)
    try {
        // 簡單的關鍵字檢查
        const requiredKeywords = ['express', 'http', 'WebSocketServer', 'createServer'];
        requiredKeywords.forEach(k => {
            if (!content.includes(k)) {
                console.error(`❌ Error: Critical keyword "${k}" is missing`);
                errors++;
            }
        });
    } catch (e) { }

    console.log('\n--- [Result] ---');
    if (errors === 0) {
        console.log('🟢 PASS: Server integrity check successful.');
        process.exit(0);
    } else {
        console.error(`🔴 FAIL: Found ${errors} critical issues in server_v4.js.`);
        process.exit(1);
    }
}

runSanityCheck();
