import { getOrConnectParams } from '../core/cdp_manager.js';

async function detectAllModelsTime() {
    process.stdout.write('--- DETECTING ALL MODELS RESTORATION TIME ---\n');
    const port = 9000;
    try {
        const conns = await getOrConnectParams(port);
        for (const conn of conns) {
            process.stdout.write(`Scanning Window: ${conn.title}\n`);

            const SCRIPT = `(async () => {
                const allElements = Array.from(document.querySelectorAll('*'));
                const label = allElements.find(el => {
                    const t = (el.innerText || el.textContent || "").trim();
                    return t.includes('%') && t.length < 15 && el.offsetParent !== null;
                });

                if (!label) return { error: 'Usage label not found' };
                
                label.click();
                await new Promise(r => setTimeout(r, 2000));

                const rows = Array.from(document.querySelectorAll('*'))
                                    .filter(el => el.offsetParent !== null && (el.classList.contains('info-row') || el.tagName === 'DIV'))
                                    .map(el => el.innerText.trim())
                                    .filter(t => t.length > 0);
                
                return { rows };
            })()`;

            const ctxs = conn.contexts || [{ id: undefined }];
            for (const ctx of ctxs) {
                const res = await conn.call("Runtime.evaluate", {
                    expression: SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });

                const val = res?.result?.value;
                if (val && val.rows) {
                    process.stdout.write(`  [Context ${ctx.id}] Results:\n`);

                    const report = {
                        "G3-Pro": { percent: "", reset: "", time: "" },
                        "G3-Flash": { percent: "", reset: "", time: "" },
                        "Claude": { percent: "", reset: "", time: "" }
                    };

                    let currentModel = "";
                    for (let i = 0; i < val.rows.length; i++) {
                        const row = val.rows[i];
                        if (row === "G3-Pro") currentModel = "G3-Pro";
                        else if (row === "G3-Flash") currentModel = "G3-Flash";
                        else if (row === "Claude") currentModel = "Claude";

                        if (currentModel) {
                            if (row.includes('%')) report[currentModel].percent = row;
                            if (row === "重置倒計時") report[currentModel].reset = val.rows[i + 1];
                            if (row === "重置時間") report[currentModel].time = val.rows[i + 1];
                        }
                    }

                    Object.keys(report).forEach(m => {
                        process.stdout.write(`    > ${m}:\n`);
                        process.stdout.write(`      - Percent: ${report[m].percent || 'N/A'}\n`);
                        process.stdout.write(`      - Reset Countdown: ${report[m].reset || 'N/A'}\n`);
                        process.stdout.write(`      - ETA: ${report[m].time || 'N/A'}\n`);
                    });
                    return;
                }
            }
        }
    } catch (e) {
        process.stdout.write(`  Error: ${e.message}\n`);
    }
}

detectAllModelsTime();
