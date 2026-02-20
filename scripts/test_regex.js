// test_regex.js
const testCases = [
    {
        input: 'src="D:/Program Files/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/js.svg"',
        expected: 'src="/vscode-resources/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/js.svg"'
    },
    {
        input: "d:/Program%20Files/Antigravity",
        expected: "/vscode-resources/Antigravity"
    },
    {
        input: 'url("https://file+.vscode-resource.vscode-cdn.net/d:/Program%20Files/Antigravity")',
        expected: 'url("/vscode-resources/Antigravity")'
    },
    {
        input: 'src="vscode-webview-resource://uuid123/file///d:/Program Files/Antigravity"',
        expected: 'src="/vscode-resources/Antigravity"'
    },
    {
        input: 'file:///D:/Program%20Files/Antigravity',
        expected: '/vscode-resources/Antigravity'
    }
];

const cleanText = (text) => {
    let out = text;

    // Match optional URI scheme + optional slashes + [Drive Letter]:\Program Files
    // Scheme matching handles any protocol like http://, https://, vscode-webview-resource://, file://
    const resourceRegex = /(?:[a-zA-Z0-9+.-]+:\/\/[^"'>\s]*?(?=[a-zA-Z](:|%3A)))?(?:\/+)?([a-zA-Z](:|%3A)(?:[\\/]|%2F|%5C|%20|\s)+Program(?:[\\/]|%2F|%5C|%20|\s)+Files)/gi;

    out = out.replace(resourceRegex, '/vscode-resources');

    // Clean up any double slashes that might have formed, e.g. //vscode-resources -> /vscode-resources
    out = out.replace(/\/\/vscode-resources/gi, '/vscode-resources');

    return out;
};

let allPass = true;
testCases.forEach((tc, idx) => {
    const res = cleanText(tc.input);
    if (res !== tc.expected) {
        console.error(`Case ${idx} FAILED`);
        console.error(`  Expected: ${tc.expected}`);
        console.error(`  Got:      ${res}`);
        allPass = false;
    } else {
        console.log(`Case ${idx} PASS`);
    }
});

if (allPass) {
    console.log("✅ ALL TESTS PASSED");
} else {
    process.exit(1);
}
