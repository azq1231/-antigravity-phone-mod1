export async function getDetailedUsage(cdpList, port = 9001) {
    const { getOrConnectParams } = await import('./cdp_manager.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const calculateETA = (countdown) => {
        if (!countdown || countdown === 'N/A') return 'N/A';
        try {
            let totalMs = 0;
            const d = countdown.match(/(\d+)d/i);
            const h = countdown.match(/(\d+)h/i);
            const m = countdown.match(/(\d+)m/i);
            const s = countdown.match(/(\d+)s/i);

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

            // 1. 先抓狀態列作為基礎百分比
            try {
                document.querySelectorAll('.statusbar-item').forEach(el => {
                    const text = (el.innerText || "") + (el.getAttribute('aria-label') || "");
                    const regex = /(Pro|Flash|Claude):?\\s*([0-9.]+)?%?/gi;
                    let m;
                    while ((m = regex.exec(text)) !== null) {
                        const key = getGroupKey(m[1]);
                        if (key) {
                            if (!rawResults[key]) rawResults[key] = { percent: "N/A", countdown: "N/A", eta: "N/A" };
                            if (m[2]) rawResults[key].percent = m[2] + "%";
                        }
                    }
                });
            } catch(e) {}

            // 2. 深度解析：尋找所有包含模型資訊的容器
            const allElements = Array.from(document.querySelectorAll('div, section, [role="dialog"] div, .monaco-list-row'));
            allElements.forEach(container => {
                const isNoise = container.closest('.monaco-editor, .view-lines, .terminal-container, .interactive-session, .chat-panel, .message-list-item, .suggest-widget');
                if (isNoise) return;

                const cText = (container.innerText || "").trim();
                if (cText.length > 500 || cText.length < 5) return;

                // 在同一個容器內搜尋多個模型匹配
                const modelRegex = /(Flash|Pro|Claude|GPT-4o)/gi;
                let match;
                while ((match = modelRegex.exec(cText)) !== null) {
                    const modelName = match[1];
                    const key = getGroupKey(modelName);
                    if (!key) continue;

                    // 僅限在模型名稱之後的 100 字元內尋找數據，避免跨模型誤抓
                    const subText = cText.substring(match.index, match.index + 100);
                    
                    if (!rawResults[key]) rawResults[key] = { percent: "N/A", countdown: "N/A", eta: "N/A" };

                    // 1. 提取百分比
                    const pm = subText.match(/([0-9.]+)\s*%/);
                    if (pm && rawResults[key].percent === 'N/A') {
                        rawResults[key].percent = pm[1] + "%";
                    }
                    
                    // 2. 提取倒計時 (採用 trace_hits.js 驗證成功的樣式，但加強邊界防止抓到下一個模型)
                    const cdMatch = subText.match(/重置倒計時:?\\s*([^\\n%]{2,15})/i) || 
                                   subText.match(/%\\s*([^\\n%]{2,15})/i);
                    
                    if (cdMatch && rawResults[key].countdown === 'N/A') {
                        const val = cdMatch[1].trim();
                        // 驗證是否含有數字且符合時間格式 (d/h/m)
                        if (/\\d/.test(val) && /[dhm]/i.test(val) && val.length < 15) {
                            rawResults[key].countdown = val;
                        }
                    }

                    // 3. 提取 ETA
                    const etaMatch = subText.match(/重置時間:?\\s*(\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}\\s*[\\d:]+)/);
                    if (etaMatch && rawResults[key].eta === 'N/A') {
                        rawResults[key].eta = etaMatch[1].trim();
                    }

                    // 標記是否為對話框
                    const isDialog = container.closest('.monaco-dialog-box, .monaco-dialog-container, .quick-input-widget');
                    if (isDialog) isDialogMode = true;
                }
            });

            // 補完模型項目
            ['Gemini 3 Flash', 'Gemini 3 Pro (H/L)', 'Claude / GPT-4o'].forEach(model => {
                finalData[model] = rawResults[model] || { percent: "N/A", countdown: "N/A", eta: "N/A" };
            });
            return { success: true, data: finalData, isDialogMode };
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
                    
                    // 檢查數據完整性
                    const hasPercent = Object.values(data).some(d => d.percent !== 'N/A');
                    const hasCountdown = Object.values(data).some(d => d.countdown !== 'N/A');
                    
                    // 如果有倒計時，這是最理想的結果，直接返回
                    if (hasCountdown) {
                        // 自動補完 ETA (如果顯示 N/A)
                        Object.keys(data).forEach(k => {
                            if (data[k].eta === 'N/A' && data[k].countdown !== 'N/A') {
                                data[k].eta = calculateETA(data[k].countdown);
                            }
                        });
                        return val;
                    }
                    
                    // 如果只有百分比，先存起來作為備案
                    if (hasPercent && !bestResult) bestResult = val;
                    if (hasPercent && !global.tempBasicData) global.tempBasicData = val;
                }
            }
        } catch(e) {}
        
        // 對備案結果也進行 ETA 補全
        if (bestResult?.data) {
            Object.keys(bestResult.data).forEach(k => {
                if (bestResult.data[k].eta === 'N/A' && bestResult.data[k].countdown !== 'N/A') {
                    bestResult.data[k].eta = calculateETA(bestResult.data[k].countdown);
                }
            });
        }
        return bestResult;
    };

    const doPhysicalClick = async (cdp, query) => {
        const script = `(() => {
            const els = Array.from(document.querySelectorAll('.statusbar-item, *')).filter(el => {
                const isNoise = el.closest('.monaco-editor, .view-lines');
                if (isNoise) return false;
                const t = ((el.getAttribute('aria-label')||"") + " " + (el.innerText || "")).toLowerCase();
                return t.includes("${query}".toLowerCase()) && el.offsetParent && el.getBoundingClientRect().width > 0;
            });
            const target = els.sort((a,b) => {
                const aIsStatus = a.classList.contains('statusbar-item') ? 0 : 1;
                const bIsStatus = b.classList.contains('statusbar-item') ? 0 : 1;
                if (aIsStatus !== bIsStatus) return aIsStatus - bIsStatus;
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
        if (res) return res;
    }

    // Phase 2: 觸發詳細資訊
    const wb = cdpList.find(c => c.title.includes('Antigravity') || c.title.includes('WSL')) || cdpList[0];
    if (wb) {
        if (await doPhysicalClick(wb, "Antigravity") || await doPhysicalClick(wb, "%")) {
            await sleep(2500);
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
                if (res) return res;
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
