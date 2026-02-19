#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 確保 logs 目錄存在
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, 'last_run.log');
const writeStream = fs.createWriteStream(logFile);

const args = process.argv.slice(2);
if (args.length === 0) {
    console.log('用法: node scripts/smart_run.js <你的指令>');
    process.exit(1);
}

// 分解指令與參數
const command = args[0];
const cmdArgs = args.slice(1);

console.log(`🚀 開始執行並記錄: ${args.join(' ')}`);
console.log(`📝 日誌將儲存至: ${logFile}\n`);

const child = spawn(command, cmdArgs, {
    shell: true,
    env: process.env
});

let lineCount = 0;
let byteCount = 0;
const previewLines = [];
const MAX_PREVIEW = 30;

function handleData(data) {
    const str = data.toString();
    byteCount += data.length;
    writeStream.write(data);

    const lines = str.split('\n');
    lines.forEach(l => {
        if (l.trim()) {
            lineCount++;
            if (previewLines.length < MAX_PREVIEW) {
                previewLines.push(l);
            }
        }
    });

    // 實時反映在終端機 (截斷保護)
    if (lineCount <= MAX_PREVIEW) {
        process.stdout.write(data);
    } else if (lineCount === MAX_PREVIEW + 1) {
        console.log('\n... [後續輸出已偵測到過長，已自動切換至背景流式寫入檔案] ...');
    }
}

child.stdout.on('data', handleData);
child.stderr.on('data', (data) => {
    console.error(' [ERROR] ', data.toString());
    handleData(data);
});

child.on('close', (code) => {
    writeStream.end();
    console.log('\n' + '='.repeat(50));
    console.log(`✅ 執行完畢 (Exit Code: ${code})`);
    console.log(`📊 統計資料:`);
    console.log(`   - 總行數: ${lineCount}`);
    console.log(`   - 總字節: ${(byteCount / 1024).toFixed(2)} KB`);
    console.log(`📂 請告知 AI 使用 view_file 讀取完整的 ${logFile}`);
    console.log('='.repeat(50));
    process.exit(code);
});
