
import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server_v4.js');
const TEST_PORT = 3004;

console.log(`[TEST] Starting V4 Integrity Test...`);
console.log(`[TEST] Target: ${SERVER_PATH}`);

let serverProcess = null;
let testsPassed = 0;
const TOTAL_TESTS = 3;

function fail(msg) {
    console.error(`❌ [FAIL] ${msg}`);
    cleanup();
    process.exit(1);
}

function pass(msg) {
    console.log(`✅ [PASS] ${msg}`);
    testsPassed++;
}

function cleanup() {
    if (serverProcess) {
        console.log('[TEST] Killing server process...');
        serverProcess.kill();
    }
}

async function testHttp() {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${TEST_PORT}`, (res) => {
            if (res.statusCode === 200) {
                pass('HTTP Server responded with 200 OK');
                resolve();
            } else {
                reject(`HTTP status ${res.statusCode}`);
            }
        }).on('error', (e) => reject(e.message));
    });
}

async function testWs() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        let received = false;

        ws.on('open', () => {
            pass('WebSocket connection established');
            ws.send(JSON.stringify({ type: 'switch_port', port: 9000 }));
            // Give it a moment to process without crashing
            setTimeout(() => {
                ws.close();
                resolve();
            }, 500);
        });

        ws.on('error', (e) => reject(`WS Error: ${e.message}`));
    });
}

async function startServer() {
    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', [SERVER_PATH], {
            cwd: path.join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        serverProcess.stdout.on('data', (data) => {
            const msg = data.toString();
            // console.log(`[SERVER] ${msg.trim()}`);
            if (msg.includes('Listening')) {
                pass('Server started successfully');
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`[SERVER_ERR] ${data.toString()}`);
        });

        serverProcess.on('error', (err) => reject(err));

        // Timeout if not started in 10s
        setTimeout(() => reject('Server start timeout'), 10000);
    });
}

(async () => {
    try {
        await startServer();
        await testHttp();
        await testWs();

        console.log(`\n🎉 All ${testsPassed}/${TOTAL_TESTS} tests passed! V4 is stable.`);
        cleanup();
        process.exit(0);
    } catch (e) {
        fail(e.toString());
    }
})();
