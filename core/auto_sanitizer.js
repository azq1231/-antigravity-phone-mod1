/**
 * Antigravity UI Sanitizer
 * 專門處理 VS Code 內部協議與路徑過濾，確保手機端主控台潔淨且資源正確映射。
 */

export const BAD_SCHEMES = [
    'vscode-file://', 
    'file://', 
    'app://', 
    'devtools://', 
    'vscode-webview-resource://'
];

export const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * 清理文本內的敏感路徑與無效協議
 */
export function cleanContent(text) {
    if (!text || typeof text !== 'string') return text;
    let out = text;

    // 1. 隱私路徑中和 (Antigravity Brain)
    // 使用字串替換避開複雜正則
    if (out.includes('.gemini')) {
        out = out.replace(/[a-zA-Z]:[^"'> ]+?[\/\\]\.gemini[\/\\]antigravity[\/\\]brain[\/\\]/gi, '/brain/');
    }

    // 2. VS Code 資源映射 (中和 Program Files 路徑)
    if (out.includes('Program Files')) {
        out = out.replace(/[a-zA-Z]:[\/\\]Program Files/gi, '/vscode-resources');
    }

    // 3. 處理 CSS url() 內的無效協議
    if (out.includes('url(')) {
        out = out.split('url(').map((part, i) => {
            if (i === 0) return part;
            const endIdx = part.indexOf(')');
            if (endIdx === -1) return part;
            const urlContent = part.substring(0, endIdx);
            if (BAD_SCHEMES.some(s => urlContent.includes(s))) {
                return '"' + BLANK_GIF + '"' + part.substring(endIdx);
            }
            return part;
        }).join('url(');
    }

    // 4. 強力中和其餘協議
    BAD_SCHEMES.forEach(s => {
        if (out.includes(s)) out = out.split(s).join('#');
    });

    return out;
}

/**
 * 針對 DOM 節點屬性的特定清理邏輯 (用於快照腳本內部)
 */
export const SANITIZE_ATTR_SCRIPT = `
    const badSchemes = ${JSON.stringify(BAD_SCHEMES)};
    const blankGif = "${BLANK_GIF}";
    
    const cleanAttr = (val) => {
        if (!val) return val;
        let out = val;
        
        // 簡易路徑匹配
        if (out.includes('antigravity') || out.includes('.gemini')) {
            out = out.replace(/[a-zA-Z]:[^"'> ]+?[\\/]\.gemini[\\/]antigravity[\\/]brain[\\/]/gi, '/brain/');
        }
        if (out.includes('Program Files')) {
            out = out.replace(/[a-zA-Z]:[\\/]Program Files/gi, '/vscode-resources');
        }

        badSchemes.forEach(s => {
            if (out.includes(s)) out = out.split(s).join('#');
        });
        return out;
    };

    clone.querySelectorAll('*').forEach(el => {
        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const val = attr.value;
            if (badSchemes.some(s => val.includes(s)) || val.includes('Program Files') || val.includes('antigravity')) {
                let cleaned = cleanAttr(val);
                if (el.tagName === 'IMG' && attr.name === 'src' && cleaned.includes('#')) {
                    cleaned = blankGif;
                }
                el.setAttribute(attr.name, cleaned);
            }
        }
        if (el.tagName === 'STYLE') el.textContent = cleanAttr(el.textContent);
    });
`;
