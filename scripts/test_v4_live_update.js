
import WebSocket from 'ws';
import http from 'http';

const WS_URL = 'ws://localhost:3004';
const API_URL = 'http://localhost:3004/send?port=9000';

function testLiveUpdate() {
    console.log(`[TEST] Connecting to ${WS_URL}...`);
    const ws = new WebSocket(WS_URL);
    let updateCount = 0;
    let initialHash = null;

    ws.on('open', async () => {
        console.log('[TEST] WS Connected. Switching to Port 9000...');
        ws.send(JSON.stringify({ type: 'switch_port', port: 9000 }));

        // Trigger a change after 2 seconds
        setTimeout(async () => {
            console.log('\n[TEST] ---> Sending Message to trigger change...');
            try {
                const msgId = `update_test_${Date.now()}`;
                await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: "Live Update Check", msgId })
                });
                console.log('[TEST] Message sent. Waiting for Hash change...');
            } catch (e) { console.error('[TEST] Send failed:', e.message); }
        }, 3000);
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'snapshot_update') {
            updateCount++;
            const t = new Date().toISOString().split('T')[1];
            console.log(`[${t}] Snapshot Received! Length: ${msg.html.length}, Hash: ${msg.hash?.substring(0, 10)}...`);

            if (!initialHash) {
                initialHash = msg.hash;
                console.log(`[TEST] Initial Hash captured: ${initialHash}`);
            } else if (msg.hash !== initialHash) {
                console.log(`\n✅ [PASS] Hash Changed! (Old: ${initialHash.substring(0, 10)} -> New: ${msg.hash.substring(0, 10)})`);
                console.log('System is broadcasting updates correctly.');
                ws.close();
                process.exit(0);
            }
        }
    });

    ws.on('error', (e) => {
        console.error('[TEST] WS Error:', e.message);
        process.exit(1);
    });

    // Timeout
    setTimeout(() => {
        console.log('\n❌ [FAIL] No hash change detected within timeout.');
        console.log(`Total Updates Received: ${updateCount}`);
        ws.close();
        process.exit(1);
    }, 10000);
}

testLiveUpdate();
