import { getOrConnectParams } from '../core/cdp_manager.js';

async function detectAllModelsDetailed() {
    process.stdout.write('--- DETECTING ALL MODELS DETAILED (v3) ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            const SCRIPT = `(async () => {
                const label = Array.from(document.querySelectorAll('*')).find(el => {
                    const t = (el.innerText || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                });

                if (!label) return { error: 'Label not found' };
                label.click();
                await new Promise(r => setTimeout(r, 2000));

                const items = Array.from(document.querySelectorAll('*'))
                                    .filter(el => el.offsetParent !== null && (el.innerText.trim().length > 0))
                                    .map(el => el.innerText.trim());
                
                return { items: items.slice(0, 500) };
            })()`;

            for (const ctx of conn.contexts) {
                const res = await conn.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res?.result?.value?.items) {
                    process.stdout.write(`  [Context ${ctx.id}] Processing Data...\n`);
                    const rows = res.result.value.items;

                    const models = ["G3-Pro", "G3-Flash", "Claude"];
                    const results = {};

                    models.forEach(m => {
                        const idx = rows.findIndex(row => row.includes(m));
                        if (idx !== -1) {
                            // 往後尋找百分比、倒計時、重置時間
                            results[m] = { percent: "N/A", countdown: "N/A", eta: "N/A" };
                            for (let j = idx; j < idx + 20 && j < rows.length; j++) {
                                if (rows[j].includes('%') && results[m].percent === "N/A") results[m].percent = rows[j];
                                if (rows[j] === "重置倒計時") results[m].countdown = rows[j + 1];
                                if (rows[j] === "重置時間") results[m].eta = rows[j + 1];
                            }
                        }
                    });

                    Object.keys(results).forEach(m => {
                        process.stdout.write(`    > ${m}:\n`);
                        process.stdout.write(`      - Percent: ${results[m].percent}\n`);
                        process.stdout.write(`      - Countdown: ${results[m].countdown}\n`);
                        process.stdout.write(`      - ETA: ${results[m].eta}\n`);
                    });
                    return;
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

detectAllModelsDetailed();
