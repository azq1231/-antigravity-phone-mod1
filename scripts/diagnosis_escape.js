// diagnosis_escape.js
// 目的：模擬 automation.js 的 CAPTURE_SCRIPT 在 CDP 注入後的實際轉義結果
// 這個腳本在 Node.js 中跑，模擬 `eval(templateLiteralString)` 的行為

// ========================================
// 問題 1: resourceRegex 在 CDP 注入後是否正確？
// ========================================
console.log("=== 問題 1: resourceRegex 轉義驗證 ===\n");

// 這是 automation.js 中 CAPTURE_SCRIPT 模板字串裡的原始碼 (Line 116)
// 注意：模板字串 `` 中的反斜線只會被消耗一次
// 所以在 eval 環境中看到的 new RegExp(...) 中的字串需要再少一層
const cdpScript = `
const resourceRegex = new RegExp('(?:[a-zA-Z0-9+.-]+://[^"\\\\'\\>\\\\\\\\s]*?(?=[a-zA-Z](:|%3A)))?(?:/+)?([a-zA-Z](:|%3A)(?:[\\\\\\\\\\\\\\\\\/]|%2F|%5C|%20|\\\\\\\\s)+Program(?:[\\\\\\\\\\\\\\\\\/]|%2F|%5C|%20|\\\\\\\\s)+Files)', 'gi');
resourceRegex;
`;

try {
    const result = eval(cdpScript);
    console.log("CDP eval 結果 regex:", result.toString());
} catch (e) {
    console.error("❌ CDP eval 失敗:", e.message);
}

