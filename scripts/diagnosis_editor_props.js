
import { getOrConnectParams } from '../core/cdp_manager.js';

async function checkEditorProps() {
    const port = 9001;
    const conn = await getOrConnectParams(port);
    const cdp = Array.isArray(conn) ? conn[0] : conn;
    
    const SCRIPT = `(() => {
        const editor = document.querySelector('[data-lexical-editor="true"]');
        if (!editor) return "NOT FOUND";
        return {
            contentEditable: editor.contentEditable,
            offsetParent: !!editor.offsetParent,
            offsetWidth: editor.offsetWidth,
            offsetHeight: editor.offsetHeight,
            classes: editor.className,
            html: editor.outerHTML.substring(0, 200)
        };
    })()`;
    
    const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
}

checkEditorProps();
