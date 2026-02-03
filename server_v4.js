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
import { execSync, spawn, exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
// V4 runs on strict ports but manages the same CDP ports
const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000;
const SERVER_PORT = 3004; // V4 Dedicated Port
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';
let AUTH_TOKEN = 'ag_default_token';

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
    console.error('💥 [V4] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 [V4] Unhandled Rejection:', reason);
});

// --- Multi-Instance State ---
const activeConnections = new Map();
const connectionLocks = new Map();
const snapshotCache = new Map();
const runningProcesses = new Map(); // port -> child_process
let tickCount = 0; // Move to global for easier logging access

// --- Instance Management (Spawn/Kill) ---
async function spawnInstance(port) {
    if (await isPortInUse(port)) return { success: true, alreadyRunning: true };

    const userData = join(__dirname, `.user_data_${port}`);
    const cmd = `"D:\\Program Files\\Antigravity\\Antigravity.exe"`; // Hardcoded as per original
    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir="${userData}"`,
        '--no-first-run',
        '--disable-workspace-trust'
    ];

    const fullCmd = `${cmd} ${args.join(' ')}`;
    console.log(`[V4-SPAWN] Port ${port}: ${fullCmd}`);

    const child = spawn(fullCmd, [], { detached: true, stdio: 'ignore', shell: true });
    child.unref();
    runningProcesses.set(port, child);

    // Wait for port to be ready
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await isPortInUse(port)) return { success: true };
    }
    return { error: 'Timeout waiting for port' };
}

async function killInstance(port) {
    console.log(`[V4-KILL] Port ${port}`);
    // Simple force kill via netstat/taskkill
    return new Promise((resolve) => {
        const portCmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port} ^| findstr LISTENING') do taskkill /f /pid %a`;
        exec(portCmd, (err) => {
            if (!err) console.log(`[V4-KILL] Killed ${port}`);
            activeConnections.delete(port);
            runningProcesses.delete(port);
            resolve({ success: true });
        });
    });
}

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

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

