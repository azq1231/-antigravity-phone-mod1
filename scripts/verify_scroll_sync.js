import WebSocket from 'ws';
import http from 'http';
import { exit } from 'process';

const PORT = 3004;
const TARGET_PORT = 9000;

function getSnapshot() {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${PORT}/snapshot?port=${TARGET_PORT}`, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
        }).on('error', reject);
    });
}

async function testScrollSync() {
    console.log('🧪 Starting Scroll Sync Verification...');
    console.log('1. Connecting to WebSocket...');

    const ws = new WebSocket(`ws://localhost:${PORT}`);

    await new Promise(r => ws.on('open', r));
    console.log('   ✅ WebSocket Connected');

    // Switch to target port
    ws.send(JSON.stringify({ type: 'switch_port', port: TARGET_PORT }));
    await new Promise(r => setTimeout(r, 1000));

    // Step 1: Get Initial Position
    console.log('2. Fetching Initial Scroll Position...');
    const initial = await getSnapshot();
    if (!initial || !initial.scrollInfo) {
        console.error('   ❌ Failed to get initial snapshot or scroll info');
        process.exit(1);
    }
    const startTop = initial.scrollInfo.scrollTop;
    console.log(`   📍 Initial scrollTop: ${startTop}`);

    if (startTop === 0) {
        console.warn('   ⚠️ Logic Warning: Already at top. Moving down first...');
        // If already at top, try to scroll down first? (Not implemented for test simplicity, assuming chat has content)
        // Let's try to scroll to 500 anyway, if content allows.
    }

    // Step 2: Send Scroll Command
    const targetScroll = Math.max(0, startTop - 200); // Scroll up by 200px
    console.log(`3. Sending Command: Scroll to ${targetScroll}...`);

    ws.send(JSON.stringify({
        type: 'scroll_event',
        scrollTop: targetScroll
    }));

    // Wait for sync (Server -> IDE -> Scroll -> Server Loop Check)
    console.log('   ⏳ Waiting for sync (2s)...');
    await new Promise(r => setTimeout(r, 2000));

    // Step 3: Verify Position
    console.log('4. Verifying New Position...');
    const final = await getSnapshot();
    const endTop = final.scrollInfo.scrollTop;
    console.log(`   📍 Final scrollTop: ${endTop}`);

    // Tolerance check (IDE scroll might not be pixel perfect or limited by height)
    const diff = Math.abs(endTop - targetScroll);
    const moved = startTop !== endTop;

    if (moved) {
        console.log('   ✅ TEST PASSED: Scroll position changed!');
        console.log(`      Delta: ${startTop} -> ${endTop} (Target: ${targetScroll})`);
    } else {
        console.error('   ❌ TEST FAILED: Scroll position did not change.');
        console.log('      Possible reasons: Connection broken, IDE minimized, or content too short.');
    }

    ws.close();
    process.exit(moved ? 0 : 1);
}

testScrollSync();
