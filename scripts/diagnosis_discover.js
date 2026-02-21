import fs from 'fs';
import { activeConnections, getOrConnectParams } from '../core/cdp_manager.js';
import { discoverModels, captureSnapshot, setModel, getAppState, injectMessage } from '../core/automation.js';

async function diagnose() {
    console.log("🔍 [DIAGNOSIS] Starting Comprehensive V4.2 Diagnosis (Phase 4)...");
    const PORTS = [9000, 9001, 9002, 9003];
    const perfLogPath = './scripts/perf_baseline.json';

    const metrics = {
        timestamp: new Date().toISOString(),
        ports: {},
        active_cdp_conns: activeConnections.size,
        health_score: 100
    };

    try {
        // --- 1. Multi-Port Availability Scan ---
        console.log("\n--- 1. Infrastructure Health ---");
        console.log(`📡 Active CDP Sessions: ${metrics.active_cdp_conns} (Target: < 10)`);
        if (metrics.active_cdp_conns > 10) {
            console.warn("⚠️ Warning: High number of CDP sessions. Might cause memory pressure.");
            metrics.health_score -= 10;
        }

        for (const p of PORTS) {
            try {
                const conns = await getOrConnectParams(p);
                console.log(`Port ${p}: ✅ Alive (${conns.length} contexts)`);
                metrics.ports[p] = { alive: true, contexts: conns.length };
            } catch (e) {
                console.log(`Port ${p}: ❌ Offline/Busy`);
                metrics.ports[p] = { alive: false };
            }
        }

        const mainPort = 9000;
        const conns = await getOrConnectParams(mainPort);

        // --- 2. App State & Discovery ---
        console.log("\n--- 2. Logic Layer ---");
        const state = await getAppState(conns);
        console.log("📊 App State:", JSON.stringify(state, null, 2));

        const modelResult = await discoverModels(conns);
        metrics.models_count = modelResult.models?.length || 0;
        console.log(`✅ Models: ${metrics.models_count} detected.`);

        // --- 3. Snapshot Performance Deep Dive ---
        console.log("\n--- 3. Performance & Sanitization ---");
        const diagStartTime = Date.now();
        const snapshot = await captureSnapshot(conns);
        const roundTripTime = Date.now() - diagStartTime;

        if (snapshot.error) {
            console.error("❌ Snapshot failed:", snapshot.error);
            metrics.health_score = 0;
        } else {
            const htmlSize = Buffer.byteLength(snapshot.html, 'utf8');
            const cssSize = Buffer.byteLength(snapshot.css, 'utf8');

            metrics.html_kb = parseFloat((htmlSize / 1024).toFixed(1));
            metrics.css_kb = parseFloat((cssSize / 1024).toFixed(1));
            metrics.extra_latency = roundTripTime - (snapshot.duration || 0);
            metrics.browser_duration = snapshot.duration || 0;

            console.log(`📏 Sizes: HTML ${metrics.html_kb} KB, CSS ${metrics.css_kb} KB`);
            console.log(`⏱️ Latency: Browser ${metrics.browser_duration}ms, Network/CDP Overlap ${metrics.extra_latency}ms`);

            // Health Scoring
            if (metrics.css_kb > 500) { console.warn("⚠️ CSS > 500KB - Deducting score"); metrics.health_score -= 20; }
            if (metrics.browser_duration > 500) { console.warn("⚠️ Browser Latency > 500ms"); metrics.health_score -= 15; }
            if (metrics.html_kb > 300) { console.warn("⚠️ HTML > 300KB"); metrics.health_score -= 10; }

            // Security Check
            const leakCount = (snapshot.html.match(/D:\/Program Files/g) || []).length;
            if (leakCount > 0) {
                console.error(`❌ SECURITY: ${leakCount} leaked absolute paths found!`);
                metrics.health_score = 0;
            } else {
                console.log("✅ Sanitization: Passed.");
            }

            // Connectivity
            const sampleIcon = "http://localhost:3004/vscode-resources/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/document.svg";
            try {
                const res = await fetch(sampleIcon, { method: 'HEAD' });
                if (res.ok) console.log("✅ Virtual Assets: 200 OK");
                else { console.error("❌ Virtual Assets: 404"); metrics.health_score -= 30; }
            } catch (e) { console.log("ℹ️ Connectivity skip (server off)"); }
        }

        // --- 4. Interactive Layer Check ---
        console.log("\n--- 4. Interactive Layer Check ---");
        const editorCheckScript = `(() => {
            const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
            return { count: editors.length, tag: editors[0]?.tagName, visible: editors[0]?.offsetHeight > 0, html: editors[0]?.innerHTML };
        })()`;

        let foundEditor = false;
        let editorData = null;
        for (const ctx of conns[0]?.contexts || []) {
            try {
                const res = await conns[0].call("Runtime.evaluate", { expression: editorCheckScript, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.count > 0) {
                    editorData = res.result.value;
                    console.log(`✅ Editor found in Context ${ctx.id}: ${JSON.stringify(editorData)}`);
                    foundEditor = true;
                    break;
                }
            } catch (e) { }
        }
        if (!foundEditor) console.warn("⚠️ Warning: No active editor found in current contexts.");

        // --- 5. Message Injection Test (New Phase 4 Tool) ---
        console.log("\n--- 5. Message Injection & Duplication Test ---");
        if (foundEditor) {
            const testMsg = `DIAG_TEST_${Date.now()}`;
            console.log(`🚀 Injecting test message: "${testMsg}"`);
            const injectStart = Date.now();
            const injectRes = await injectMessage(conns, testMsg);
            const injectTime = Date.now() - injectStart;

            console.log(`📊 Injection Result: ${JSON.stringify(injectRes)} (Time: ${injectTime}ms)`);

            if (injectRes.ok) {
                console.log("⏳ Waiting 3s for message processing...");
                await new Promise(r => setTimeout(r, 3000));

                const finalSnap = await captureSnapshot(conns);
                const occurrences = (finalSnap.html.match(new RegExp(testMsg, 'g')) || []).length;

                if (occurrences > 1) {
                    console.error(`❌ DUPLICATION DETECTED: Message appeared ${occurrences} times in snapshot!`);
                    metrics.health_score -= 40;
                } else if (occurrences === 1) {
                    console.log("✅ Verified: Message exists once in snapshot.");
                } else {
                    console.warn("⚠️ Warning: Message NOT found in snapshot after injection (maybe not sent or UI slow).");
                }

                // Check if editor is cleared
                const finalEditor = await conns[0].call("Runtime.evaluate", { expression: editorCheckScript, returnByValue: true });
                const editorHtml = finalEditor.result?.value?.html || "";
                if (editorHtml.includes(testMsg)) {
                    console.error("❌ ERROR: Editor was NOT cleared after sending!");
                    metrics.health_score -= 20;
                } else {
                    console.log("✅ Verified: Editor is clear.");
                }
            } else {
                console.error("❌ Injection Failed:", injectRes.error);
                metrics.health_score -= 30;
            }
        }

        // Final Score
        const rank = metrics.health_score >= 90 ? 'S (Excellent)' : metrics.health_score >= 75 ? 'A (Good)' : 'B (Needs Attention)';
        console.log(`\n🏆 FINAL HEALTH SCORE: ${metrics.health_score}/100 [Rank: ${rank}]`);

        // Persistence (Phase 4 Core)
        let history = [];
        if (fs.existsSync(perfLogPath)) {
            try { history = JSON.parse(fs.readFileSync(perfLogPath)); } catch (e) { }
        }
        history.push(metrics);
        // Keep last 50 entries
        if (history.length > 50) history.shift();
        fs.writeFileSync(perfLogPath, JSON.stringify(history, null, 2));
        console.log(`💾 Performance trend saved to: ${perfLogPath}`);

    } catch (e) {
        console.error("💥 FATAL:", e.message);
    }
}

diagnose();
