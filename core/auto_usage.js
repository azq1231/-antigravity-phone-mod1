export async function getDetailedUsage(cdpList, port = 9001) {
    const { getOrConnectParams } = await import('./cdp_manager.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const calculateETA = (countdown) => {
        if (!countdown || countdown === 'N/A') return 'N/A';
        try {
            let totalMs = 0;
            const d = countdown.match(/(\d+)\s*(?:d|天)/i);
            const h = countdown.match(/(\d+)\s*(?:h|時)/i);
            const m = countdown.match(/(\d+)\s*(?:m|分)/i);
            const s = countdown.match(/(\d+)\s*(?:s|秒)/i);

            if (d) totalMs += parseInt(d[1]) * 24 * 60 * 60 * 1000;
            if (h) totalMs += parseInt(h[1]) * 60 * 60 * 1000;
            if (m) totalMs += parseInt(m[1]) * 60 * 1000;
            if (s) totalMs += parseInt(s[1]) * 1000;

            if (totalMs === 0) return 'N/A';
            const etaDate = new Date(Date.now() + totalMs);
            
            // 格式化為 YYYY/MM/DD HH:mm
            const pad = (n) => n.toString().padStart(2, '0');
            return `${etaDate.getFullYear()}/${pad(etaDate.getMonth() + 1)}/${pad(etaDate.getDate())} ${pad(etaDate.getHours())}:${pad(etaDate.getMinutes())}`;
        } catch (e) { return 'N/A'; }
    };

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
                if (n.includes('gpt') || n.includes('claude') || n.includes('4o')) return nameMap['Claude'];
                return null;
            };

            const basicResults = {};
            // 1. 先抓狀態列作為基礎百分比
            try {
                document.querySelectorAll('.statusbar-item').forEach(el => {
                    const text = (el.innerText || "") + (el.getAttribute('aria-label') || "");
                    const regex = /(Pro|Flash|Claude):?\\s*([0-9.]+)?%?/gi;
                    let m;
                    while ((m = regex.exec(text)) !== null) {
                        const key = getGroupKey(m[1]);
                        if (key) {
                            if (m[2]) basicResults[key] = m[2] + "%";
                        }
                    }
                });
            } catch(e) {}

            // 2. 深度解析：遞迴尋找所有包含模型資訊的容器
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

                        // 1. 提取百分比
                        const pm = cleanSub.match(/([0-9.]+)\\s*%/);
                        if (pm && (rawResults[key].percent === 'N/A' || currentPriority >= 2)) {
                            rawResults[key].percent = pm[1].includes('.') ? pm[1] + "%" : parseInt(pm[1]) + "%";
                        }
                        
                        // 2. 提取倒計時
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

                        // 3. 提取 ETA
                        const etaStrPattern = "(\\\\d{4}[/-]\\\\d{1,2}[/-]\\\\d{1,2}\\\\s*[\\\\d:]+|\\\\d{1,2}:\\\\d{2})";
                        const etaMatch = cleanSub.match(new RegExp("(?:重置時間|\\\\(|\\\\s)" + etaStrPattern, "i")) ||
                                         cleanSub.match(new RegExp(etaStrPattern, "i"));
                        
                        if (etaMatch && (rawResults[key].eta === 'N/A' || currentPriority >= 2)) {
                            let etaVal = etaMatch[1].trim();
                            let valid = true;
                            if (etaVal.length <= 5 && etaVal.includes(':')) {
                                const h = parseInt(etaVal.split(':')[0]);
                                if (isNaN(h) || h >= 24) valid = false;
                                else {
                                    const now = new Date();
                                    const pad = (n) => n.toString().padStart(2, '0');
                                    etaVal = now.getFullYear() + "/" + pad(now.getMonth() + 1) + "/" + pad(now.getDate()) + " " + etaVal;
                                }
                            }
                            if (valid) rawResults[key].eta = etaVal;
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
                // 如果詳細數據沒抓到百分比，拿狀態列的補
                if (res.percent === 'N/A' && basicResults[model]) {
                    res.percent = basicResults[model];
                }
                finalData[model] = res;
            });
            return { success: true, data: finalData, isDialogMode, debug: { raw: rawResults, basic: basicResults } };
        } catch (e) { return { success: false, error: e.toString() }; }
    })()`;

    const evalWithFallback = async (cdp, s) => {
        let bestResult = null;
        try {
            const ctxIds = (cdp.contexts && cdp.contexts.length > 0) ? cdp.contexts.map(c => c.id) : [];
            for (const ctxId of [undefined, ...ctxIds]) {
                const res = await cdp.call("Runtime.evaluate", { expression: s, returnByValue: true, contextId: ctxId }).catch(() => null);
                if (res?.result?.value?.success) {
                    const val = res.result.value;
                    const data = val.data;
                    
                    if (val.isDialogMode) console.log(`[DetailedUsage] Found Dialog Mode on Port ${port}`);

                    // 檢查數據完整性
                    const hasCountdown = Object.values(data).some(d => d.countdown !== 'N/A');
                    const hasPercent = Object.values(data).some(d => d.percent !== 'N/A');
                    
                    if (hasCountdown) {
                        Object.keys(data).forEach(k => {
                            if (data[k].eta === 'N/A' && data[k].countdown !== 'N/A') {
                                data[k].eta = calculateETA(data[k].countdown);
                            }
                        });
                        return val;
                    }
                    if (hasPercent && !bestResult) bestResult = val;
                    if (hasPercent && !global.tempBasicData) global.tempBasicData = val;
                }
            }
        } catch(e) {}
        return bestResult;
    };

    const doPhysicalClick = async (cdp, query) => {
        const script = `(() => {
            const els = Array.from(document.querySelectorAll('.statusbar-item, *')).filter(el => {
                const isNoise = el.closest('.monaco-editor, .view-lines');
                if (isNoise) return false;
                const t = ((el.getAttribute('aria-label')||"") + " " + (el.innerText || "")).toLowerCase();
                const isSettings = t.includes("settings");
                if (isSettings) return false;
                return t.includes("${query}".toLowerCase()) && el.offsetParent && el.getBoundingClientRect().width > 0;
            });
            const target = els.sort((a,b) => {
                const aIsStatus = a.classList.contains('statusbar-item') ? 0 : 1;
                const bIsStatus = b.classList.contains('statusbar-item') ? 0 : 1;
                if (aIsStatus !== bIsStatus) return aIsStatus - bIsStatus;
                // Prefer shorter text (more likely to be the % bubble)
                return a.innerText.length - b.innerText.length;
            })[0];
            if (target) {
                const r = target.getBoundingClientRect();
                return { x: Math.floor(r.x + r.width/2), y: Math.floor(r.y + r.height/2) };
            }
            return null;
        })()`;
        const res = await cdp.call("Runtime.evaluate", { expression: script, returnByValue: true }).catch(() => null);
        const c = res?.result?.value;
        if (c && c.x) {
            await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
            await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
            return true;
        }
        return false;
    };

    global.tempBasicData = null;

    // Phase 1: 靜態掃描
    for (const c of cdpList) {
        const res = await evalWithFallback(c, EXTRACT_SCRIPT);
        // 如果有倒計時則直接返回，否則繼續 Phase 2 去點擊
        if (res && res.data && Object.values(res.data).some(d => d.countdown !== 'N/A')) {
            return res;
        }
    }

    // Phase 2: 觸發並優先抓取小視窗 (Popup)
    const wb = cdpList.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || cdpList[0];
    if (wb) {
        // 1. 嘗試點擊狀態列的 % 打開「小視窗」 (避開 Settings)
        if (await doPhysicalClick(wb, "%") || await doPhysicalClick(wb, "Pro:") || await doPhysicalClick(wb, "Flash:")) {
            await sleep(2000); // 等待小視窗彈出
            
            const postClickWindows = await getOrConnectParams(port, true);
            for (const win of postClickWindows) {
                const res = await evalWithFallback(win, EXTRACT_SCRIPT);
                // 如果已經抓到了 Popup 小視窗 (Dialog)，就不應該再執行後續的盲目點擊 fallback
                if (res?.isDialogMode) return res;
            }

            // 2. 如果小視窗沒抓到完整數據，再嘗試點進「詳細/監控分頁」 (作為備案)
            await doPhysicalClick(wb, "Advanced");
            await sleep(1500);
            
            const allWindows = await getOrConnectParams(port, true);
            for (const win of allWindows) {
                if (await doPhysicalClick(win, "Models") || await doPhysicalClick(win, "Quota")) {
                    await sleep(3000);
                    break;
                }
            }

            const finalSweep = await getOrConnectParams(port, true);
            for (const f of finalSweep) {
                const res = await evalWithFallback(f, EXTRACT_SCRIPT);
                if (res?.data && Object.values(res.data).some(d => d.countdown !== 'N/A')) return res;
            }
        }
    }

    return global.tempBasicData || { success: false, error: 'Detailed data not found' };
}

export async function openUsageDialog(cdpList) {
    const SCRIPT = `(() => {
        const label = Array.from(document.querySelectorAll('.statusbar-item')).find(el => (el.innerText || "").includes('%'));
        if (label) { label.click(); return { success: true }; }
        return { error: 'Not found' };
    })()`;
    for (const cdp of cdpList) {
        const res = await cdp.call("Runtime.evaluate", { expression: SCRIPT, returnByValue: true });
        if (res.result?.value?.success) return res.result.value;
    }
    return { error: 'Failed' };
}
