
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function deepInspect() {
    console.log('[DEEP] Inspecting all frames for send button...');
    const instances = await findAllInstances();
    
    for (const inst of instances) {
        for (const target of inst.targets) {
            if (!target.url.includes('vscode-webview')) continue;
            
            console.log(`\nTARGET: ${target.title} | ${target.url.substring(0, 60)}`);
            try {
                const conn = await connectCDP(target.url);
                const tree = await conn.call("Page.getFrameTree");
                
                const collectFrames = (f) => {
                    const list = [f.frame];
                    if (f.childFrames) f.childFrames.forEach(cf => list.push(...collectFrames(cf)));
                    return list;
                };
                const frames = collectFrames(tree.frameTree);
                
                for (const frame of frames) {
                    console.log(`  Frame ID: ${frame.id} | Name: ${frame.name || 'N/A'} | URL: ${frame.url.substring(0, 50)}`);
                    try {
                        const { executionContextId } = await conn.call("Page.createIsolatedContext", { frameId: frame.id });
                        const res = await conn.call("Runtime.evaluate", {
                            expression: `(() => {
                                const info = {
                                    htmlLength: document.documentElement.outerHTML.length,
                                    hasLexical: !!document.querySelector('[data-lexical-editor="true"]'),
                                    selectors: [],
                                    inputs: document.querySelectorAll('input, textarea').length,
                                    editables: document.querySelectorAll('[contenteditable]').length
                                };
                                
                                // Specific search for send button
                                const buttons = Array.from(document.querySelectorAll('*')).filter(el => {
                                    const str = (el.innerText + el.ariaLabel + el.title + el.className + (el.id || "")).toLowerCase();
                                    return str.includes('send') || str.includes('arrow-up') || (el.tagName === 'SVG' && el.innerHTML.includes('arrow-up'));
                                });
                                
                                info.candidates = buttons.map(b => ({
                                    tag: b.tagName,
                                    id: b.id,
                                    cls: b.className,
                                    text: b.innerText.substring(0, 20),
                                    label: b.ariaLabel,
                                    visible: b.offsetHeight > 0
                                }));
                                
                                if (info.hasLexical) info.selectors.push('lexical_found');
                                return info;
                            })()`,
                            returnByValue: true,
                            contextId: executionContextId
                        });
                        
                        console.log(`    Result: ${JSON.stringify(res.result.value, null, 2)}`);
                    } catch (e) {
                         console.log(`    [ERR] ${e.message}`);
                    }
                }
                conn.close();
            } catch (e) {
                console.log(`  [FATAL] ${e.message}`);
            }
        }
    }
    process.exit(0);
}
deepInspect();