async function isPortInUse(port) {
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
            const list = await getJson(`http://127.0.0.1:${port}/json`);
            // DETAILED LOGGING: Reveal all targets
            console.log(`[V4-DISCOVERY] Port ${port} found ${list.length} targets`);

            // DETAILED LOGGING: Reveal all targets
            console.log(`[V4-DISCOVERY] Port ${port} found ${list.length} targets`);
            list.forEach(t => console.log(`  - [${t.type}] Title: "${t.title}" | WS: ${t.webSocketDebuggerUrl ? 'YES' : 'NO'} | URL: ${t.url?.substring(0, 60)}`));

            const pages = list.filter(t => (t.type === 'page' || t.type === 'webview') && t.webSocketDebuggerUrl);

            if (pages.length > 0) {
                // V4 Logic: Prioritize real workbench/chat targets over Launchpad
                const mainTarget = pages.find(t => t.title && t.title.toLowerCase().includes('antigravity')) ||
                    pages.find(t => t.url && t.url.includes('workbench.html')) ||
                    // Pick the first target that is NOT Launchpad/Walkthrough
                    pages.find(t => t.title && !t.title.includes('Launchpad') && !t.title.includes('Walkthrough')) ||
                    // Pick the first target that has an EMPTY title (often the workbench itself)
                    pages.find(t => t.title === "") ||
                    pages[0];

                instances.push({
                    port,
                    targets: pages.map(t => ({
                        url: t.webSocketDebuggerUrl,
                        id: t.id,
                        title: t.title || `Untitled Target (${t.id.substring(0, 4)})`
                    })),
                    title: (mainTarget.title && mainTarget.title !== "Launchpad") ? mainTarget.title : `Antigravity (Port ${port})`
                });
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
                console.log(`[V4-CDP] Context created on ${url.substring(url.length - 10)}: ${data.params.context.id} (${data.params.context.name || 'main'})`);
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

async function getOrConnectParams(port, forceReconnect = false) {
    if (activeConnections.has(port) && !forceReconnect) {
        const conns = activeConnections.get(port);
        // Ensure all connections are still open, or prune them
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
                    console.log(`[V4-CDP] Connected to Target: "${conn.title}" on Port ${port} (Total Contexts: ${conn.contexts.length})`);
                } catch (e) {
                    console.error(`[V4-CDP] Failed to connect to "${target.title}":`, e.message);
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

// --- Scripts (The Hybrid Magic) ---

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

// 1. Snapshot: Iterates multiple targets to find the chat panel
// 1. Snapshot: Iterates multiple targets to find the chat panel
async function captureSnapshot(cdpList) {
    const CAPTURE_SCRIPT = `(() => {
        const cascade = document.getElementById('cascade') || document.querySelector('[class*="cascade"]');
        if (!cascade) {
            const iframes = document.querySelectorAll('iframe').length;
            const webviews = document.querySelectorAll('webview').length;
            const bodyPreview = document.body?.innerText?.substring(0, 50) || 'empty';
            return { error: 'cascade not found', body: bodyPreview + ' | iframes: ' + iframes + ' | webviews: ' + webviews };
        }
        
        // Safe Cleaning Logic (Matches V3/V2 - Non-destructive)
        const clone = cascade.cloneNode(true);
        const inputContainer = clone.querySelector('[contenteditable="true"]')?.closest('div[id^="cascade"] > div');
        if (inputContainer) inputContainer.remove();

        const html = clone.outerHTML;
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight
        };

        const rules = [];
        for (const sheet of document.styleSheets) {
            try { 
                const cssText = Array.from(sheet.cssRules).map(r => r.cssText).join('\\n');
                rules.push(cssText);
            } catch (e) { }
        }
        
        const rewriteUrl = (s) => s ? s.replace(/vscode-file:\\/\\/vscode-app\\/.*?\\/resources\\/app\\//g, '/vscode-resources/') : s;
        
        return {
            html: rewriteUrl(html),
            css: rewriteUrl(rules.join('\\n')),
            scrollInfo: scrollInfo
        };
    })()`;

    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const result = await cdp.call("Runtime.evaluate", { expression: CAPTURE_SCRIPT, returnByValue: true, contextId: ctx.id });
                if (result.result?.value) {
                    if (!result.result.value.error) {
                        const val = result.result.value;
                        val.hash = simpleHash(val.html + (val.scrollInfo?.scrollTop || 0));
                        val.targetTitle = cdp.title;
                        return val;
                    } else {
                        // LOG EVERYTHING for diagnosis
                        console.log(`[V4-SNAPSHOT] Port ${cdp.port} Target "${cdp.title}" Ctx ${ctx.id}: ${result.result.value.error} | Content: ${result.result.value.body || 'N/A'}`);
                    }
                }
            } catch (e) {
                console.error(`[V4-SNAPSHOT] Port ${cdp.port} Ctx ${ctx.id} exception:`, e.message);
            }
        }
    }
    return null;
}

// 2. Inject: Robust Input Logic
async function injectMessage(cdpList, text, force = false) {
    const safeText = JSON.stringify(text);
    const EXPRESSION = `(async () => {
        // [V3 Logic] Precise busy detection
        const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
        const stopBtn = document.querySelector('button svg.lucide-square, svg.lucide-circle-stop')?.closest('button');
        const busyEl = cancel || stopBtn;
        
        // Return busy unless forced
        if (!${force} && busyEl && busyEl.offsetParent !== null && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

        // [V3 Logic] Find editor loosely (don't require #cascade parent)
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
        
        // [V4 Hotfix] Find Submit button while strictly avoiding "Continue" or "Stop" system buttons
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a.button'));
        const isActuallySend = (b) => {
            const label = (b.innerText + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.title || '')).toLowerCase();
            if (label.includes('continue') || label.includes('繼續') || label.includes('stop') || label.includes('停止')) return false;
            return label.includes('send') || label.includes('submit') || label.includes('發送') || b.querySelector('svg.lucide-arrow-right, .lucide-send');
        };
        
        const submit = allButtons.find(isActuallySend);
        
        if (submit && submit.offsetParent !== null) {
             // Only click if it's visible and safe
             setTimeout(() => submit.click(), 50);
             return { ok: true, method: "click_verified_send" };
        } else {
             // Safe fallback for text chats
             editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
             return { ok: true, method: "enter_safe_fallback" };
        }
    })()`;

    let lastError = { ok: false, reason: "no_context" };
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                const val = res.result?.value;

                if (val) {
                    if (val.ok) {
                        console.log(`[INJECT] Port ${cdp.port} success via context ${ctx.id}:`, val);
                        return val;
                    }
                    // If busy, it means we FOUND the cancel button, so we are in the right context but it is busy!
                    if (val.reason === 'busy') {
                        console.log(`[INJECT] Port ${cdp.port} busy via context ${ctx.id}`);
                        return val;
                    }
                    lastError = val;
                }
            } catch (e) {
                console.error(`[INJECT] Port ${cdp.port} context ${ctx.id} error:`, e.message);
            }
        }
    }
    console.warn(`[INJECT] Tried all contexts for all targets. Last result:`, lastError);
    return lastError;
}

