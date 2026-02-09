import http from 'http';

const PORT = 3004;
const TARGET_PORT = 9000;
const TEST_MESSAGE = "Verification Pulse: Testing V4 Messaging Connection " + Date.now();

async function testSendMessage() {
    console.log(`🧪 Starting Messaging Verification...`);
    console.log(`📡 Sending test message to Port ${PORT}...`);

    const postData = JSON.stringify({
        message: TEST_MESSAGE,
        msgId: "test_id_" + Date.now().toString(36)
    });

    const options = {
        hostname: 'localhost',
        port: PORT,
        path: `/send?port=${TARGET_PORT}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => {
            console.log(`📥 Server Response (Status ${res.statusCode}):`);
            try {
                const data = JSON.parse(responseBody);
                console.log(JSON.stringify(data, null, 2));

                if (data.ok) {
                    console.log(`✅ TEST PASSED: Message accepted by server!`);
                } else {
                    console.error(`❌ TEST FAILED: Server returned error - ${data.error || data.reason}`);
                    if (data.reason === 'no_context') {
                        console.warn('   💡 Hint: IDE might not have a valid workbench window open.');
                    }
                }
            } catch (e) {
                console.error(`❌ TEST FAILED: Invalid JSON response - ${responseBody}`);
            }
        });
    });

    req.on('error', (e) => {
        console.error(`❌ TEST FAILED: Request error - ${e.message}`);
    });

    req.write(postData);
    req.end();
}

testSendMessage();
