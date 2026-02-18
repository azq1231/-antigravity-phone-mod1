import WebSocket from 'ws';
import { getJson, isPortInUse } from './utils.js';

const PORTS = [9000, 9001, 9002, 9003];
export const activeConnections = new Map();
export const connectionLocks = new Map();

export async function findAllInstances() {
    const instances = [];
    for (const port of PORTS) {
        try {
            const inUse = await isPortInUse(port);
            if (!inUse) continue;
            const list = await getJson(`http://127.0.0.1:${port}/json`);

            const pages = list.filter(t => (t.type === 'page' || t.type === 'webview' || t.type === 'iframe') && t.webSocketDebuggerUrl);

            if (pages.length > 0) {
                // 智慧型視窗篩選：優先尋找真正的專案視窗
                const mainTarget =
                    // 1. 優先找包含 workbench 的核心視窗
                    pages.find(t => t.url && t.url.includes('workbench.html')) ||
                    // 2. 排除啟動器、指南和監測器，也要排除看起來像檔案總管或代碼開發的視窗
                    pages.find(t => t.title && !/Launchpad|Walkthrough|Quota Monitor|server_v4\.js|package\.json|node_modules/i.test(t.title)) ||
                    // 3. 備援：找 type 是 page 且不是空白的視窗
                    pages.find(t => t.type === 'page' && t.url !== 'about:blank') ||
                    pages[0];

                instances.push({
                    port,
                    targets: pages.map(t => ({
                        url: t.webSocketDebuggerUrl,
                        id: t.id,
                        title: t.title || `Untitled (${t.id.substring(0, 4)})`
                    })),
                    url: mainTarget.webSocketDebuggerUrl,
                    title: (mainTarget.title && !mainTarget.title.includes('Launchpad')) ? mainTarget.title : `Antigravity (Port ${port})`
                });
            }
        } catch (e) { }
    }
    return instances;
}

export async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 2000);
        ws.on('open', () => { clearTimeout(timeout); resolve(); });
        ws.on('error', reject);
    });
    let idCounter = 1;
    const pendingCalls = new Map();

    // Full Context Tracking Logic (Ported from Original)
    const contexts = [];
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Handle Method Return
            if (data.id && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);
                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            // Handle Context Events
            if (data.method === 'Runtime.executionContextCreated') {
                // Ensure we don't add duplicates
                if (!contexts.find(c => c.id === data.params.context.id)) {
                    contexts.push(data.params.context);
                }
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const idx = contexts.findIndex(c => c.id === data.params.executionContextId);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') {
                contexts.length = 0;
            }
        } catch (e) { }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => {
            pendingCalls.delete(id);
            // Don't reject on timeout, just log (prevents crashing on slow Windows)
            console.warn(`[CDP] Timeout waiting for ${method}`);
            resolve(null);
        }, 5000); // 5s timeout is safer for UI polling

        pendingCalls.set(id, { resolve, reject, timeoutId });
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ id, method, params }));
        } else {
            clearTimeout(timeoutId);
            pendingCalls.delete(id);
            reject(new Error('WebSocket not open'));
        }
    });

    // Enable Runtime immediately to start receiving context events
    await call("Runtime.enable");

    // Give a short grace period for initial contexts to populate
    await new Promise(r => setTimeout(r, 200));

    return { ws, call, contexts, url, close: () => ws.close() };
}

export async function getOrConnectParams(port, forceReconnect = false) {
    if (activeConnections.has(port) && !forceReconnect) {
        const conns = activeConnections.get(port);
        const valid = conns.filter(c => c.ws.readyState === WebSocket.OPEN);
        if (valid.length > 0) {
            activeConnections.set(port, valid);
            return valid;
        }
        activeConnections.delete(port);
    }

    if (connectionLocks.has(port)) return connectionLocks.get(port);

    const promise = (async () => {
        try {
            const instances = await findAllInstances();
            const inst = instances.find(i => i.port === port);
            if (!inst) throw new Error(`Port ${port} not found`);

            // Connect to ALL targets (Workbench + any other pages)
            // Chat lives INSIDE Workbench as an iframe/execution context
            const results = [];
            for (const target of inst.targets) {
                try {
                    const conn = await connectCDP(target.url);
                    conn.port = port;
                    conn.title = target.title;
                    results.push(conn);
                } catch (e) {
                    // Skip failed targets silently
                }
            }
            if (!results.length) throw new Error('Failed to connect to any target');
            activeConnections.set(port, results);
            return results;
        } finally { connectionLocks.delete(port); }
    })();
    connectionLocks.set(port, promise);
    return promise;
}