async function getAppState(cdpList) {
    // Uses the improved detection from server_multi.js
    const EXP = `(async () => {
        try {
            const state = { mode: 'Unknown', model: 'Unknown' };
            const allEls = Array.from(document.querySelectorAll('*'));
            for (const el of allEls) {
                if (el.innerText === 'Fast' || el.innerText === 'Planning') { state.mode = el.innerText; break; }
            }
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            const modelEl = textNodes.find(el => {
                return ["Gemini", "Claude", "GPT", "Grok", "o1", "Sonnet", "Opus"].some(k => el.innerText.includes(k)) && 
                       (el.closest('button') || el.closest('[class*="statusbar"]'));
            });
            if (modelEl) state.model = modelEl.innerText.trim();
            return state;
        } catch(e) { return { error: e.toString() }; }
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value && !res.result.value.error && res.result.value.mode !== 'Unknown') return res.result.value;
            } catch (e) { }
        }
    }
    return { mode: 'Unknown', model: 'Unknown', error: 'Context failed or state not found' };
}

// 4. Set Mode (Fast/Planning)
async function setMode(cdpList, mode) {
    if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };
    const EXP = `(async () => {
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                if (el.children.length > 0) return false;
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });
            let modeBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                        modeBtn = current;
                        break;
                    }
                    current = current.parentElement;
                }
                if (modeBtn) break;
            }
            if (!modeBtn) return { error: 'Mode indicator/button not found' };
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));
            
            // Find dropdown item
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div')).find(d => {
                const style = window.getComputedStyle(d);
                return d.offsetHeight > 0 && (style.position === 'absolute' || style.position === 'fixed') && d.innerText.includes('${mode}');
            });
            
            if (!visibleDialog) return { error: 'Dropdown not opened' };
            const target = Array.from(visibleDialog.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === '${mode}');
            if (target) { target.click(); return { success: true }; }
            return { error: 'Mode option text not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;

    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value && res.result.value.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed to set mode in any context' };
}

