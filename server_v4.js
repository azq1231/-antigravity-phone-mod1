#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import WebSocket from 'ws';

import { activeConnections, getOrConnectParams } from './core/cdp_manager.js';
import { captureSnapshot, injectScroll } from './core/automation.js';
import { findAllInstances } from './core/cdp_manager.js';
import apiRoutes from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PORT = 3004;
const PORTS = [9000, 9001, 9002, 9003];

process.on('uncaughtException', (err) => console.error('💥 [V4] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('💥 [V4] Unhandled Rejection:', reason));

async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use((req, res, next) => {
        // 忽略靜態資源的日誌，減少終端機噪音
        const isStatic = /\.(svg|png|jpg|jpeg|gif|css|js|woff|ttf)$/.test(req.url);
        if (!isStatic) {
            console.log(`[HTTP] ${req.method} ${req.url} from ${req.ip}`);
        }
        next();
    });

    // Serve user artifacts (brain/images) - HIGHEST PRIORITY
    const brainPath = join(process.env.USERPROFILE || 'C:/Users/kuo_1', '.gemini/antigravity/brain');
    if (fs.existsSync(brainPath)) {
        app.use('/brain', (req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            next();
        }, express.static(brainPath));
        console.log(`[V4] Serving artifacts from: ${brainPath}`);
    }

    app.use(compression());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
    app.use(cookieParser('antigravity_v4_secret'));

    app.use('/', apiRoutes);

    // Global Error Handler for Debugging
    app.use((err, req, res, next) => {
        console.error('💥 [Server Error]:', err.stack);
        res.status(err.status || 500).json({
            ok: false,
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    });

    app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index_v4.html')));
    app.use(express.static(join(__dirname, 'public')));

    const vscodeResourcesPath = "D:/Program Files/Antigravity/resources/app";
    if (fs.existsSync(vscodeResourcesPath)) app.use('/vscode-resources', express.static(vscodeResourcesPath));

    let tickCount = 0;
    setInterval(async () => {
        tickCount++;
        const forceUpdate = (tickCount % 5 === 0);
        const clients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);

        await Promise.all(clients.map(async (ws) => {
            try {
                const targetPort = ws.viewingPort || 9000;

                // Connection attempt
                const connPromise = getOrConnectParams(targetPort);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 2000));

                let conn = await Promise.race([connPromise, timeoutPromise]).catch(err => {
                    if (forceUpdate) console.warn(`[V4-LOOP] Port ${targetPort} error for ${ws.remoteAddress}: ${err.message}`);
                    return null;
                });

                let snapshot = null;
                if (conn) {
                    snapshot = await captureSnapshot(conn).catch(err => {
                        console.error(`[V4-LOOP] Snapshot error for ${ws.remoteAddress}:`, err.message);
                        return null;
                    });
                }

                let effectiveSnapshot = snapshot;

                // --- STABILIZED SNAPSHOT LOGIC ---
                // Disable Auto-Hunt to prevent flipping between ports
                const isMainPortFailing = !effectiveSnapshot || effectiveSnapshot.error || !effectiveSnapshot.html;
                if (isMainPortFailing) {
                    ws.failCount = (ws.failCount || 0) + 1;
                } else {
                    ws.failCount = 0;
                }

                // Strictly follow manual mode or stick to targetPort
                const shouldHunt = false; // DISABLED: Force stability

                if (shouldHunt) {
                    for (const p of PORTS) {
                        if (p === targetPort) continue;
                        try {
                            const tryConn = await getOrConnectParams(p).catch(() => null);
                            if (!tryConn) continue;
                            const trySnap = await captureSnapshot(tryConn).catch(() => null);
                            if (trySnap && trySnap.html && !trySnap.error) {
                                console.log(`[V4-LOOP] AUTOHUNT: Port ${targetPort} failed for 5s, switching to Port ${p}`);
                                ws.send(JSON.stringify({ type: 'force_port_switch', port: p }));
                                ws.viewingPort = p;
                                ws.failCount = 0; // Reset fail count after successful switch
                                effectiveSnapshot = trySnap;
                                break;
                            }
                        } catch (e) { }
                    }
                }

                if (effectiveSnapshot && !effectiveSnapshot.error && (ws.lastHash !== effectiveSnapshot.hash || forceUpdate)) {
                    if (ws.lastHash !== effectiveSnapshot.hash) {
                        // console.log(`[V4-LOOP] SUCCESS: Sending snapshot (${effectiveSnapshot.hash}) from Port ${ws.viewingPort}`);
                    }
                    ws.send(JSON.stringify({
                        type: 'snapshot_update',
                        port: ws.viewingPort,
                        isAutoSwitched: false,
                        debug_source: effectiveSnapshot.targetTitle || 'unknown',
                        ...effectiveSnapshot
                    }));
                    ws.lastHash = effectiveSnapshot.hash;
                } else if (effectiveSnapshot?.error && forceUpdate) {
                    // console.warn(`[V4-LOOP] SYNC ERROR for ${ws.remoteAddress}: ${effectiveSnapshot.error}`);
                    ws.send(JSON.stringify({ type: 'snapshot_update', error: effectiveSnapshot.error, html: `<div class="error-state">${effectiveSnapshot.error}</div>` }));
                } else if (!effectiveSnapshot && forceUpdate) {
                    ws.send(JSON.stringify({ type: 'snapshot_update', error: 'No snapshot available', html: '<div class="error-state">Waiting for Antigravity... (Port ' + ws.viewingPort + ')</div>' }));
                }
            } catch (e) { console.error(`[V4-LOOP] Error:`, e.message); }
        }));
    }, 1500); // Relaxed interval for better stability

    wss.on('connection', (ws, req) => {
        console.log('[V4-WS] NEW CONNECTION EVENT');
        const remoteAddress = req.socket.remoteAddress;
        console.log(`[V4-WS] New Connection from ${remoteAddress}`);
        ws.remoteAddress = remoteAddress;
        ws.viewingPort = 9000;
        ws.on('message', msg => {
            try {
                const d = JSON.parse(msg);
                if (d.type === 'client_log') {
                    console.log(`📱 [PHONE-LOG] [${d.level.toUpperCase()}] at ${ws.remoteAddress}: ${d.data}`);
                    return;
                }
                if (d.type === 'switch_port') {
                    console.log(`[V4-WS] Client switching to port ${d.port}`);
                    ws.viewingPort = parseInt(d.port);
                    ws.isManualMode = true;
                    ws.lastHash = null; // Important: Clear hash to force immediate redraw on port change
                }
                if (d.type === 'scroll_event') {
                    // DISABLED: Don't sync phone scroll to desktop
                    // This causes bidirectional scroll fighting
                    // const conn = activeConnections.get(ws.viewingPort);
                    // if (conn) injectScroll(conn, { scrollTop: d.scrollTop });
                }
            } catch (e) { }
        });
    });

    server.listen(SERVER_PORT, '0.0.0.0', () => console.log(`🚀 [V4-STABLE] Listening on http://localhost:${SERVER_PORT}`));
}

createServer();
