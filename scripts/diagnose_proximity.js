import { getOrConnectParams } from '../core/cdp_manager.js';
import fs from 'fs';

async function diagnose() {
    const port = 9000;
    const output = [];
    try {
        const conn = await getOrConnectParams(port);

        for (const cdp of conn) {
            output.push(`\n=== Target: ${cdp.title} ===`);
            const ctxIds = cdp.contexts.length > 0 ? cdp.contexts.map(c => c.id) : [undefined];

            for (const ctxId of ctxIds) {
                try {
                    const res = await cdp.call("Runtime.evaluate", {
                        expression: `(() => {
                            const results = [];
                            const all = Array.from(document.querySelectorAll('*'));
                            
                            // 尋找模型名稱和模式名稱
                            const modelNodes = all.filter(el => el.children.length === 0 && (el.innerText || "").includes('Gemini'));
                            const modeNodes = all.filter(el => el.children.length === 0 && ((el.innerText || "") === 'Fast' || (el.innerText || "") === 'Planning'));
                            
                            if (modelNodes.length > 0 && modeNodes.length > 0) {
                                results.push("Found BOTH model and mode nodes in this context.");
                                
                                modelNodes.forEach(modelNode => {
                                    results.push(\`Model Node: <\${modelNode.tagName}> text="\${modelNode.innerText.trim()}" class="\${modelNode.className}"\`);
                                    
                                    // 尋找共同父節點
                                    let parent = modelNode.parentElement;
                                    let depth = 0;
                                    while (parent && depth < 5) {
                                        const nearModes = Array.from(parent.querySelectorAll('*')).filter(el => 
                                            el.children.length === 0 && (el.innerText === 'Fast' || el.innerText === 'Planning')
                                        );
                                        
                                        if (nearModes.length > 0) {
                                            results.push(\`Found Mode node inside parent (depth \${depth}): <\${parent.tagName}> class="\${parent.className}"\`);
                                            nearModes.forEach(m => {
                                                results.push(\`  -> Mode Node: <\${m.tagName}> text="\${m.innerText}" class="\${m.cls || m.className}"\`);
                                            });
                                            break;
                                        }
                                        parent = parent.parentElement;
                                        depth++;
                                    }
                                });
                            }
                            
                            return { results, title: document.title };
                        })()`,
                        returnByValue: true,
                        contextId: ctxId
                    });

                    const val = res.result?.value;
                    if (!val || !val.results?.length) continue;

                    output.push(`  Context ${ctxId || 'default'} (${val.title}):`);
                    val.results.forEach(line => output.push(`    ${line}`));
                } catch (e) { }
            }
        }
    } catch (e) {
        output.push('Error: ' + e.message);
    }

    const result = output.join('\n');
    fs.writeFileSync('scripts/proximity_result.txt', result, 'utf8');
    console.log(result);
    process.exit(0);
}

diagnose();
