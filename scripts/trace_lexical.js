
import { findAllInstances, connectCDP } from '../core/cdp_manager.js';

async function traceLexical() {
    console.log('[TRACE] Searching for Lexical Editor in all targets...');
    const instances = await findAllInstances();
    
    for (const inst of instances) {
        console.log(`\n=== Port ${inst.port} ===`);
        for (const target of inst.targets) {
            try {
                const conn = await connectCDP(target.url);
                // Get all execution contexts
                const ctxRes = await conn.call("Runtime.enable");
                // Wait a bit for contexts to be discovered
                await new Promise(r => setTimeout(r, 500));
                
                // We don't have a direct "listContexts" call in standard CDP that's easy to use without listeners,
                // but we can try to evaluate in context 1 and other common ones, 
                // or use a better way: iterate all frames.
                
                // Better approach: use Page.getFrameTree
                const framesRes = await conn.call("Page.getFrameTree");
                const frames = [];
                const collectFrames = (f) => {
                    frames.push(f.frame);
                    if (f.childFrames) f.childFrames.forEach(collectFrames);
                };
                collectFrames(framesRes.frameTree);

                console.log(`Target: ${target.title} (${target.url.substring(0, 40)}...)`);
                console.log(`  Found ${frames.length} frames.`);

                for (const frame of frames) {
                    try {
                        const { executionContextId } = await conn.call("Page.createIsolatedContext", { frameId: frame.id });
                        const check = await conn.call("Runtime.evaluate", {
                            expression: `({
                                lexical: !!document.querySelector('[data-lexical-editor="true"]'),
                                contentEditable: !!document.querySelector('[contenteditable="true"]'),
                                buttons: Array.from(document.querySelectorAll('button')).map(b => ({
                                    text: b.innerText,
                                    label: b.getAttribute('aria-label'),
                                    tip: b.getAttribute('data-tooltip-id')
                                })).filter(b => (b.text + b.label + b.tip).toLowerCase().includes('send'))
                            })`,
                            returnByValue: true,
                            contextId: executionContextId
                        });
                        
                        const val = check.result.value;
                        if (val.lexical || val.contentEditable || val.buttons.length > 0) {
                            console.log(`  [MATCH] Frame ${frame.id} (${frame.url.substring(0, 40)}...)`);
                            console.log(`    Lexical: ${val.lexical}, Editable: ${val.contentEditable}`);
                            console.log(`    Send Buttons: ${JSON.stringify(val.buttons)}`);
                        }
                    } catch (e) {
                         // console.log(`  [ERR] Frame ${frame.id}: ${e.message}`);
                    }
                }
                conn.close();
            } catch (e) {
                // console.log(`[ERR] Target ${target.title}: ${e.message}`);
            }
        }
    }
    process.exit(0);
}
traceLexical();
