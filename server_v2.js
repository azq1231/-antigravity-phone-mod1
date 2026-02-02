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
import { execSync, spawn, exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000;
const SERVER_PORT = 3005; // Different port for V2
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token_v2';
let AUTH_TOKEN = 'ag_v2_token';

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
    console.error('💥 [V2] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 [V2] Unhandled Rejection:', reason);
});

// --- Multi-Instance State ---
const activeConnections = new Map();
const connectionLocks = new Map();
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
                try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' }); } catch (e) { }
            }
        }
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) { return Promise.resolve(); }
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

function isPortInUse(port) {
    return new Promise((resolve) => {
        exec(`netstat -ano | findstr LISTENING | findstr :${port}`, (err, stdout) => {
            if (err || !stdout) return resolve(false);
            const lines = stdout.split('\n');
            const match = lines.some(line => {
                const parts = line.trim().split(/\s+/);
                const localAddr = parts[1] || '';
                return localAddr.endsWith(`:${port}`);
            });
            resolve(match);
        });
    });
}

// --- CDP Core ---
async function findAllInstances() {
    const instances = [];
    for (const port of PORTS) {
        try {
            const inUse = await isPortInUse(port);
            if (!inUse) continue;
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            let candidate = list.find(t => t.url?.includes('workbench.html'));
            if (!candidate) candidate = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (candidate && candidate.webSocketDebuggerUrl) {
                instances.push({ port, url: candidate.webSocketDebuggerUrl, title: candidate.title || `Antigravity (${port})` });
            }
        } catch (e) { }
    }
    return instances;
}

async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 2000);
        ws.on('open', () => { clearTimeout(timeout); resolve(); });
        ws.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    let idCounter = 1;
    const pendingCalls = new Map();
    const contexts = [];

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);
                if (data.error) reject(data.error); else resolve(data.result);
            }
            if (data.method === 'Runtime.executionContextCreated') contexts.push(data.params.context);
            else if (data.method === 'Runtime.executionContextDestroyed') {
                const idx = contexts.findIndex(c => c.id === data.params.executionContextId);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') contexts.length = 0;
        } catch (e) { }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => { if (pendingCalls.has(id)) { pendingCalls.delete(id); reject(new Error(`Timeout ${method}`)); } }, 30000);
        pendingCalls.set(id, { resolve, reject, timeoutId });
        try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(timeoutId); pendingCalls.delete(id); reject(e); }
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 600));
    return { ws, call, contexts, url, close: () => { try { ws.close(); } catch (e) { } } };
}

async function getOrConnectParams(port, forceReconnect = false) {
    if (activeConnections.has(port) && !forceReconnect) {
        const conn = activeConnections.get(port);
        if (conn.ws.readyState === WebSocket.OPEN) return conn;
        activeConnections.delete(port);
    }
    if (connectionLocks.has(port)) return connectionLocks.get(port);

    const connectPromise = (async () => {
        try {
            const instances = await findAllInstances();
            const target = instances.find(i => i.port === port);
            if (!target) throw new Error(`Port ${port} not found`);
            const conn = await connectCDP(target.url);
            conn.port = port; conn.title = target.title;
            activeConnections.set(port, conn);
            return conn;
        } finally { connectionLocks.delete(port); }
    })();
    connectionLocks.set(port, connectPromise);
    return connectPromise;
}

// --- Snapshot & Injection Logic (DYNAMIC) ---

const DYNAMIC_UTILS_JS = `
    const findContainer = () => {
        const editor = document.querySelector('[data-lexical-editor="true"]');
        if (!editor) return document.body;
        let curr = editor;
        for (let i = 0; i < 10; i++) {
            if (!curr || curr === document.body) break;
            if (curr.offsetHeight > 400 || curr.className.includes('chat')) return curr;
            curr = curr.parentElement;
        }
        return editor.parentElement || document.body;
    };
`;

