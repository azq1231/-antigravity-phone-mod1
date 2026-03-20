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
import net from 'net';

import { activeConnections, getOrConnectParams } from './core/cdp_manager.js';
import { captureSnapshot, injectScroll, getAppState, runAutoAccept } from './core/automation.js';
import { findAllInstances } from './core/cdp_manager.js';

import apiRoutes from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(fs.readFileSync(join(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = packageJson.version;

const SERVER_PORT = 3004;
const PORTS = [9000, 9001, 9002, 9003, 9222];

process.on('uncaughtException', (err) => console.error('💥 [V4] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('💥 [V4] Unhandled Rejection:', reason));

async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({
        server,
        perMessageDeflate: {
            zlibDeflateOptions: { chunkLength: 1024, memLevel: 7, level: 3 },
            zlibInflateOptions: { chunkLength: 10 * 1024 },
            threshold: 1024 // Only compress if payload > 1KB
        }
    });

    app.use((req, res, next) => {
        console.log(`[HTTP] ${req.method} ${req.url} from ${req.ip}`);
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

    // Serve project assets (icons, images) - CRITICAL FOR PREVENTING BROKEN ICONS
    const assetsPath = join(__dirname, 'assets');
    if (fs.existsSync(assetsPath)) {
        app.use('/assets', (req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            // 🚩 Ghost Icon Fallback: If an icon is missing, serve a generic placeholder
            const cleanUrl = req.url.split('?')[0];
            const target = join(assetsPath, cleanUrl);
            const isIcon = /\.(png|svg|ico|jpg|jpeg|gif)$/i.test(cleanUrl);
            
            if (!fs.existsSync(target) && isIcon) {
                const defaultIcon = join(__dirname, 'public', 'antigravity.png');
                if (fs.existsSync(defaultIcon)) {
                    // console.log(`[V4-GHOST] Fallback for: ${req.url}`);
                    return res.sendFile(defaultIcon);
                }
            }
            next();
        }, express.static(assetsPath));
        // Double Assets Fallback for Vite-generated relative paths (e.g. /assets/assets/...)
        app.use('/assets/assets', (req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            next();
        }, express.static(assetsPath));
        console.log(`[V4] Serving project assets with ghost-icon fallback from: ${assetsPath}`);
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

    // 🚩 404 Logger for Assets
    app.use((req, res, next) => {
        if (!res.headersSent) {
            console.warn(`⚠️ [404-NOT-FOUND] ${req.method} ${req.url} from ${req.ip}`);
        }
        next();
    });

    app.get('/', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(join(__dirname, 'public', 'index_v4.html'));
    });
    app.use(express.static(join(__dirname, 'public'), {
        setHeaders: (res, path) => {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }));

    const vscodeRoot = join(process.env.USERPROFILE || 'C:/Users/kuo_1', 'AppData/Local/Programs/Microsoft VS Code');
    const userExtensions = join(process.env.USERPROFILE || 'C:/Users/kuo_1', '.vscode/extensions');
    let vscodePaths = [
        join(vscodeRoot, 'resources/app'), // Standard path
        'C:/Program Files/Microsoft VS Code/resources/app',
        'D:/Program Files/Microsoft VS Code/resources/app'
    ];
    // Add user extensions
    if (fs.existsSync(userExtensions)) {
        app.use('/vscode-resources/extensions', (req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            next();
        }, express.static(userExtensions));
        console.log(`[V4] Serving User extensions from: ${userExtensions}`);
    }
    // Add built-in extensions (standard app/extensions)
    // Add hash folders to search (e.g. 61b3d0ab13/resources/app)
    if (fs.existsSync(vscodeRoot)) {
        try {
            const subdirs = fs.readdirSync(vscodeRoot).filter(d => fs.lstatSync(join(vscodeRoot, d)).isDirectory());
            subdirs.forEach(d => {
                const target = join(vscodeRoot, d, 'resources/app');
                if (fs.existsSync(target)) vscodePaths.unshift(target);
            });
        } catch (e) { console.error('[V4] VSCode subdir scan failed:', e.message); }
    }

    for (const p of vscodePaths) {
        if (fs.existsSync(p)) {
            app.use('/vscode-resources', (req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                next();
            }, express.static(p));
            console.log(`[V4] Serving VSCode resources from: ${p}`);
            break;
        }
    }

    let tickCount = 0;
    const lastAppStateMap = new Map(); // Port -> State Cache

    setInterval(async () => {
        tickCount++;
        const forceUpdate = (tickCount % 5 === 0 || tickCount === 1);
        const syncAppState = (tickCount % 2 === 0 || forceUpdate);
        const clients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);
        if (clients.length === 0) return;

        // Group ports to avoid redundant scraping
        const activePorts = [...new Set(clients.map(c => c.viewingPort || 9000))];
        const portCache = new Map();

        await Promise.all(activePorts.map(async (port) => {
            try {
                const conn = await getOrConnectParams(port).catch(() => null);
                if (!conn) return;

                // 同時執行畫面抓取與狀態偵測，不再排隊
                const shouldAutoAccept = (tickCount % 2 === 0);
                const [snapshot, newState, autoAcceptRes] = await Promise.all([
                    captureSnapshot(conn).catch(err => {
                        console.error(`[V4-LOOP] Snapshot error for Port ${port}:`, err.message);
                        return null;
                    }),
                    syncAppState ? getAppState(conn).catch(() => null) : Promise.resolve(null),
                    shouldAutoAccept ? runAutoAccept(conn).catch(() => null) : Promise.resolve(null)
                ]);



                let appState = null;
                if (syncAppState && newState) {
                    newState.version = APP_VERSION;
                    const oldState = lastAppStateMap.get(port) || { mode: 'Unknown', model: 'Unknown', usage: '', title: '' };
                    let parsedUsage = (newState.usageText || newState.usage || (newState.model !== 'Unknown' ? newState.model : oldState.model));
                    if (parsedUsage && parsedUsage.length > 100) {
                        parsedUsage = parsedUsage.substring(0, 100) + '...';
                    }


                    const mergedState = {
                        mode: (newState.mode !== 'Unknown') ? newState.mode : oldState.mode,
                        model: (newState.model !== 'Unknown') ? newState.model : oldState.model,
                        usage: parsedUsage,
                        title: (newState.title !== '' && newState.title !== 'Unknown') ? newState.title : oldState.title,
                        version: newState.version
                    };
                    lastAppStateMap.set(port, mergedState);
                    appState = mergedState;
                } else if (syncAppState && lastAppStateMap.has(port)) {
                    appState = lastAppStateMap.get(port);
                }

                portCache.set(port, { snapshot, appState });
            } catch (e) {
                console.error(`[V4-LOOP] Port ${port} processing error:`, e.message);
            }
        }));

        clients.forEach(ws => {
            try {
                const targetPort = ws.viewingPort || 9000;
                const cached = portCache.get(targetPort);

                if (!cached || !cached.snapshot) {
                    if (forceUpdate) {
                        ws.send(JSON.stringify({
                            type: 'snapshot_update',
                            error: 'Waiting for snapshot...',
                            html: `<div class="error-state">Waiting for Port ${targetPort}...</div>`
                        }));
                    }
                    return;
                }

                const { snapshot, appState } = cached;

                if (snapshot.error) {
                    if (forceUpdate) ws.send(JSON.stringify({ type: 'snapshot_update', error: snapshot.error, html: `<div class="error-state">${snapshot.error}</div>` }));
                    return;
                }

                if (ws.lastHash !== snapshot.hash || forceUpdate || appState) {
                    const cssHash = snapshot.css ? snapshot.css.length : 0;
                    const cssChanged = ws.lastCssHash !== cssHash;

                    if (appState && syncAppState && appState.model !== 'Unknown') {
                        console.log(`[V4-LOOP] UI Sync (Port ${targetPort}): Mode=${appState.mode}, Model=${appState.model}`);
                    }

                    const message = {
                        type: 'snapshot_update',
                        port: targetPort,
                        appState: appState,
                        ...snapshot
                    };

                    if (!cssChanged && !forceUpdate) {
                        delete message.css;
                        message.cssType = 'cached';
                    } else {
                        ws.lastCssHash = cssHash;
                        message.cssType = 'full';
                    }

                    ws.send(JSON.stringify(message));
                    ws.lastHash = snapshot.hash;
                }
            } catch (e) {
                console.error(`[V4-LOOP] Client send error:`, e.message);
            }
        });
    }, 1000);
    // Relaxed interval for better stability

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

    // --- 智能 CDP 橋接器 (已註解移除，避免潛在的 9222 資源衝突造成當機) ---
    /*
    const BRIDGE_PORT = 9222;
    const cdpBridge = net.createServer(socket => {
        const activeClients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);
        const targetPort = (activeClients.length > 0 && activeClients[0].viewingPort) ? activeClients[0].viewingPort : 9001;
        const target = net.createConnection(targetPort, '127.0.0.1');
        socket.pipe(target).pipe(socket);
        socket.on('error', () => target.destroy());
        target.on('error', () => {
            socket.destroy();
        });
    });
    cdpBridge.listen(BRIDGE_PORT, '127.0.0.1');
    */
}

createServer();
