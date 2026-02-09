
// Uses Node 18+ native fetch
const PORT = 3004;
const BASE_URL = `http://localhost:${PORT}`;

async function testDedup() {
    console.log(`[TEST] Starting Deduplication Test on Port ${PORT}...`);

    // Generate a unique ID for this test batch
    const msgId = `test_dedup_${Date.now()}`;
    const message = "Test Message for Dedup";

    console.log(`[TEST] Sending FIRST request (ID: ${msgId})...`);

    // 1st Request
    const p1 = fetch(`${BASE_URL}/send?port=9000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, msgId })
    }).then(res => res.json());

    // 2nd Request (Immediate retry mimic)
    console.log(`[TEST] Sending SECOND request (ID: ${msgId}) immediately...`);
    const p2 = fetch(`${BASE_URL}/send?port=9000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, msgId })
    }).then(res => res.json());

    const [res1, res2] = await Promise.all([p1, p2]);

    console.log('\n--- Results ---');
    console.log('Response 1:', JSON.stringify(res1));
    console.log('Response 2:', JSON.stringify(res2));

    // Validation
    let ignoredCount = 0;
    let processedCount = 0;

    if (res1.ignored) ignoredCount++; else if (res1.ok) processedCount++;
    if (res2.ignored) ignoredCount++; else if (res2.ok) processedCount++;

    if (processedCount === 1 && ignoredCount === 1) {
        console.log('\n✅ PASS: Only one message was processed, the other was ignored.');
    } else {
        console.log('\n❌ FAIL: Dedup logic failed or both failed.');
        console.log(`Processed: ${processedCount}, Ignored: ${ignoredCount}`);
    }
}

testDedup().catch(console.error);
