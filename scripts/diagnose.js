import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import http from 'http';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    gray: "\x1b[90m",
    bold: "\x1b[1m"
};

let errorCount = 0;
let warnCount = 0;

function ok(msg) { console.log(`  ${C.green}✅ ${msg}${C.reset}`); }
function fail(msg) { console.log(`  ${C.red}❌ ${msg}${C.reset}`); errorCount++; }
function warn(msg) { console.log(`  ${C.yellow}⚠️ ${msg}${C.reset}`); warnCount++; }
function info(msg) { console.log(`  ${C.gray}ℹ️ ${msg}${C.reset}`); }
function header(n, msg) { console.log(`\n${C.cyan}[${n}] ${msg}${C.reset}`); }

console.log(`${C.bold}${C.cyan}+----------------------------------------------------------+${C.reset}`);
console.log(`${C.bold}${C.cyan}|     Antigravity Phone Fix - Ultimate Diagnostics v5.0   |${C.reset}`);
console.log(`${C.bold}${C.cyan}+----------------------------------------------------------+${C.reset}`);

// ============ 1. Environment Variables ============
header('1/10', 'Environment Variables (.env)');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    ok('.env 檔案存在');
    if (envContent.includes('APP_PASSWORD')) ok('APP_PASSWORD 已設定');
    else warn('APP_PASSWORD 未設定 (可能影響認證)');
    if (envContent.includes('PORT')) ok('PORT 已設定');
    else info('PORT 未設定 (將使用預設 3000)');
} else {
    warn('.env 檔案不存在');
}

// ============ 2. 關鍵檔案存在性 ============
header('2/10', '關鍵檔案完整性');
const keyFiles = [
    'server.js', 'package.json', 'public/index.html', 'public/js/app_multi.js',
    'public/sw.js', 'core/cdp_manager.js', 'core/automation.js',
    'core/instance_manager.js', 'core/utils.js', 'routes/api.js'
];
keyFiles.forEach(f => {
    const fp = path.join(root, f);
    if (fs.existsSync(fp)) {
        const size = fs.statSync(fp).size;
        ok(`${f} (${size} bytes)`);
    } else {
        fail(`缺失: ${f}`);
    }
});

// ============ 3. HTML 資源引用驗證 ============
header('3/10', 'HTML 資源引用驗證');
const indexPath = path.join(root, 'public/index.html');
if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8');
    const srcMatches = html.match(/src=["']([^"']+)["']/g) || [];
    const hrefMatches = html.match(/href=["']([^"']+\.css)["']/g) || [];

    srcMatches.forEach(m => {
        const src = m.match(/["']([^"']+)["']/)[1];
        if (!src.startsWith('http')) {
            const fp = path.join(root, 'public', src);
            if (fs.existsSync(fp)) ok(`Script: ${src}`);
            else fail(`Script 失效: ${src}`);
        }
    });

    hrefMatches.forEach(m => {
        const href = m.match(/["']([^"']+)["']/)[1];
        if (!href.startsWith('http')) {
            const fp = path.join(root, 'public', href);
            if (fs.existsSync(fp)) ok(`CSS: ${href}`);
            else fail(`CSS 失效: ${href}`);
        }
    });
}

// ============ 4. 模組依賴鏈 ============
header('4/10', '模組依賴鏈診斷');
function analyzeDeps(filePath) {
    const fp = path.join(root, filePath);
    if (!fs.existsSync(fp)) return;
    info(`掃描: ${filePath}`);
    const content = fs.readFileSync(fp, 'utf8');
    const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"](.+?)['"]/g;

    // Built-in node modules to ignore
    const builtIns = ['fs', 'path', 'url', 'net', 'http', 'os', 'child_process', 'ws', 'compression', 'cookie-parser'];

    let match;
    while ((match = importRegex.exec(content)) !== null) {
        const funcs = match[1].split(',').map(f => f.trim());
        let relPath = match[2];

        // Skip built-ins and npm packages
        if (builtIns.includes(relPath) || (!relPath.startsWith('.') && !relPath.startsWith('/'))) {
            ok(`Package/Built-in: ${relPath}`);
            continue;
        }

        if (!relPath.endsWith('.js')) relPath += '.js';
        const target = path.resolve(path.dirname(fp), relPath);
        if (fs.existsSync(target)) {
            const tc = fs.readFileSync(target, 'utf8');
            funcs.forEach(f => {
                if (!tc.match(new RegExp(`export\\s+(const|async\\s+function|function|let|var)\\s+${f}`))) {
                    fail(`${path.basename(target)} 未導出: ${f}`);
                }
            });
            ok(`連結: ${relPath}`);
        } else {
            fail(`路徑失效: ${relPath}`);
        }
    }
}
analyzeDeps('server.js');
analyzeDeps('routes/api.js');

