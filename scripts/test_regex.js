const text = "Some code d:/Program%20Files/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/js.svg more code";
const resourceRegex = /[a-z]:([\\\/]|%20|\s)+Program([\\\/]|%20|\s)+Files([\\\/]|%20|\s)+Antigravity([\\\/]|%20|\s)+resources([\\\/]|%20|\s)+app([\\\/]|%20|\s)+/gi;
const out = text.replace(resourceRegex, '/vscode-resources/');
console.log("Original:", text);
console.log("Result:", out);
if (out.includes('/vscode-resources/')) {
    console.log("✅ Success");
} else {
    console.log("❌ Failed");
}
