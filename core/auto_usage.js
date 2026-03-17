export async function getDetailedUsage(cdpList, port = 9001) {
    const { getOrConnectParams } = await import('./cdp_manager.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const LOG_PREFIX = `[Quota-V4-Port${port}]`;

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
                if (n.includes('gpt') || n.includes('claude') || n.includes('sonnet') || n.includes('4o')) return nameMap['Claude'];
                return null;
            };

            const basicResults = {};
            // 1. 先抓狀態列作為基礎百分比
            try {
                document.querySelectorAll('.statusbar-item').forEach(el => {
                    const text = (el.innerText || "") + " " + (el.getAttribute('aria-label') || "");
                    // 修正：必須要有 % 符號才抓取，避免抓到 Sonnet 4.6 的 4.6
                    const regex = /(Pro|Flash|Claude|Sonnet|GPT):?\\s*([0-9.]+)\\s*%/gi;
                    let m;
                    while ((m = regex.exec(text)) !== null) {
                        const key = getGroupKey(m[1]);
                        if (key && m[2]) {
                            const val = m[2];
                            // 再次過濾常見版本號
                            if (val !== "4.6" && val !== "3.1" && val !== "120") {
                                basicResults[key] = val + "%";
                            }
                        }
                    }
                });
            } catch(e) {}

            // 2. 深度解析：遞迴尋找所有包含模型資訊的容器
            const scan = (doc, prefix = "") => {
                // 優先尋找「行」容器，這能有效防止模型數據交叉汙染
                const rows = Array.from(doc.querySelectorAll('.monaco-list-row, .quota-compact-item, tr, .card, [role="row"]'));
                
                // 如果沒有行容器，才去找 div (但限制大小)
                const fallbackContainers = rows.length > 0 ? [] : Array.from(doc.querySelectorAll('div, section')).filter(el => {
                    const t = el.innerText || "";
                    return t.length > 10 && t.length < 500;
                });

                [...rows, ...fallbackContainers].forEach(container => {
                    const isNoise = container.closest('.monaco-editor, .view-lines, .terminal-container, .interactive-session, .chat-panel, .message-list-item, .suggest-widget');
                    if (isNoise) return;

                    const cText = (container.innerText || "").trim();
                    if (!cText || cText.length > 2000) return;

                    const modelRegex = /(Flash|Pro|Claude|Sonnet|GPT-4o|Opus)/gi;
                    let match;
                    while ((match = modelRegex.exec(cText)) !== null) {
                        const modelName = match[1];
                        const key = getGroupKey(modelName);
                        if (!key) continue;

                        if (!rawResults[key]) rawResults[key] = { percent: "N/A", countdown: "N/A", eta: "N/A", priority: -1 };

                        const isDialog = container.closest('.monaco-dialog-box, .monaco-dialog-container, .quick-input-widget, [role="dialog"], .modal-card, .antigravity-usage-popup');
                        const hasPopupMarker = cText.includes('🚀') || cText.includes('點擊打開') || cText.includes('打開配額監控') || doc.title.includes('配額');
                        const isMonitorTab = cText.includes('帳號總覽') || cText.includes('配額歷史') || cText.includes('管理模型') || cText.includes('恢復時間');
                        
                        let currentPriority = 0;
                        if (hasPopupMarker && !isMonitorTab) currentPriority = 3;
                        else if (isDialog) currentPriority = 2;
                        else if (isMonitorTab) currentPriority = 1;

                        if (currentPriority < rawResults[key].priority) continue;
                        rawResults[key].priority = currentPriority;

                        // 在當前容器內尋找數據
                        // 改進百分比匹配：確保不是型號名稱的一部分 (例如 4.6%)
                        // 優先尋找 箭頭後面的百分比，或是獨立的數字百分比
                        const pm = cText.match(/(?:->|→|重置)\\s*([0-9.]+)\\s*%/) || 
                                   cText.match(/(?:^|\\s)([0-9.]+)\\s*%/);
                        if (pm) {
                            const val = pm[1];
                            // 排除像 4.6 這種型號關鍵字
                            if (val !== "4.6" && val !== "120" && val !== "4") {
                                rawResults[key].percent = val.includes('.') ? val + "%" : parseInt(val) + "%";
                            }
                        }
                        
                        const timeStrPattern = "((?:\\\\d+\\\\s*(?:[dhms](?![a-z])|[時分秒天])\\\\s*){1,4})";
                        const cdMatch = cText.match(new RegExp("(?:重置倒計時|->|%|\\\\s)" + timeStrPattern, "i")) ||
                                       cText.match(new RegExp(timeStrPattern, "i"));
                        
                        if (cdMatch) {
                            let val = cdMatch[1].trim();
                            const isNoiseStr = /Claude|Flash|Pro|GPT-4o|\\\\||分鐘前|分前|秒前|statusBar|settings/i.test(val);
                            if (!isNoiseStr && /\\\\d/.test(val) && val.length > 1 && val.length < 35) {
                                rawResults[key].countdown = val;
                            }
                        }

                        const etaStrPattern = "(\\\\d{4}[/-]\\\\d{1,2}[/-]\\\\d{1,2}\\\\s*[\\\\d:]+|\\\\d{1,2}:\\\\d{2})";
                        const etaMatch = cText.match(new RegExp("(?:重置時間|\\\\(|\\\\s)" + etaStrPattern, "i")) ||
                                         cText.match(new RegExp(etaStrPattern, "i"));
                        
                        if (etaMatch) {
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

    // Phase 1: 靜態掃描所有現有的視窗 (包含隱藏的 Monitor 頁面)
    for (const c of cdpList) {
        const res = await evalWithFallback(c, EXTRACT_SCRIPT);
        // 如果已經有倒計時，說明抓到了彈窗或是監控頁面，直接回傳
        if (res && res.data && Object.values(res.data).some(d => d.countdown !== 'N/A')) {
            console.log(`${LOG_PREFIX} Passive scan success on ${c.title}`);
            return res;
        }
    }

    // Phase 2: 觸發掃描 (只有在 Phase 1 沒抓到倒計時的情況下才點擊)
    const wb = cdpList.find(c => c.title.includes('Antigravity') || c.title.includes('WSL') || c.title.includes('Workbench')) || cdpList[0];
    if (wb) {
        console.log(`${LOG_PREFIX} Attempting trigger click on ${wb.title}...`);
        // 1. 嘗試點擊狀態列。支援多種可能的文字模式
        const clicked = await doPhysicalClick(wb, "%") || 
                        await doPhysicalClick(wb, "Pro") || 
                        await doPhysicalClick(wb, "Flash") || 
                        await doPhysicalClick(wb, "Quota");

        if (clicked) {
            await sleep(1500); // 等待時間縮小到 1.5s，提高反應速度
            
            // 重新取得連線，但不強制斷開舊有的 (forceReconnect=false)，減少資源浪費
            const postClickWindows = await getOrConnectParams(port, false); 
            for (const win of postClickWindows) {
                const res = await evalWithFallback(win, EXTRACT_SCRIPT);
                if (res?.isDialogMode) {
                    console.log(`${LOG_PREFIX} Active trigger success (Dialog)`);
                    return res;
                }
            }

            // 備選方案：點擊 Advanced 進入監控頁面
            await doPhysicalClick(wb, "Advanced");
            await sleep(1000);
            
            const allWindows = await getOrConnectParams(port, false);
            for (const win of allWindows) {
                // 嘗試在監控頁面中切換分頁
                if (await doPhysicalClick(win, "Models") || await doPhysicalClick(win, "Quota")) {
                    await sleep(2000);
                    const res = await evalWithFallback(win, EXTRACT_SCRIPT);
                    if (res?.data && Object.values(res.data).some(d => d.countdown !== 'N/A')) {
                        console.log(`${LOG_PREFIX} Detailed monitor scan success`);
                        return res;
                    }
                }
            }
        }
    }

    console.log(`${LOG_PREFIX} Returning basic data (Fallback)`);
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
