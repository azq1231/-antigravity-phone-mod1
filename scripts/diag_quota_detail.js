
import { getOrConnectParams } from '../core/cdp_manager.js';

async function diagnose() {
    const port = 9000;
    const cdpList = await getOrConnectParams(port);
    
    const EXTRACT_SCRIPT = `(() => {
        try {
            const finalData = {};
            const rawResults = {};
            let isDialogMode = false;
            const nameMap = {
                'Pro': 'Gemini 3 Pro (H/L)',
                'Flash': 'Gemini 3 Flash',
                'Claude': 'Claude / GPT-4o'
            };

            const getGroupKey = (name) => {
                if (!name) return null;
                const n = name.trim().toLowerCase();
                if (n.includes('flash')) return nameMap['Flash'];
                if (n.includes('pro')) return nameMap['Pro'];
                if (n.includes('gpt') || n.includes('claude') || n.includes('sonnet') || n.includes('4o')) return nameMap['Claude'];
                return null;
            };

            const basicResults = {};
            try {
                document.querySelectorAll('.statusbar-item').forEach(el => {
                    const text = (el.innerText || "") + " " + (el.getAttribute('aria-label') || "");
                    const regex = /(Pro|Flash|Claude|Sonnet|GPT):?\\s*([0-9.]+)?%?/gi;
                    let m;
                    while ((m = regex.exec(text)) !== null) {
                        const key = getGroupKey(m[1]);
                        if (key) {
                            if (m[2]) basicResults[key] = m[2] + "%";
                        }
                    }
                });
            } catch(e) {}

            const scan = (doc, prefix = "") => {
                const containers = Array.from(doc.querySelectorAll('div, section, [role="dialog"] div, .monaco-list-row, .card, .quota-compact-item'));
                containers.forEach(container => {
                    const isNoise = container.closest('.monaco-editor, .view-lines, .terminal-container, .interactive-session, .chat-panel, .message-list-item, .suggest-widget');
                    if (isNoise) return;

                    const cText = (container.innerText || "").trim();
                    if (cText.length > 20000 || cText.length < 2) return;

                    const modelRegex = /(Flash|Pro|Claude|GPT-4o)/gi;
                    let match;
                    while ((match = modelRegex.exec(cText)) !== null) {
                        const modelName = match[1];
                        const key = getGroupKey(modelName);
                        if (!key) continue;

                        const subText = cText.substring(match.index, match.index + 1000);
                        if (!rawResults[key]) rawResults[key] = { percent: "N/A", countdown: "N/A", eta: "N/A", priority: -1 };

                        const isDialog = container.closest('.monaco-dialog-box, .monaco-dialog-container, .quick-input-widget, [role="dialog"], .modal-card, .antigravity-usage-popup');
                        const hasPopupMarker = cText.includes('🚀') || cText.includes('點擊打開') || cText.includes('打開配額監控');
                        const isMonitorTab = cText.includes('帳號總覽') || cText.includes('配額歷史') || cText.includes('管理模型');
                        
                        let currentPriority = 0;
                        if (hasPopupMarker && !isMonitorTab) currentPriority = 3;
                        else if (isDialog) currentPriority = 2;
                        else if (isMonitorTab) currentPriority = 1;

                        if (currentPriority < rawResults[key].priority) continue;
                        rawResults[key].priority = currentPriority;

                        const cleanSub = subText.replace(/\\s+/g, ' ');

                        const pm = cleanSub.match(/([0-9.]+)\\s*%/);
                        if (pm && (rawResults[key].percent === 'N/A' || currentPriority >= 2)) {
                            rawResults[key].percent = pm[1].includes('.') ? pm[1] + "%" : parseInt(pm[1]) + "%";
                        }
                        
                        const timeStrPattern = "((?:\\\\d+\\\\s*(?:[dhms](?![a-z])|[時分秒天])\\\\s*){1,4})";
                        const cdMatch = cleanSub.match(new RegExp("(?:重置倒計時|->|%|\\\\s)" + timeStrPattern, "i")) ||
                                       cleanSub.match(new RegExp(timeStrPattern, "i"));
                        
                        if (cdMatch) {
                            let val = cdMatch[1].trim();
                            const isNoiseStr = /Claude|Flash|Pro|GPT-4o|\\\\||分鐘前|分前|秒前|statusBar|settings/i.test(val);
                            if (!isNoiseStr && /\\\\d/.test(val) && val.length > 1 && val.length < 35) {
                                if (rawResults[key].countdown === 'N/A' || currentPriority >= 2) {
                                    rawResults[key].countdown = val;
                                }
                            }
                        }

                        const etaStrPattern = "(\\\\d{4}[/-]\\\\d{1,2}[/-]\\\\d{1,2}\\\\s*[\\\\d:]+|\\\\d{1,2}:\\\\d{2})";
                        const etaMatch = cleanSub.match(new RegExp("(?:重置時間|\\\\(|\\\\s)" + etaStrPattern, "i")) ||
                                         cleanSub.match(new RegExp(etaStrPattern, "i"));
                        
                        if (etaMatch && (rawResults[key].eta === 'N/A' || currentPriority >= 2)) {
                            let etaVal = etaMatch[1].trim();
                            if (etaVal.length <= 5 && etaVal.includes(':')) {
                                const now = new Date();
                                const pad = (n) => n.toString().padStart(2, '0');
                                etaVal = now.getFullYear() + "/" + pad(now.getMonth() + 1) + "/" + pad(now.getDate()) + " " + etaVal;
                            }
                            rawResults[key].eta = etaVal;
                        }

                        if (currentPriority >= 2) isDialogMode = true;
                    }
                });

                doc.querySelectorAll('iframe').forEach(iframe => {
                    try {
                        if (iframe.contentDocument) scan(iframe.contentDocument, prefix + "if > ");
                    } catch(e) {}
                });
            };

            scan(document);

            ['Gemini 3 Flash', 'Gemini 3 Pro (H/L)', 'Claude / GPT-4o'].forEach(model => {
                const res = rawResults[model] || { percent: "N/A", countdown: "N/A", eta: "N/A" };
                if (res.percent === 'N/A' && basicResults[model]) {
                    res.percent = basicResults[model];
                }
                finalData[model] = res;
            });
            return { success: true, data: finalData, isDialogMode, debug: { raw: rawResults, basic: basicResults } };
        } catch (e) { return { success: false, error: e.toString() }; }
    })()`;

    for (const cdp of cdpList) {
        console.log(`--- Testing CDP: ${cdp.title} ---`);
        for (const ctx of (cdp.contexts.length > 0 ? cdp.contexts : [{id: undefined}])) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXTRACT_SCRIPT, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.success) {
                    console.log(JSON.stringify(res.result.value, null, 2));
                }
            } catch (e) {}
        }
    }
}

diagnose().then(() => process.exit(0));
