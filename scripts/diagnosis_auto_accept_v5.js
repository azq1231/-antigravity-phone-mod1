
import { findAllInstances, getOrConnectParams } from '../core/cdp_manager.js';
import { runAutoAccept } from '../core/auto_accept.js';

async function diagnose() {
    console.log('🔍 Starting Auto-Accept Diagnosis...');
    const instances = await findAllInstances();
    console.log(`Found ${instances.length} active instances:`, instances.map(i => i.port));

    for (const inst of instances) {
        console.log(`\n--- Diagnosing Port ${inst.port} ---`);
        const conns = await getOrConnectParams(inst.port);
        console.log(`Connected to ${conns.length} targets.`);

        for (const conn of conns) {
            console.log(`  Target: ${conn.title} (${conn.url})`);
            console.log(`  Found ${conn.contexts.length} execution contexts.`);
            
            for (const ctx of conn.contexts) {
                console.log(`    Context: ID=${ctx.id}, Name=${ctx.name || 'N/A'}, Origin=${ctx.origin}`);
                
                // Inspect DOM for candidate buttons
                const INSPECT_SCRIPT = `(() => {
                    const results = [];
                    const findClickable = (root = document, offsetX = 0, offsetY = 0) => {
                        let found = [];
                        try {
                            const elements = Array.from(root.querySelectorAll('*'));
                            elements.forEach(el => {
                                const text = (el.innerText || el.textContent || "").trim();
                                const aria = (el.getAttribute('aria-label') || "").trim();
                                const tag = el.tagName.toLowerCase();
                                const styles = window.getComputedStyle(el);

                                const keywords = [
                                    "Accept all", "Accept", "Allow Once", "Allow This Conversation", "Always Allow", "Yes",
                                    "Run Alt+Enter", "Run", "Review Changes", "Allow",
                                    "全部接受", "接受", "允許一次", "一律允許", "是", "執行", "查看變更"
                                ];

                                const isUIMatch = keywords.some(k => text === k || aria === k || text.includes(k));
                                
                                if (el.closest('#conversation') && !isUIMatch) return;
                                
                                if (el.offsetHeight > 0 && !el.disabled && styles.cursor === 'pointer') {
                                    // if (isUIMatch && text.length < 40) {
                                        const rect = el.getBoundingClientRect();
                                        found.push({ 
                                            tag, text, class: el.className, id: el.id,
                                            label: (text || aria || "NoText").substring(0, 30), 
                                            x: offsetX + rect.left + rect.width / 2, 
                                            y: offsetY + rect.top + rect.height / 2 
                                        });
                                    // }
                                }

                                if (el.shadowRoot) {
                                    found = found.concat(findClickable(el.shadowRoot, offsetX, offsetY));
                                }
                                try {
                                    if (tag === 'iframe' && el.contentDocument) {
                                        const fRect = el.getBoundingClientRect();
                                        found = found.concat(findClickable(el.contentDocument, offsetX + fRect.left, offsetY + fRect.top));
                                    }
                                } catch (e) { }
                            });
                        } catch (e) { }
                        return found;
                    };
                    const candidates = findClickable();
                    return candidates;
                })()`;

                try {
                    const res = await conn.call("Runtime.evaluate", {
                        expression: INSPECT_SCRIPT,
                        returnByValue: true,
                        contextId: ctx.id,
                        timeout: 2000
                    });

                    const candidates = res?.result?.value;
                    if (candidates && candidates.length > 0) {
                        console.log(`      Found ${candidates.length} candidate buttons in this context:`);
                        candidates.forEach(c => {
                            console.log(`        [${c.tag}] "${c.text}" | Class: ${c.class} | ID: ${c.id} | Pos: (${Math.floor(c.x)}, ${Math.floor(c.y)})`);
                        });
                    }
                } catch (e) {
                    console.error(`      Error inspecting context ${ctx.id}:`, e.message);
                }
            }
        }
    }
}

diagnose().catch(console.error);