// 對照：本地能正常運作的正則 (來自 test_regex.js Line 30)
const localRegex = /(?:[a-zA-Z0-9+.-]+:\/\/[^"'>\s]*?(?=[a-zA-Z](:|%3A)))?(?:\/+)?([a-zA-Z](:|%3A)(?:[\\\/]|%2F|%5C|%20|\s)+Program(?:[\\\/]|%2F|%5C|%20|\s)+Files)/gi;
console.log("本地正確 regex:", localRegex.toString());

// ========================================
// 問題 2: brainRegex 在 CDP 注入後是否正確？
// ========================================
console.log("\n=== 問題 2: brainRegex 轉義驗證 ===\n");

const cdpBrain = `
const brainRegex = /[a-z]:[^"'\\>]+?\\\\\\\\.gemini[\\\\\\\\/]+antigravity[\\\\\\\\/]+brain[\\\\\\\\/]+/gi;
brainRegex;
`;

try {
    const result = eval(cdpBrain);
    console.log("CDP eval 結果 regex:", result.toString());
} catch (e) {
    console.error("❌ CDP eval 失敗:", e.message);
}

const localBrain = /[a-z]:[^"'>]+?\\.gemini[\\\/]+antigravity[\\\/]+brain[\\\/]+/gi;
console.log("本地正確 regex:", localBrain.toString());

// ========================================
// 問題 3: 完整 cleanText 功能測試
// ========================================
console.log("\n=== 問題 3: cleanText 端到端功能測試 ===\n");

const testCases = [
    {
        name: "SVG 圖示路徑",
        input: 'src="D:/Program Files/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/js.svg"',
        shouldContain: '/vscode-resources',
        shouldNotContain: 'Program Files'
    },
    {
        name: "URL 編碼路徑",
        input: 'd:/Program%20Files/Antigravity/test.svg',
        shouldContain: '/vscode-resources',
        shouldNotContain: 'Program%20Files'
    },
    {
        name: "CDN 包裝路徑",
        input: 'url("https://file+.vscode-resource.vscode-cdn.net/d:/Program%20Files/Antigravity/icon.svg")',
        shouldContain: '/vscode-resources',
        shouldNotContain: 'Program%20Files'
    },
    {
        name: "Brain 路徑",
        input: 'src="C:\\Users\\kuo_1\\.gemini\\antigravity\\brain\\9d425b2e\\test.webp"',
        shouldContain: '/brain/',
        shouldNotContain: '.gemini'
    },
    {
        name: "vscode-webview-resource 協議",
        input: 'src="vscode-webview-resource://uuid123/file///d:/Program Files/Antigravity/test.svg"',
        shouldContain: '/vscode-resources',
        shouldNotContain: 'vscode-webview-resource'
    }
];

// 模擬完整 cleanText (和 automation.js L106-148 完全相同的邏輯)
const cleanText = (text) => {
    if (!text) return text;
    let out = text;
    const badSchemes = ['vscode-file://', 'file://', 'app://', 'devtools://', 'vscode-webview-resource://'];
    const blankGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // brainRegex
    const brainRegex = /[a-z]:[^"'>]+?\\.gemini[\\\/]+antigravity[\\\/]+brain[\\\/]+/gi;
    out = out.replace(brainRegex, '/brain/');

    // resourceRegex (本地正確版)
    const resourceRegex = /(?:[a-zA-Z0-9+.-]+:\/\/[^"'>\s]*?(?=[a-zA-Z](:|%3A)))?(?:\/+)?([a-zA-Z](:|%3A)(?:[\\\/]|%2F|%5C|%20|\s)+Program(?:[\\\/]|%2F|%5C|%20|\s)+Files)/gi;
    out = out.replace(resourceRegex, '/vscode-resources');

    // double slash cleanup
    out = out.replace(/\/\/vscode-resources/gi, '/vscode-resources');

    // brain path normalization
    if (out.includes('/brain/')) {
        const parts = out.split('/brain/');
        out = parts[0] + parts.slice(1).map(part => {
            const endIndices = ['"', "'", ' ', '>', ')', '\n'].map(c => part.indexOf(c)).filter(i => i !== -1);
            const endIdx = endIndices.length > 0 ? Math.min(...endIndices) : part.length;
            const urlPart = part.substring(0, endIdx).replace(/\\/g, '/');
            return urlPart + part.substring(endIdx);
        }).join('/brain/');
    }

    // url() handling
    if (out.includes('url(')) {
        out = out.split('url(').map((part, i) => {
            if (i === 0) return part;
            const endIdx = part.indexOf(')');
            const urlContent = part.substring(0, endIdx);
            if (badSchemes.some(s => urlContent.includes(s))) {
                return '"' + blankGif + '"' + part.substring(endIdx);
            }
            return part;
        }).join('url(');
    }

    // final bad scheme cleanup
    badSchemes.forEach(s => {
        out = out.split(s).join('#');
    });

    return out;
};

let allPass = true;
testCases.forEach((tc, idx) => {
    const result = cleanText(tc.input);
    const pass = result.includes(tc.shouldContain) && !result.includes(tc.shouldNotContain);
    if (!pass) {
        console.error(`❌ Case ${idx} [${tc.name}] FAILED`);
        console.error(`   Input:         ${tc.input}`);
        console.error(`   Output:        ${result}`);
        console.error(`   ShouldContain: ${tc.shouldContain} => ${result.includes(tc.shouldContain)}`);
        console.error(`   ShouldNotContain: ${tc.shouldNotContain} => ${!result.includes(tc.shouldNotContain)}`);
        allPass = false;
    } else {
        console.log(`✅ Case ${idx} [${tc.name}] PASS => ${result}`);
    }
});

console.log(allPass ? "\n🎉 全部通過！" : "\n💥 有失敗的測試案例");

// ========================================
// 問題 4: error_log.txt 中 SyntaxError 根因
// ========================================
console.log("\n=== 問題 4: SyntaxError 根因分析 ===\n");
console.log("error_log.txt 顯示 'SyntaxError: missing ) after argument list'");
console.log("這通常發生在 CAPTURE_SCRIPT 模板字串中的反斜線被 JS 引擎多消耗了一層。");
console.log("讓我們驗證 Line 37 的 allCSS join 是否有問題...\n");

// Line 37: const allCSS = rules.join('\\\\n');
// 在模板字串中 \\\\ -> \\ (字面反斜線), 然後 n -> n
// 所以 eval 後看到的是 rules.join('\\n') => 用換行分隔 => ✅ 正確

// 但 Line 110 的 brainRegex 和 Line 116 的 resourceRegex 轉義可能不對
// 讓我們用模板字串模擬完整注入

const SIMULATED_CDP_FRAGMENT = `
    const allCSS_join = '\\\\n';
    allCSS_join;
`;
try {
    const r = eval(SIMULATED_CDP_FRAGMENT);
    console.log(`Line 37 allCSS.join 分隔符: ${JSON.stringify(r)} (期望 "\\n")`);
    console.log(r === '\n' ? '✅ 正確' : '❌ 錯誤！');
} catch (e) {
    console.error("❌ allCSS join eval 失敗:", e.message);
}
