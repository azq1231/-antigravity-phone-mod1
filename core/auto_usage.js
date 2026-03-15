export async function getDetailedUsage(cdpList, port = 9001) {
    const { getOrConnectParams } = await import('./cdp_manager.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const EXTRACT_SCRIPT = `(() => {
        try {
            const finalData = {};
            const rawResults = {};
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

            // 2. 深度解析：尋找所有卡片容器
            // 我們尋找包含模型關鍵字的 div，並確保它是該組數據的容器
            const allElements = Array.from(document.querySelectorAll('div, section'));
            allElements.forEach(container => {
                // 判斷是否為「模型數據卡片」：包含百分比圓圈或重置時間字眼
                const cText = container.innerText || "";
                if (container.children.length > 2 && (cText.includes('重置倒計時') || cText.includes('重置時間'))) {
                    // 在這個容器內尋找模型標籤
                    let key = null;
                    if (cText.match(/^Flash\\b/m)) key = nameMap['Flash'];
                    else if (cText.match(/^Pro\\b/m)) key = nameMap['Pro'];
                    else if (cText.match(/^Claude\\b/m)) key = nameMap['Claude'];
                    
                    if (key) {
                        if (!rawResults[key]) rawResults[key] = { percent: "N/A", countdown: "N/A", eta: "N/A" };
                        
                        // 提取百分比 (大號字體通常是百分比)
                        const pm = cText.match(/([0-9.]+)\\s*%/);
                        if (pm) rawResults[key].percent = pm[1] + "%";
                        
                        // 提取「重置倒計時」後方的內容
                        const cdMatch = cText.match(/重置倒計時\\s+([0-9d hms]+)/);
                        if (cdMatch) rawResults[key].countdown = cdMatch[1].trim();
                        
                        // 提取「重置時間」後方的內容 (支持日期格式)
                        const etaMatch = cText.match(/重置時間\\s+([0-9/ :]+)/);
                        if (etaMatch) rawResults[key].eta = etaMatch[1].trim();
                    }
                }
            });

            // 補完模型項目
            ['Gemini 3 Flash', 'Gemini 3 Pro (H/L)', 'Claude / GPT-4o'].forEach(model => {
                finalData[model] = rawResults[model] || { percent: "N/A", countdown: "N/A", eta: "N/A" };
            });
            return { success: true, data: finalData };
        } catch (e) { return { success: false, error: e.toString() }; }
    })()`;

    // 輔助函式與 Phase 邏輯保持不變，但點擊與掃描會更徹底
    const evalWithFallback = async (cdp, s) => {
        try {
            for (const ctxId of [undefined, 1, 2, 3]) {
                const res = await cdp.call("Runtime.evaluate", { expression: s, returnByValue: true, contextId: ctxId }).catch(() => null);
                if (res?.result?.value?.success) {
                    const data = res.result.value.data;
                    const hasDetail = Object.values(data).some(d => d.countdown !== 'N/A');
                    if (hasDetail) return res.result.value;
                    if (!global.tempBasicData) global.tempBasicData = res.result.value;
                }
            }
        } catch(e) {}
        return null;
    };

    const doPhysicalClick = async (cdp, query) => {
        const script = `(() => {
            const els = Array.from(document.querySelectorAll('*')).filter(el => {
                const t = ((el.getAttribute('aria-label')||"") + " " + (el.innerText || "")).toLowerCase();
                return t.includes("${query}".toLowerCase()) && el.offsetParent && el.getBoundingClientRect().width > 0;
            });
            const target = els.sort((a,b) => a.innerText.length - b.innerText.length)[0];
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
                if (await doPhysicalClick(win, "Models")) {
                    await sleep(3000); // 給予更多時間渲染卡片
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
