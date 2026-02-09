
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3004;
const BASE_URL = `http://localhost:${PORT}`;

console.log('🚀 Starting Integration Test...');

// 1. Start Server in Background
const serverProcess = spawn('node', ['server.js'], {
    stdio: 'pipe',
    shell: true
});

let serverReady = false;

serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    // console.log('[Server]:', output.trim());
    if (output.includes('Server running on')) {
        serverReady = true;
        runTests();
    }
});

serverProcess.stderr.on('data', (data) => {
    console.error('[Server Error]:', data.toString());
});

async function runTests() {
    console.log('✅ Server started. Running tests...');
    const results = [];

    try {
        // Test 1: Health / Home Page
        results.push(await checkEndpoint('/', 200));

        // Test 2: API Snapshot (might be 503 if no CDP, but should respond)
        results.push(await checkEndpoint('/snapshot', [200, 503]));

        // Test 3: API App State
        results.push(await checkEndpoint('/app-state', 200));

        // Test 4: Static File
        results.push(await checkEndpoint('/css/style.css', 200));

    } catch (e) {
        console.error('❌ Test execution failed:', e);
    } finally {
        console.log('\n📊 Test Results:');
        results.forEach(r => console.log(r));

        console.log('\n🛑 Stopping server...');
        serverProcess.kill();
        process.exit(0);
    }
}

function checkEndpoint(path, expectedStatus) {
    return new Promise((resolve) => {
        http.get(`${BASE_URL}${path}`, (res) => {
            const statusMatch = Array.isArray(expectedStatus)
                ? expectedStatus.includes(res.statusCode)
                : res.statusCode === expectedStatus;

            if (statusMatch) {
                resolve(`✅ GET ${path} -> ${res.statusCode} (OK)`);
            } else {
                resolve(`❌ GET ${path} -> ${res.statusCode} (Expected: ${expectedStatus})`);
            }
        }).on('error', (e) => {
            resolve(`❌ GET ${path} -> Error: ${e.message}`);
        });
    });
}

// Timeout
setTimeout(() => {
    if (!serverReady) {
        console.error('❌ Server startup timed out!');
        serverProcess.kill();
        process.exit(1);
    }
}, 10000);
