import { getOrConnectParams } from '../core/cdp_manager.js';
import { discoverModels, captureSnapshot, setModel, getAppState } from '../core/automation.js';

async function diagnose() {
    console.log("🔍 [DIAGNOSIS] Starting Comprehensive Diagnosis...");
    const port = 9000;

    try {
        const conns = await getOrConnectParams(port);
        console.log("✅ CDP Connected (Targets:", conns.length, ")");

        // Test 4: App State
        console.log("\n--- Test 4: App State ---");
        const state = await getAppState(conns);
        console.log("📊 App State Found:", JSON.stringify(state, null, 2));

        // Test 1: Model Discovery
        console.log("\n--- Test 1: Model Discovery ---");

        const modelResult = await discoverModels(conns);
        if (modelResult.error) {
            console.error("❌ Model Discovery Failed:", modelResult.error);
            if (modelResult.debug) console.log("Debug Info:", JSON.stringify(modelResult.debug, null, 2));
        } else {
            console.log("✅ Models Found:", modelResult.models);
        }

        // Test 2: Path Sanitization (Fixing 404s)
        console.log("\n--- Test 2: Path Sanitization ---");
        const snapshot = await captureSnapshot(conns);
        if (snapshot.error) {
            console.error("❌ Snapshot failed:", snapshot.error);
        } else {
            const problematicPath = "D:/Program Files/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/js.svg";
            const encodedPath = "D:/Program%20Files/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/js.svg";

            // Check if these paths exist in the cleaned HTML
            const hasAbsolute = snapshot.html.includes("D:/Program Files") || snapshot.html.includes("Program%20Files");
            const hasMapped = snapshot.html.includes("/vscode-resources/");

            if (hasAbsolute) {
                console.error("❌ Found leaked absolute paths in HTML!");
                const leaks = snapshot.html.match(/[a-z]:[^"'> ]+Program[^"'> ]+/gi) || [];
                console.log("Leaked samples:", leaks.slice(0, 3));
            } else if (hasMapped) {
                console.log("✅ Verified: Absolute paths mapped to /vscode-resources/");

                // Real-world connectivity test (Check if the server can actually serve it)
                const sampleIcon = "http://localhost:3004/vscode-resources/Antigravity/resources/app/extensions/theme-symbols/src/icons/files/document.svg";
                console.log(`🔗 Testing resource availability: ${sampleIcon}`);
                try {
                    const res = await fetch(sampleIcon, { method: 'HEAD' });
                    if (res.ok) {
                        console.log("✅ Resource is ACCESSIBLE (200 OK)");
                    } else {
                        console.error(`❌ Resource is NOT accessible (${res.status} ${res.statusText})`);
                        console.error(`   URL tried: ${sampleIcon}`);
                        console.error("   Reason: Server-side root for /vscode-resources in server_v4.js may be misaligned with the path suffix.");
                    }
                } catch (e) {
                    console.log(`ℹ️ Connectivity test failed: ${e.message} (Is server running on :3004?)`);
                }
            }

            // Check Brain paths
            const hasBrainAbsolute = snapshot.html.includes(".gemini") || snapshot.html.includes("antigravity/brain");
            const hasBrainMapped = snapshot.html.includes("/brain/");
            if (hasBrainAbsolute) {
                console.error("❌ Found leaked absolute brain paths!");
            } else if (hasBrainMapped) {
                console.log("✅ Verified: Brain paths mapped to /brain/");
            } else {
                console.log("ℹ️ No brain paths found in snapshot.");
            }
        }

        // Test 3: Model Switching
        // console.log("\n--- Test 3: Model Switching ---");
        // if (!modelResult.error && modelResult.models.length > 0) {
        //     const testModel = modelResult.models[0];
        //     console.log(`🔄 Attempting to switch to: "${testModel}"`);
        //     // const switchResult = await setModel(conns, testModel);
        //     // console.log("📊 Switch Result:", JSON.stringify(switchResult, null, 2));
        // }

    } catch (e) {
        console.error("💥 FATAL DIAGNOSIS ERROR:", e.message);
        console.error(e.stack);
    }
}

diagnose();
