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

        for (const ws of clients) {
            try {
                const targetPort = ws.viewingPort || 9000;
                const conn = await getOrConnectParams(targetPort).catch(() => null);

                if (!conn) {
                    if (forceUpdate) ws.send(JSON.stringify({ type: 'snapshot_update', error: `Port ${targetPort} not found`, html: `<div class="error-state">Searching for Antigravity on Port ${targetPort}...</div>` }));
                    continue;
                }

                const snapshot = await captureSnapshot(conn);
                let effectiveSnapshot = snapshot;

                // RELAXED FILTERING: If the user manually chose this port, show whatever we got (even if it's body fallback)
                const isMissingCascade = !snapshot || snapshot.error;
                const shouldHunt = !ws.isManualMode && isMissingCascade;

                if (shouldHunt) {
                    for (const p of PORTS) {
                        if (p === targetPort) continue;
                        try {
                            const tryConn = await getOrConnectParams(p).catch(() => null);
                            if (!tryConn) continue;
                            const trySnap = await captureSnapshot(tryConn);
                            if (trySnap && trySnap.html && !trySnap.error) {
                                ws.send(JSON.stringify({ type: 'force_port_switch', port: p }));
                                ws.viewingPort = p;
                                effectiveSnapshot = trySnap;
                                break;
                            }
                        } catch (e) { }
                    }
                }

                if (effectiveSnapshot && (ws.lastHash !== effectiveSnapshot.hash || forceUpdate)) {
                    if (ws.lastHash !== effectiveSnapshot.hash) console.log(`[V4-LOOP] Sending new snapshot from Port ${ws.viewingPort} to client`);
                    ws.send(JSON.stringify({ type: 'snapshot_update', port: ws.viewingPort, ...effectiveSnapshot }));
                    ws.lastHash = effectiveSnapshot.hash;
                } else if (!effectiveSnapshot && forceUpdate && !ws.lastHash) {
                    // Only send error HTML if we DON'T have a successful lastHash (prevents flickering)
                    ws.send(JSON.stringify({ type: 'snapshot_update', error: 'No snapshot available', html: '<div class="error-state">Antigravity is running, but no chat interface was found. Please open the Chat panel.</div>' }));
                }
            } catch (e) { console.error(`[V4-LOOP] Error:`, e.message); }
        }
    }, 1000);

    wss.on('connection', (ws, req) => {
        console.log(`[V4-WS] New Connection from ${req.socket.remoteAddress}`);
        ws.viewingPort = 9000;
        ws.on('message', msg => {
            try {
                const d = JSON.parse(msg);
                if (d.type === 'switch_port') {
                    console.log(`[V4-WS] Client switching to port ${d.port}`);
                    ws.viewingPort = parseInt(d.port);
                    ws.isManualMode = true;
                    ws.lastHash = null; // Important: Clear hash to force immediate redraw on port change
                }
                if (d.type === 'scroll_event') {
                    const conn = activeConnections.get(ws.viewingPort);
                    if (conn) injectScroll(conn, d.scrollTop);
                }
            } catch (e) { }
        });
    });

    server.listen(SERVER_PORT, '0.0.0.0', () => console.log(`🚀 [V4-STABLE] Listening on http://localhost:${SERVER_PORT}`));
}

createServer();
