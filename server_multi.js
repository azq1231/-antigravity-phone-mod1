#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { inspectUI } from './ui_inspector.js';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000; // 1 second
const SERVER_PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';
let AUTH_TOKEN = 'ag_default_token';

// --- Multi-Instance State ---
// Map<Port, CDPConnection>
const activeConnections = new Map();
// Map<Port, LastSnapshot>
const snapshotCache = new Map();

// --- Utilities ---

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

function killPortProcess(port) {
    try {
        if (process.platform === 'win32') {
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const lines = result.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
                } catch (e) { }
            }
        } else {
            const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const pids = result.trim().split('\n').filter(p => p);
            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                } catch (e) { }
            }
        }
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
        return Promise.resolve();
    }
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    priority: iface.address.startsWith('192.168.') ? 1 : iface.address.startsWith('10.') ? 2 : 4
                });
            }
        }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// --- CDP Core ---

async function findAllInstances() {
    const instances = [];
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            let candidate = list.find(t => t.url?.includes('workbench.html'));
            if (!candidate) candidate = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);

            if (candidate && candidate.webSocketDebuggerUrl) {
                instances.push({
                    port,
                    url: candidate.webSocketDebuggerUrl,
                    title: candidate.title || `Antigravity (${port})`
                });
            }
        } catch (e) { }
    }
    return instances;
}

async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    const pendingCalls = new Map();
    const contexts = [];
    const CDP_CALL_TIMEOUT = 30000;

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);
                if (data.error) reject(data.error);
                else resolve(data.result);
            }
            if (data.method === 'Runtime.executionContextCreated') contexts.push(data.params.context);
            else if (data.method === 'Runtime.executionContextDestroyed') {
                const idx = contexts.findIndex(c => c.id === data.params.executionContextId);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') contexts.length = 0;
        } catch (e) { }
    });

    ws.on('error', (err) => {
        console.error('CDP WebSocket error:', err.message);
        pendingCalls.forEach(({ reject, timeoutId }) => {
            clearTimeout(timeoutId);
            reject(new Error('WebSocket Error: ' + err.message));
        });
        pendingCalls.clear();
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });
        try {
            if (ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket closed');
            ws.send(JSON.stringify({ id, method, params }));
        } catch (e) {
            clearTimeout(timeoutId);
            pendingCalls.delete(id);
            reject(e);
        }
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 600));

    // Cleanup function
    const close = () => {
        try { ws.close(); } catch (e) { }
    };

    return { ws, call, contexts, url, close };
}

// --- Connection Manager ---

// Ensure we have a valid connection to the requested port
async function getOrConnectParams(port) {
    if (activeConnections.has(port)) {
        const conn = activeConnections.get(port);
        if (conn.ws.readyState === WebSocket.OPEN) {
            return conn;
        } else {
            // Stale connection, remove it
            console.log(`♻️  Connection to ${port} is dead/closed. Cleaning up.`);
            activeConnections.delete(port);
        }
    }

    // New connection
    console.log(`🔌 Connecting to Port ${port}...`);
    const instances = await findAllInstances();
    const target = instances.find(i => i.port === port);

    if (!target) {
        throw new Error(`Instance on port ${port} not found. Launch it first.`);
    }

    try {
        const conn = await connectCDP(target.url);
        conn.port = port; // Tag it
        activeConnections.set(port, conn);
        console.log(`✅ Connected to Port ${port}`);
        return conn;
    } catch (e) {
        console.error(`❌ Failed to connect to port ${port}: ${e.message}`);
        throw e;
    }
}

// --- Scripts & Actions ---
// reusing same scripts as server.js just wrapped in functions
async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        const cascade = document.getElementById('cascade');
        if (!cascade) return { error: 'cascade not found' };
        
        const cascadeStyles = window.getComputedStyle(cascade);
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight
        };
        
        const clone = cascade.cloneNode(true);
        const inputContainer = clone.querySelector('[contenteditable="true"]')?.closest('div[id^="cascade"] > div');
        if (inputContainer) inputContainer.remove();
        
        const html = clone.outerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) rules.push(rule.cssText);
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');
        
        return {
            html: html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo: scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length
            }
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            if (result.result?.value && !result.result.value.error) return result.result.value;
        } catch (e) { }
    }
    return null;
}

