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
                    // 2. 排除啟動器、指南和監測器，找標題有內容的
                    pages.find(t => t.title && !/Launchpad|Walkthrough|Quota Monitor/i.test(t.title)) ||
                    // 3. 備援：找 type 是 page 的視窗
                    pages.find(t => t.type === 'page') ||
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
    const contexts = [];
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.id && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId); pendingCalls.delete(data.id);
                if (data.error) reject(data.error); else resolve(data.result);
            }
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            }
            if (data.method === 'Runtime.executionContextsCleared') contexts.length = 0;
        } catch (e) { }
    });
    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => { pendingCalls.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000);
        pendingCalls.set(id, { resolve, reject, timeoutId });
        try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { reject(e); }
    });
    await call("Runtime.enable", {});
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

            const results = [];
            for (const target of inst.targets) {
                try {
                    const conn = await connectCDP(target.url);
                    conn.port = port;
                    conn.title = target.title;
                    results.push(conn);
                } catch (e) {
                    // Privacy Fix: 避免在日誌中印出視窗標題（因為標題可能包含用戶輸入的對話內容）
                    console.error(`[CDP] Failed to connect to a target on Port ${port}`);
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