async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        ${DYNAMIC_UTILS_JS}
        const cascade = findContainer();
        if (!cascade) return { error: 'container not found' };
        const cascadeStyles = window.getComputedStyle(cascade);
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight
        };
        const clone = cascade.cloneNode(true);
        const inputContainer = clone.querySelector('[contenteditable="true"]')?.closest('div');
        if (inputContainer && inputContainer.childElementCount < 5) inputContainer.remove(); 
        
        const html = clone.outerHTML;
        const rules = [];
        for (const sheet of document.styleSheets) {
            try { for (const rule of sheet.cssRules) rules.push(rule.cssText); } catch (e) { }
        }
        const allCSS = rules.join('\\n');
        
        const rewriteUrl = (str) => {
            if (!str) return str;
            const regex = new RegExp('vscode-file://vscode-app/.*?/resources/app/', 'g');
            return str.replace(regex, '/vscode-resources/');
        };

        return {
            html: rewriteUrl(html),
            css: rewriteUrl(allCSS),
            scrollInfo: scrollInfo,
            stats: { nodes: clone.getElementsByTagName('*').length, htmlSize: html.length, cssSize: allCSS.length }
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
        // 1. More precise busy detection
        const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
        const stopBtn = document.querySelector('button svg.lucide-square, button svg.lucide-circle-stop')?.closest('button');
        const busyEl = cancel || stopBtn;
        
        let isBusy = !!(busyEl && busyEl.offsetParent !== null && busyEl.offsetHeight > 0);
        if (${force}) isBusy = false;

        if (isBusy) {
            return { ok:false, reason:"busy", details: (busyEl.tagName + " " + (busyEl.id || busyEl.className)) };
        }
        
        // 2. Find editor
        const editors = [...document.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')]
            .filter(el => el.offsetParent !== null);
        const editor = editors.at(-1);
        if (!editor) return { ok:false, error:"editor_not_found" };
        
        const textToInsert = ${safeText};
        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);
        let inserted = false;
        try { inserted = !!document.execCommand?.("insertText", false, textToInsert); } catch {}
        if (!inserted) {
            editor.textContent = textToInsert;
            editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: textToInsert }));
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const submit = document.querySelector("svg.lucide-arrow-right, .lucide-send")?.closest("button");
        if (submit && !submit.disabled) { submit.click(); return { ok:true, method:"click_submit" }; }
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter" }));
        return { ok:true, method:"enter_keypress" };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            console.log(`[V2] [/send] Probing Context ${ctx.id}...`);
            const result = await cdp.call("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (result.result?.value) {
                console.log(`[V2] [/send] Context ${ctx.id} Result:`, result.result.value);
                if (result.result.value.ok || result.result.value.reason !== 'no_context') return result.result.value;
            }
        } catch (e) {
            console.error(`[V2] [/send] Context ${ctx.id} Error:`, e.message);
        }
    }
    return { ok: false, reason: "no_context" };
}

// --- Rest of Server implementation (simplified for V2) ---
async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.json());
    app.use(cookieParser());

    // Route for V2 UI - MUST COME BEFORE STATIC to override index.html
    app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index_v2.html')));

    app.use(express.static(join(__dirname, 'public')));

    app.get('/app-state', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[V2] [/app-state] Port: ${port}`);
        res.json({ activePort: port, mode: 'Fast', model: 'Gemini' });
    });

    app.get('/slots', async (req, res) => {
        const instances = await findAllInstances();
        const slots = PORTS.map(port => {
            const running = instances.find(i => i.port === port);
            return { port, title: running ? running.title : `Slot ${port}`, running: !!running };
        });
        res.json({ slots });
    });

    app.post('/send', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        const force = req.query.force === 'true';
        console.log(`[V2] [/send] Received message for Port ${port}: ${req.body.message} (force=${force})`);
        try {
            const conn = await getOrConnectParams(port);
            const result = await injectMessage(conn, req.body.message, force);
            console.log(`[V2] [/send] Injection result:`, result);
            res.json(result);
        } catch (e) {
            console.error(`[V2] [/send] Error:`, e.message);
            res.status(503).json({ error: e.message });
        }
    });

    app.get('/snapshot', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        try {
            const conn = await getOrConnectParams(port);
            const snapshot = await captureSnapshot(conn);
            if (snapshot) {
                snapshot.hash = hashString(snapshot.html);
                res.json(snapshot);
            }
            else {
                console.warn(`[V2] [/snapshot] Failed for Port ${port}`);
                res.status(503).json({ error: 'failed' });
            }
        } catch (e) { res.status(503).json({ error: e.message }); }
    });

    wss.on('connection', (ws) => {
        ws.viewingPort = 9000;
        ws.on('message', async (msg) => {
            const data = JSON.parse(msg);
            if (data.type === 'switch_port') ws.viewingPort = parseInt(data.port);
        });
    });

    setInterval(async () => {
        for (const ws of wss.clients) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            const port = ws.viewingPort || 9000;
            try {
                const conn = await getOrConnectParams(port);
                const snapshot = await captureSnapshot(conn);
                if (snapshot) {
                    ws.send(JSON.stringify({ type: 'snapshot_update', port, ...snapshot }));
                }
            } catch (e) { }
        }
    }, POLL_INTERVAL);

    server.listen(SERVER_PORT, '0.0.0.0', () => {
        console.log(`🚀 [V2] Testing Server running on http://localhost:${SERVER_PORT}`);
    });
}

killPortProcess(SERVER_PORT).then(createServer);