// --- Main Server ---
async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.static(join(__dirname, 'public')));
    app.use(express.json({ limit: '50mb' }));
    app.use(cookieParser('antigravity_secret_key_1337'));

    // Auth
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === APP_PASSWORD) {
            AUTH_TOKEN = hashString(APP_PASSWORD + Date.now());
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    });

    // Helper to get socket's viewed port
    const getSocketPort = (ws) => ws.viewingPort || 9000;

    // --- API Endpoints adjusted for Multi-Session ---

    // Instead of relying on global cdpConnection, we look up based on request or default
    const getConn = (req) => {
        // TODO: In HTTP context, we don't know "who" is asking easily without session ID mapping to port.
        // For simple MVP "sidecar", we can pass ?port=9001 in Query Params
        const port = parseInt(req.query.port) || 9000;
        return activeConnections.get(port);
    }

    app.get('/instances', async (req, res) => {
        const list = await findAllInstances();
        res.json({ instances: list });
    });

    app.post('/switch-instance', async (req, res) => {
        // Now this just validates availability, actual switching happens in Socket
        const { port } = req.body;
        try {
            await getOrConnectParams(parseInt(port));
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/app-state', async (req, res) => {
        // Default to first active connection or 9000
        const port = parseInt(req.query.port) || 9000;
        res.json({ activePort: port, mode: 'Fast', model: 'Unknown' }); // Simplified for now
    });

    // Remote interaction endpoints needing CDP
    // We update frontend to send ?port=... in fetch calls OR rely on socket commands

    // --- WebSocket ---
    wss.on('connection', (ws, req) => {
        console.log('📱 Client Connected');

        // Default to Port 9000
        ws.viewingPort = 9000;

        ws.on('message', async (msg) => {
            try {
                const data = JSON.parse(msg);

                if (data.type === 'switch_port') {
                    const newPort = parseInt(data.port);
                    console.log(`📡 Client requested switch to ${newPort}`);
                    try {
                        // Ensure it exists
                        await getOrConnectParams(newPort);
                        ws.viewingPort = newPort;
                        // Send immediate update
                        ws.send(JSON.stringify({ type: 'switched', port: newPort }));
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'error', message: e.message }));
                    }
                }
            } catch (e) { }
        });
    });

    // --- Centralized Broadcast Loop ---
    // Instead of one loop for "the" connection, we iterate all active connections
    setInterval(async () => {
        // 1. Identify which ports are actually being watched
        const watchedPorts = new Set();
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                watchedPorts.add(client.viewingPort || 9000);
            }
        });

        // 2. Fetch snapshots for watched ports
        for (const port of watchedPorts) {
            try {
                // Ensure connection exists
                let conn = activeConnections.get(port);
                if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
                    try {
                        conn = await getOrConnectParams(port);
                    } catch (e) {
                        // Cannot connect, send error state to viewers
                        const errorPayload = {
                            error: `Waiting for Port ${port}...`,
                            html: `<div style="padding:20px;text-align:center;color:#666;"><h3>Connecting to Port ${port}...</h3><p>${e.message}</p></div>`
                        };
                        broadcastToPort(wss, port, errorPayload);
                        continue;
                    }
                }

                // Capture
                const snapshot = await captureSnapshot(conn);
                if (snapshot) {
                    const hash = hashString(snapshot.html);
                    // Only broadcast if changed (per port cache)
                    const lastHash = snapshotCache.get(port);
                    if (hash !== lastHash) {
                        snapshotCache.set(port, hash);
                        broadcastToPort(wss, port, snapshot);
                    }
                }
            } catch (e) {
                // console.log(`Error polling port ${port}:`, e.message);
            }
        }
    }, POLL_INTERVAL);

    // Filter broadcast
    function broadcastToPort(wss, port, data) {
        const payload = JSON.stringify({
            type: 'snapshot_update',
            port: port, // Include the port in the broadcast
            ...data
        });

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.viewingPort === port) {
                client.send(payload);
            }
        });
    }

    server.listen(SERVER_PORT, '0.0.0.0', () => {
        console.log(`🚀 Multi-Instance Server running on port ${SERVER_PORT}`);
        console.log(`   (Supports independent viewing of Ports 9000-9003)`);
    });
}

// Start
killPortProcess(SERVER_PORT).then(createServer);
