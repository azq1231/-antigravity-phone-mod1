const EXP = `
    const text = 'src="vscode-webview-resource://uuid123/file///d:/Program Files/Antigravity"';
    console.log("Input:", text);
    const rgx = new RegExp('(?:[a-zA-Z0-9+.-]+://[^"\\'>\\\\s]*?(?=[a-zA-Z](:|%3A)))?(?:/+)?([a-zA-Z](:|%3A)(?:[\\\\\\\\/]|%2F|%5C|%20|\\\\s)+Program(?:[\\\\\\\\/]|%2F|%5C|%20|\\\\s)+Files)', 'gi');
    
    let out = text.replace(rgx, '/vscode-resources');
    console.log("Output:", out);
`;

eval(EXP);