// ============ 5. 依賴包完整性 ============
header('5/10', 'Node Modules 完整性');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const missing = Object.keys(pkg.dependencies).filter(d => !fs.existsSync(path.join(root, 'node_modules', d)));
if (missing.length === 0) ok('所有套件已安裝');
else missing.forEach(d => fail(`缺失套件: ${d}`));

// ============ 6. 視窗智慧篩選品質 (防止回歸 Launchpad 問題) ============
header('6/10', '視窗智慧篩選品質 (Anti-Launchpad)');
import { findAllInstances } from '../core/cdp_manager.js';

try {
    const instances = await findAllInstances();
    if (instances.length === 0) {
        info('目前無活躍實例可供測試。');
    } else {
        instances.forEach(inst => {
            if (inst.title && inst.title.includes('Launchpad')) {
                fail(`Port ${inst.port}: 誤抓啟動器視窗！ (Title: ${inst.title})`);
            } else if (inst.url && inst.url.includes('workbench.html')) {
                ok(`Port ${inst.port}: 正確選取開發視窗 (Title: ${inst.title})`);
            } else {
                warn(`Port ${inst.port}: 選取到非標準視窗 (Title: ${inst.title})`);
            }
        });
    }
} catch (e) {
    fail(`執行視窗測試失敗: ${e.message}`);
}

// ============ 7. 埠口與連線 ============
header('7/10', '埠口與連線狀態');
async function checkPort(port) {
    return new Promise(resolve => {
        const s = net.createServer().once('error', () => resolve(true)).once('listening', () => { s.close(); resolve(false); }).listen(port, '127.0.0.1');
    });
}
const p3004 = await checkPort(3004);
const p9000 = await checkPort(9000);
if (p3004) ok('Phone Server (3004) 在線'); else fail('Phone Server (3004) 離線');
if (p9000) ok('Antigravity (9000) 在線'); else warn('Antigravity (9000) 未回應');

// ============ 7. API 端點健康檢查 ============
header('7/10', 'API 端點健康');
async function testApi(endpoint) {
    return new Promise(resolve => {
        http.get(`http://127.0.0.1:3004${endpoint}`, res => {
            resolve(res.statusCode === 200);
        }).on('error', () => resolve(false));
    });
}
if (await testApi('/slots')) ok('/slots API 正常');
else fail('/slots API 異常');

// ============ 8. 磁碟權限 ============
header('8/10', '磁碟讀寫權限');
const dataDir = path.join(root, '.user_data_9000');
if (fs.existsSync(dataDir)) {
    try {
        const testFile = path.join(dataDir, 'test_write.tmp');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        ok('數據目錄可讀寫');
    } catch (e) {
        fail('數據目錄權限異常');
    }
} else {
    info('數據目錄尚未建立');
}

// ============ 9. 系統資源 ============
header('9/10', '系統資源監測');
const freeMem = os.freemem() / 1024 / 1024 / 1024;
const totalMem = os.totalmem() / 1024 / 1024 / 1024;
const usedPercent = ((1 - freeMem / totalMem) * 100).toFixed(1);
info(`記憶體: ${usedPercent}% 已使用 (${freeMem.toFixed(1)}GB 可用)`);
if (freeMem < 1) warn('可用記憶體不足 1GB');
info(`CPU 核心數: ${os.cpus().length}`);

// ============ 10. 日誌檢查 ============
header('10/10', '近期異常日誌');
const logPath = path.join(root, 'server.log');
if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-10);
    const errors = lines.filter(l => /error|fail|exception|reject/i.test(l));
    if (errors.length > 0) {
        warn(`偵測到 ${errors.length} 條異常紀錄`);
        errors.slice(-3).forEach(e => info(e.substring(0, 80)));
    } else {
        ok('最近日誌無明顯錯誤');
    }
} else {
    info('尚無日誌檔案');
}

// ============ 總結 ============
console.log(`\n${C.cyan}════════════════════ 診斷總結 ════════════════════${C.reset}`);
if (errorCount === 0 && warnCount === 0) {
    console.log(`${C.green}${C.bold}🎉 系統狀態完美！無任何問題。${C.reset}`);
} else {
    console.log(`${C.red}❌ 錯誤: ${errorCount} 項${C.reset}  ${C.yellow}⚠️ 警告: ${warnCount} 項${C.reset}`);
    console.log(`如需自動修復，請輸入 /fix`);
}
console.log('');
