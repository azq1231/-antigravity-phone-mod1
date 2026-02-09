import http from 'http';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SERVER_URL = 'http://127.0.0.1:3000';
const CONCURRENT_REQUESTS = 20;
const TOTAL_ROUNDS = 5;

async function runPressureTest() {
    console.log('🚀 Starting Antigravity Pressure Test (V4.1)...');
    console.log(`📊 Targets: ${CONCURRENT_REQUESTS} concurrent requests x ${TOTAL_ROUNDS} rounds`);

    const startTotal = Date.now();
    let totalSuccess = 0;
    let totalFail = 0;
    let latencies = [];

    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
        const roundStart = Date.now();
        const promises = [];

        for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
            promises.push(new Promise((resolve) => {
                const reqStart = Date.now();
                http.get(`${SERVER_URL}/snapshot`, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        const latency = Date.now() - reqStart;
                        if (res.statusCode === 200) {
                            totalSuccess++;
                            latencies.push(latency);
                        } else {
                            totalFail++;
                        }
                        resolve();
                    });
                }).on('error', (e) => {
                    totalFail++;
                    resolve();
                });
            }));
        }

        await Promise.all(promises);
        // console.log(`  Round ${round} completed in ${Date.now() - roundStart}ms`);
    }

    const totalTime = Date.now() - startTotal;
    const avgLatency = latencies.length > 0 ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1) : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;

    console.log('\n--- Pressure Test Summary ---');
    console.log(`✅ Successful Requests: ${totalSuccess}`);
    console.log(`❌ Failed Requests:     ${totalFail}`);
    console.log(`⏱️  Total Time:          ${totalTime}ms`);
    console.log(`📉 Avg Latency:         ${avgLatency}ms`);
    console.log(`📈 Max Latency:         ${maxLatency}ms`);
    console.log(`📉 Min Latency:         ${minLatency}ms`);
    console.log(`📦 Throughput:         ${((totalSuccess / totalTime) * 1000).toFixed(2)} req/s`);

    if (totalFail > 0) {
        console.error('\n⚠️  WARNING: Some requests failed under pressure.');
        process.exit(1);
    } else {
        console.log('\n🌟 STABILITY VERIFIED: Server handled pressure gracefully.');
        console.log('DONE. Total Errors: 0');
    }
}

// Check if server is accessible before running
http.get(`${SERVER_URL}/health`, (res) => {
    runPressureTest();
}).on('error', (e) => {
    console.error(`❌ Error: Server at ${SERVER_URL} is not reachable. Please start the server first.`);
    process.exit(1);
});