// 5. Set Model
async function setModel(cdpList, modelName) {
    const safeModel = JSON.stringify(modelName).slice(1, -1); // remove quotes
    const EXP = `(async () => {
        try {
            // Find the model selector button
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => el.children.length === 0 && ["Gemini", "Claude", "GPT", "Model"].some(k => el.textContent.includes(k)));
            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                        if (current.querySelector('svg.lucide-chevron-up') || current.innerText.includes('Model')) { modelBtn = current; break; }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }
            if (!modelBtn) return { error: 'Model selector not found' };
            
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));
            
            // Find options in dropdown
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div')).find(d => {
                 const style = window.getComputedStyle(d);
                 return d.offsetHeight > 0 && (style.position === 'absolute' || style.position === 'fixed') && d.innerText.includes('${safeModel}');
            });
            if (!visibleDialog) return { error: 'Model list not opened' };
            
            const target = Array.from(visibleDialog.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.includes('${safeModel}'));
            if (target) { target.click(); return { success: true }; }
            return { error: 'Model option not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;
    for (const cdp of cdpList) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
                if (res.result?.value && res.result.value.success) return res.result.value;
            } catch (e) { }
        }
    }
    return { error: 'Failed to set model in any context' };
}

// --- Main Server ---
async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.json());
    app.use(cookieParser('antigravity_v4_secret'));

    // Priority Serve V4 Index
    app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index_v4.html')));

    // Static Assets
    app.use(express.static(join(__dirname, 'public')));

    // Serve internal resources
    const vscodeResourcesPath = "D:/Program Files/Antigravity/resources/app";
    if (fs.existsSync(vscodeResourcesPath)) app.use('/vscode-resources', express.static(vscodeResourcesPath));

    // Message Deduplication
    const processedMsgIds = new Map(); // id -> timestamp
    const DEDUP_WINDOW = 30000; // 30 seconds

    app.post('/send', async (req, res) => {
        try {
            const { message, msgId } = req.body;
            const port = parseInt(req.query.port) || 9000;

            console.log(`[SEND] Port ${port} | ID: ${msgId} | Len: ${message?.length}`);

            // Deduplication Check
            if (msgId) {
                const last = processedMsgIds.get(msgId);
                if (last && Date.now() - last < DEDUP_WINDOW) {
                    console.log(`[DEDUP] HIT! Ignoring duplicate ${msgId}`);
                    return res.json({ ok: true, ignored: true });
                }
                processedMsgIds.set(msgId, Date.now());

                // Cleanup old ids
                const now = Date.now();
                for (const [id, time] of processedMsgIds) {
                    if (now - time > DEDUP_WINDOW) processedMsgIds.delete(id);
                }
            }

            const conn = await getOrConnectParams(port);
            const result = await injectMessage(conn, message, req.query.force === 'true');

            console.log(`[INJECT] Result: ${JSON.stringify(result)}`);

            // If injection failed (e.g. busy), remove from dedup so it can be retried properly
            if (!result.ok && msgId) {
                console.log(`[DEDUP] Clearing ${msgId} due to failure/busy`);
                processedMsgIds.delete(msgId);
            }

            res.json(result);
        } catch (e) {
            console.error(`[SEND ERROR]`, e);
            res.status(503).json({ error: e.message });
        }
    });

    app.get('/snapshot', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const snapshot = await captureSnapshot(conn);
            res.json(snapshot);
        } catch (e) { res.status(503).json({ error: e.message }); }
    });

    app.get('/app-state', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const state = await getAppState(conn);
            res.json(state);
        } catch (e) { res.json({ mode: 'Unknown', model: 'Unknown' }); }
    });

    app.post('/set-mode', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const result = await setMode(conn, req.body.mode);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/set-model', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const result = await setModel(conn, req.body.model);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 5. Scroll Sync: Control IDE scroll from Client
    async function injectScroll(cdpList, scrollTop) {
        const SCROLL_SCRIPT = `(() => {
            const cascade = document.getElementById('cascade');
            if (!cascade) return false;
            const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
            scrollContainer.scrollTop = ${scrollTop};
            return true;
        })()`;

        let success = false;
        for (const cdp of cdpList) {
            for (const ctx of cdp.contexts) {
                try {
                    const res = await cdp.call("Runtime.evaluate", { expression: SCROLL_SCRIPT, returnByValue: true, contextId: ctx.id });
                    if (res.result?.value === true) success = true;
                } catch (e) { }
            }
        }
        return success;
    }

    // DEBUG: Dump Full HTML
    app.get('/dump-html', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        try {
            const connections = await getOrConnectParams(port);
            let output = '';
            for (const conn of connections) {
                const r = await conn.call("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
                output += `\n\n<!-- TARGET: ${conn.title} (${conn.url}) -->\n` + (r.result?.value || 'NULL');
            }
            fs.writeFileSync('debug_dump.html', output);
            res.send(`Dumped to debug_dump.html (${output.length} bytes)`);
        } catch (e) { res.status(500).send(e.message); }
    });

    app.get('/slots', async (req, res) => {
        const instances = await findAllInstances();
        const slots = PORTS.map(port => {
            const inst = instances.find(i => i.port === port);
            return {
                port,
                running: !!inst,
                title: inst ? inst.title : `Slot ${port}`
            };
        });
        res.json({ slots });
    });

    app.post('/start-slot', async (req, res) => {
        const { port } = req.body;
        if (!PORTS.includes(port)) return res.status(400).json({ error: 'Invalid port' });
        try {
            const result = await spawnInstance(port);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/stop-slot', async (req, res) => {
        const { port } = req.body;
        try {
            const result = await killInstance(port);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/kill-all', async (req, res) => {
        for (const port of PORTS) await killInstance(port);
        res.json({ success: true });
    });

    // Server-side polling to push updates (Live Sync)
    setInterval(async () => {
        tickCount++;
        const forceUpdate = (tickCount % 5 === 0);

        const clients = Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN);
        if (tickCount % 5 === 0) console.log(`[V4-TICK] Clients connected: ${clients.length}`);

        for (const ws of clients) {
            try {
                const targetPort = ws.viewingPort || 9000;
                const conn = await getOrConnectParams(targetPort);
                if (!conn) {
                    if (tickCount % 5 === 0) console.warn(`[V4-LOOP] No connection for port ${targetPort}`);
                    continue;
                }

                const snapshot = await captureSnapshot(conn);
                // [V4 Auto-Hunt] If snapshot is bad (Launchpad/Null) -> Hunt for better port
                let effectiveSnapshot = snapshot;
                if (!snapshot || (snapshot.targetTitle && (snapshot.targetTitle.includes('Launchpad') || snapshot.targetTitle.includes('Agent')))) {
                    if (tickCount % 5 === 0) { // Don't hunt too aggressively
                        for (const p of PORTS) {
                            if (p === targetPort) continue;
                            try {
                                const tryConn = await getOrConnectParams(p);
                                const trySnap = await captureSnapshot(tryConn);
                                // If we found a real cascade in another port
                                if (trySnap && trySnap.html && !trySnap.error) {
                                    console.log(`[V4-AUTO] Found better target on Port ${p}! Redirecting client...`);
                                    ws.send(JSON.stringify({ type: 'force_port_switch', port: p }));
                                    ws.viewingPort = p;
                                    effectiveSnapshot = trySnap; // Send it immediately
                                    break;
                                }
                            } catch (e) { }
                        }
                    }
                }

                if (effectiveSnapshot) {
                    if (ws.lastHash !== effectiveSnapshot.hash || forceUpdate) {
                        ws.send(JSON.stringify({ type: 'snapshot_update', port: ws.viewingPort, ...effectiveSnapshot }));
                        ws.lastHash = effectiveSnapshot.hash;
                    }
                }
            } catch (e) {
                console.error(`[V4-LOOP] Error:`, e.message);
            }
        }
    }, 1000);

    wss.on('connection', ws => {
        console.log(`[V4-WS] New client connected`);
        ws.viewingPort = 9000;
        ws.on('message', msg => {
            try {
                const d = JSON.parse(msg);
                if (d.type === 'switch_port') {
                    console.log(`[V4-WS] Switching to port ${d.port}`);
                    ws.viewingPort = parseInt(d.port);
                    ws.lastHash = null; // Force update on switch
                }
                if (d.type === 'scroll_event') {
                    // Sync scroll to IDE
                    const conn = activeConnections.get(ws.viewingPort);
                    if (conn) injectScroll(conn, d.scrollTop);
                }
            } catch (e) { }
        });
        ws.on('close', () => console.log(`[V4-WS] Client disconnected`));
    });

    server.listen(SERVER_PORT, '0.0.0.0', () => console.log(`🚀 [V4-STABLE] Listening on http://localhost:${SERVER_PORT}`));
}

createServer();
