import { activeConnections, getOrConnectParams } from '../core/cdp_manager.js';
import { discoverModels, captureSnapshot, setModel, getAppState } from '../core/automation.js';

async function diagnose() {
    console.log("🔍 [DIAGNOSIS] Starting Comprehensive V4.2 Diagnosis...");
    const PORTS = [9000, 9001, 9002, 9003];

    try {
        // --- 1. Multi-Port Availability Scan ---
        console.log("\n--- 1. Multi-Port Availability Scan ---");
        for (const p of PORTS) {
            try {
                const conns = await getOrConnectParams(p);
                console.log(`Port ${p}: ✅ Alive (${conns.length} contexts)`);
            } catch (e) {
                console.log(`Port ${p}: ❌ Offline/Busy`);
            }
        }

        const mainPort = 9000;
        const conns = await getOrConnectParams(mainPort);
        console.log(`\nUsing Port ${mainPort} for deep diagnosis...`);

        // --- 2. App State & Model Discovery ---
        console.log("\n--- 2. App & Model Integration ---");
        const state = await getAppState(conns);
        console.log("📊 App State Found:", JSON.stringify(state, null, 2));

        const modelResult = await discoverModels(conns);
        if (modelResult.error) {
            console.error("❌ Model Discovery Failed:", modelResult.error);
        } else {
            console.log("✅ Models Found:", modelResult.models.length, "models available");
            console.log("   Sample Models:", modelResult.models.slice(0, 3).join(", "));
        }

        // --- 3. Snapshot Health & Sanitization ---
        console.log("\n--- 3. Snapshot Health & Sanitization ---");
        const snapshot = await captureSnapshot(conns);
        if (snapshot.error) {
            console.error("❌ Snapshot failed:", snapshot.error);
        } else {
            const htmlSize = Buffer.byteLength(snapshot.html, 'utf8');
            const cssSize = Buffer.byteLength(snapshot.css, 'utf8');
            console.log(`📏 Snapshot Size: HTML ${(htmlSize / 1024).toFixed(1)} KB, CSS ${(cssSize / 1024).toFixed(1)} KB`);
            console.log(`🎯 Match Quality: ${snapshot.matchQuality} (Target Found: ${snapshot.foundTarget})`);

            if (htmlSize > 300 * 1024) console.warn("⚠️ Warning: Snapshot HTML is quite large (>300KB), might slow down the phone.");

            // Path Security Check
            const leaks = [];
            if (snapshot.html.includes("D:/Program Files")) leaks.push("D:/Program Files");
            if (snapshot.html.includes("C:/Users")) leaks.push("C:/Users");
            if (snapshot.html.includes(".gemini")) leaks.push(".gemini");

            if (leaks.length > 0) {
                console.error("❌ SECURITY LEAK: Found un-sanitized paths:", leaks.join(", "));
            } else {
                console.log("✅ Sanitization: All sensitive absolute paths are hidden.");
            }

            // Connectivity Test
            const sampleIcon = "http://localhost:3004/vscode-resources/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/document.svg";
            console.log(`🔗 Testing resource availability: ${sampleIcon}`);
            try {
                const res = await fetch(sampleIcon, { method: 'HEAD' });
                if (res.ok) console.log("✅ Resource is ACCESSIBLE (200 OK)");
                else console.error(`❌ Resource is NOT accessible (${res.status} ${res.statusText})`);
            } catch (e) {
                console.log(`ℹ️ Connectivity test failed: ${e.message} (Is server running?)`);
            }
        }

        // --- 4. Interactive Layer Check ---
        console.log("\n--- 4. Interactive Layer Check ---");
        const editorCheckScript = `(() => {
            const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
            return { count: editors.length, tag: editors[0]?.tagName, visible: editors[0]?.offsetHeight > 0 };
        })()`;

        let foundEditor = false;
        for (const ctx of conns[0]?.contexts || []) {
            try {
                const res = await conns[0].call("Runtime.evaluate", { expression: editorCheckScript, returnByValue: true, contextId: ctx.id });
                if (res.result?.value?.count > 0) {
                    console.log(`✅ Editor found in Context ${ctx.id}: ${JSON.stringify(res.result.value)}`);
                    foundEditor = true;
                    break;
                }
            } catch (e) { }
        }
        if (!foundEditor) console.warn("⚠️ Warning: No active editor found in current contexts. Message injection might fail.");

    } catch (e) {
        console.error("💥 FATAL DIAGNOSIS ERROR:", e.message);
    }
}

diagnose();
