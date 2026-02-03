#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync, spawn, exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000;
const SERVER_PORT = 3006;

const activeConnections = new Map();
const connectionLocks = new Map();

// --- Utilities ---
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

function isPortInUse(port) {
    return new Promise((resolve) => {
        exec(`netstat -ano | findstr LISTENING | findstr :${port}`, (err, stdout) => {
            if (err || !stdout) return resolve(false);
            resolve(stdout.includes(`:${port}`));
        });
    });
}

// --- CDP Core ---
async function findAllInstances() {
    const instances = [];
    for (const port of PORTS) {
        try {
            if (!(await isPortInUse(port))) continue;
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            let target = list.find(t => t.url?.includes('workbench.html')) || list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (target?.webSocketDebuggerUrl) instances.push({ port, url: target.webSocketDebuggerUrl, title: target.title || `Port ${port}` });
        } catch (e) { }
    }
    return instances;
}

async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 5000);
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
            if (data.method === 'Runtime.executionContextCreated') contexts.push(data.params.context);
        } catch (e) { }
    });
    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => { pendingCalls.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000);
        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });
    await call("Runtime.enable", {});
    return { ws, call, contexts, close: () => ws.close() };
}

async function getOrConnectParams(port) {
    if (activeConnections.has(port)) {
        const conn = activeConnections.get(port);
        if (conn.ws.readyState === WebSocket.OPEN) return conn;
    }
    const instances = await findAllInstances();
    const target = instances.find(i => i.port === port);
    if (!target) throw new Error(`Port ${port} not found`);
    const conn = await connectCDP(target.url);
    conn.port = port; conn.title = target.title;
    activeConnections.set(port, conn);
    return conn;
}

// --- V4 Robust Core: V3 Search Logic + V2 Safety ---
const DYNAMIC_UTILS_V4_JS = `
    const findContainer = () => {
        // V3 Robust Search: Finds chat even if structure changes
        const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
        if (editors.length === 0) return document.body;
        
        let curr = editors[editors.length - 1]; // Start from latest editor
        for (let i = 0; i < 15; i++) {
            if (!curr || curr === document.body) break;
            // Key Fix: Accept 'split-view-view' and large containers, same as V3
            if (curr.offsetHeight > 300 || curr.className.includes('chat') || curr.className.includes('split-view-view')) {
                return curr;
            }
            curr = curr.parentElement;
        }
        return editors[0].parentElement || document.body;
    };
`;

async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        ${DYNAMIC_UTILS_V4_JS}
        const cascade = findContainer();
        if (!cascade) return { error: 'container not found' };
        
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight
        };
        
        const clone = cascade.cloneNode(true);
        // Remove input bar area if small to avoid clutter (V2 logic)
        const inputArea = clone.querySelector('[contenteditable="true"]')?.closest('div');
        if (inputArea && inputArea.childElementCount < 5) inputArea.remove();

        const html = clone.outerHTML;
        const rules = [];
        for (const sheet of document.styleSheets) {
            try { for (const rule of sheet.cssRules) rules.push(rule.cssText); } catch (e) { }
        }
        
        const rewriteUrl = (s) => s ? s.replace(/vscode-file:\\/\\/vscode-app\\/.*?\\/resources\\/app\\//g, '/vscode-resources/') : s;
        
        return {
            html: rewriteUrl(html),
            css: rewriteUrl(rules.join('\\n')),
            scrollInfo: scrollInfo
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", { expression: CAPTURE_SCRIPT, returnByValue: true, contextId: ctx.id });
            if (result.result?.value && !result.result.value.error) return result.result.value;
        } catch (e) { }
    }
    return null;
}

async function injectMessage(cdp, text, force = false) {
    const safeText = JSON.stringify(text);
    const EXPRESSION = `(async () => {
        // V3 Heart: Precise busy detection and injection
        const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
        const stopBtn = document.querySelector('button svg.lucide-square, button svg.lucide-circle-stop')?.closest('button');
        const busyEl = cancel || stopBtn;
        if (!${force} && busyEl && busyEl.offsetParent !== null && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

        const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')].filter(el => el.offsetParent !== null);
        const editor = editors.at(-1);
        if (!editor) return { ok: false, error: "editor_not_found" };

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);
        try { document.execCommand?.("insertText", false, ${safeText}); } catch {
            editor.textContent = ${safeText};
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${safeText} }));
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const submit = document.querySelector("svg.lucide-arrow-right, .lucide-send, button[aria-label*='Send']")?.closest("button");
        if (submit && !submit.disabled) { submit.click(); return { ok: true, method: "click" }; }
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
        return { ok: true, method: "enter" };
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, reason: "no_context" };
}

async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });
    app.use(express.json());
    app.use(cookieParser());
    app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index_v4.html')));
    app.use(express.static(join(__dirname, 'public')));

    app.post('/send', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const result = await injectMessage(conn, req.body.message, req.query.force === 'true');
            res.json(result);
        } catch (e) { res.status(503).json({ error: e.message }); }
    });

    app.get('/snapshot', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const snapshot = await captureSnapshot(conn);
            res.json(snapshot);
        } catch (e) { res.status(503).json({ error: e.message }); }
    });

    setInterval(async () => {
        for (const ws of wss.clients) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            try {
                const conn = await getOrConnectParams(ws.viewingPort || 9000);
                const snapshot = await captureSnapshot(conn);
                if (snapshot) ws.send(JSON.stringify({ type: 'snapshot_update', port: conn.port, title: conn.title, ...snapshot }));
            } catch (e) { }
        }
    }, POLL_INTERVAL);

    wss.on('connection', ws => {
        ws.viewingPort = 9000;
        ws.on('message', msg => {
            try {
                const d = JSON.parse(msg);
                if (d.type === 'switch_port') ws.viewingPort = parseInt(d.port);
                if (d.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
            } catch (e) { }
        });
    });

    server.listen(SERVER_PORT, '0.0.0.0', () => console.log(`🚀 [V4-TRUE-HYBRID] Listening on http://localhost:${SERVER_PORT}`));
}

createServer();
