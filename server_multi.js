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
const POLL_INTERVAL = 1000; // 1 second
const SERVER_PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';
let AUTH_TOKEN = 'ag_default_token';

// --- Global Error Handlers (Moved to top to prevent startup crashes) ---
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
});

// --- Multi-Instance State ---
// Map<Port, CDPConnection>
const activeConnections = new Map();
// Map<Port, Promise> to prevent parallel connecting to the same port
const connectionLocks = new Map();
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
            // Check if port is even open first
            const inUse = await isPortInUse(port);
            if (!inUse) continue;

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
        } catch (e) {
            console.log(`🔍 Port ${port} probe failed: ${e.message}`);
        }
    }
    return instances;
}


async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error(`CDP connection to ${url} timed out (2s)`));
        }, 2000); // Reduced from 5000ms to 2000ms for faster port switching

        ws.on('open', () => {
            clearTimeout(timeout);
            resolve();
        });
        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
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

async function isCDPAlive(conn) {
    try {
        const result = await Promise.race([
            conn.call("Runtime.evaluate", { expression: "1+1", returnByValue: true }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500))
        ]);
        return result && result.result && result.result.value === 2;
    } catch (e) {
        return false;
    }
}

// Ensure we have a valid connection to the requested port
async function getOrConnectParams(port, forceReconnect = false) {
    if (activeConnections.has(port) && !forceReconnect) {
        const conn = activeConnections.get(port);
        // Skip health check if WebSocket is OPEN - trust the connection for faster switching
        if (conn.ws.readyState === WebSocket.OPEN) {
            return conn;
        }
        activeConnections.delete(port);
    }

    // Check if another connection attempt is already in progress
    if (connectionLocks.has(port)) {
        console.log(`⏳ Connection already in progress for Port ${port}, waiting...`);
        return connectionLocks.get(port);
    }

    const connectPromise = (async () => {
        try {
            console.log(`🔌 [CONNECT] Starting for Port ${port}...`);
            const instances = await findAllInstances();
            const target = instances.find(i => i.port === port);

            if (!target) {
                console.error(`❌ [CONNECT] Port ${port} not found in instances.`);
                throw new Error(`Instance on port ${port} not found. Launch it first.`);
            }

            console.log(`🔌 [CONNECT] Socket connecting to ${target.url}...`);
            const conn = await connectCDP(target.url);
            conn.port = port;
            conn.title = target.title;
            activeConnections.set(port, conn);
            console.log(`✅ [CONNECT] Port ${port} established [${target.title}]`);
            return conn;
        } catch (e) {
            console.error(`❌ [CONNECT] Port ${port} failed:`, e.message);
            throw e;
        } finally {
            // CRITICAL: Always clear the lock so subsequent attempts can retry
            connectionLocks.delete(port);
        }
    })();

    connectionLocks.set(port, connectPromise);
    return connectPromise;
}


// --- Process Management ---
const runningProcesses = new Map();

async function spawnInstance(port) {
    if (runningProcesses.has(port)) {
        const isRunning = await isPortInUse(port);
        if (isRunning) throw new Error(`Port ${port} is already in use.`);
        runningProcesses.delete(port);
    }

    console.log(`🚀 Spawning Background Instance for Port ${port}...`);
    const userData = join(__dirname, `.user_data_${port}`);
    const cmd = `"D:\\Program Files\\Antigravity\\Antigravity.exe"`;
    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir="${userData}"`,
        '--no-first-run',           // Suppress setup/welcome screens
        '--disable-workspace-trust' // Avoid trust dialogs that block loading
    ];

    const fullCmd = `${cmd} ${args.join(' ')}`;
    console.log(`[SPAWN] [PERSISTENCE] Executing: ${fullCmd}`);

    const child = spawn(fullCmd, [], {
        detached: true,
        stdio: 'ignore',
        shell: true
    });

    child.on('error', (err) => {
        console.error(`❌ Spawn error for Port ${port}:`, err);
    });

    child.unref();
    runningProcesses.set(port, child);

    await new Promise(r => setTimeout(r, 6000));
    return { success: true };
}


async function killInstance(port) {
    console.log(`🛑 Attempting to kill instance on Port ${port}...`);

    // 1. Try Graceful Shutdown via CDP first (to save session/project state)
    try {
        let conn = activeConnections.get(port);
        // If not connected but process exists, try to connect briefly to say "goodbye"
        if (!conn) {
            try {
                conn = await getOrConnectParams(port);
            } catch (e) { /* ignore */ }
        }

        if (conn) {
            console.log(`👋 Sending graceful close command to Port ${port}...`);
            // Attempt Browser.close with a timeout (prevent hanging on "Unsaved Changes" dialogs)
            await Promise.race([
                conn.call('Browser.close'),
                new Promise(r => setTimeout(r, 1500))
            ]).catch(() => { });

            // Wait a moment for it to write state and exit
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {
        console.log(`⚠️ Graceful shutdown failed for Port ${port}, proceeding to force kill.`);
    }

    // 2. Force Kill (Cleanup whatever is left)
    return new Promise((resolve) => {
        const portCmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port} ^| findstr LISTENING') do taskkill /f /pid %a`;
        exec(portCmd, (err) => {
            if (!err) {
                console.log(`✅ Killed Port ${port} via netstat.`);
            }

            // Fallback: search by debug port flag in command line
            const flag = `--remote-debugging-port=${port}`;
            const psCmd = `powershell -Command "Get-WmiObject Win32_Process -Filter \\"name='antigravity.exe'\\" | Where-Object { $_.CommandLine -like '*${flag}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;

            exec(psCmd, () => {
                activeConnections.delete(port);
                snapshotCache.delete(port);
                runningProcesses.delete(port);
                resolve({ success: true });
            });
        });
    });
}


async function isPortInUse(port) {
    return new Promise((resolve) => {
        // Use a more precise findstr to avoid matching substring of ports
        // We match for :PORT followed by a space to target the local address column
        exec(`netstat -ano | findstr LISTENING | findstr :${port}`, (err, stdout) => {
            if (err || !stdout) return resolve(false);
            const lines = stdout.split('\n');
            const match = lines.some(line => {
                const parts = line.trim().split(/\s+/);
                const localAddr = parts[1] || ''; // Second column is local address:port
                return localAddr.endsWith(`:${port}`);
            });
            resolve(match);
        });
    });
}



// --- Scripts & Actions ---
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
        
        // --- NEW: URL Rewriting for vscode-file:// assets ---
        // These URLs look like vscode-file://vscode-app/d:/Program%20Files/Antigravity/resources/app/...
        // We rewrite them to /vscode-resources/...
        const rewriteUrl = (str) => {
            if (!str) return str;
            try {
                // Use RegExp constructor to avoid slash-escaping hell in backtick strings
                const pattern = 'vscode-file://vscode-app/.*?/resources/app/';
                const regex = new RegExp(pattern, 'g');
                return str.replace(regex, '/vscode-resources/');
            } catch (e) {
                return str;
            }
        };

        return {
            html: rewriteUrl(html),
            css: rewriteUrl(allCSS),
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
            const result = await cdp.call("Runtime.evaluate", { expression: CAPTURE_SCRIPT, returnByValue: true, contextId: ctx.id });
            if (result.result?.value && !result.result.value.error) return result.result.value;
        } catch (e) { }
    }
    return null;
}

async function injectMessage(cdp, text) {
    const safeText = JSON.stringify(text);
    const EXPRESSION = `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };
        const editors = [...document.querySelectorAll('#cascade [data-lexical-editor="true"][contenteditable="true"][role="textbox"]')]
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
            editor.dispatchEvent(new InputEvent("beforeinput", { bubbles:true, inputType:"insertText", data: textToInsert }));
            editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: textToInsert }));
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const submit = document.querySelector("svg.lucide-arrow-right")?.closest("button");
        if (submit && !submit.disabled) {
            submit.click();
            return { ok:true, method:"click_submit" };
        }
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter" }));
        editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true, key:"Enter", code:"Enter" }));
        return { ok:true, method:"enter_keypress" };
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (result.result && result.result.value) {
                console.log(`[INJECT] Port ${cdp.port} success via context ${ctx.id}:`, result.result.value);
                return result.result.value;
            }
        } catch (e) {
            console.error(`[INJECT] Port ${cdp.port} context ${ctx.id} error:`, e.message);
        }
    }
    console.error(`[INJECT] Port ${cdp.port} failed: No working context out of ${cdp.contexts.length}`);
    return { ok: false, reason: "no_context" };
}


async function setMode(cdp, mode) {
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
            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            if (!visibleDialog) {
                 visibleDialog = Array.from(document.querySelectorAll('div')).find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && (style.position === 'absolute' || style.position === 'fixed') && d.innerText.includes('${mode}');
                    });
            }
            if (!visibleDialog) return { error: 'Dropdown not opened' };
            const target = Array.from(visibleDialog.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === '${mode}');
            if (target) { target.click(); return { success: true }; }
            return { error: 'Mode option text not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

async function stopGeneration(cdp) {
    const EXP = `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) { cancel.click(); return { success: true }; }
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) { stopBtn.click(); return { success: true }; }
        return { error: 'No active generation found' };
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

async function clickElement(cdp, { selector, index, textContent }) {
    const EXP = `(async () => {
        try {
            let elements = Array.from(document.querySelectorAll('${selector}'));
            if ('${textContent}') elements = elements.filter(el => el.textContent.includes('${textContent}'));
            const target = elements[${index}];
            if (target) { target.click(); return { success: true }; }
            return { error: 'Not found' };
        } catch(e) { return { error: e.toString() }; }
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Click failed' };
}

async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    const EXP = `(async () => {
        try {
            const chatArea = document.querySelector('#cascade .overflow-y-auto, #cascade [data-scroll-area]');
            if (!chatArea) return { error: 'No scrollable found' };
            if (${scrollPercent} !== undefined) {
                const maxScroll = chatArea.scrollHeight - chatArea.clientHeight;
                chatArea.scrollTop = maxScroll * ${scrollPercent};
            } else {
                chatArea.scrollTop = ${scrollTop || 0};
            }
            return { success: true };
        } catch(e) { return { error: e.toString() }; }
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed' };
}

async function setModel(cdp, modelName) {
    const EXP = `(async () => {
        try {
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
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div')).find(d => {
                    const style = window.getComputedStyle(d);
                    return d.offsetHeight > 0 && (style.position === 'absolute' || style.position === 'fixed') && d.innerText.includes('${modelName}');
                });
            if (!visibleDialog) return { error: 'Model list not opened' };
            const target = Array.from(visibleDialog.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.includes('${modelName}'));
            if (target) { target.click(); return { success: true }; }
            return { error: 'Model not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

async function getAppState(cdp) {
    const EXP = `(async () => {
        try {
            const state = { mode: 'Unknown', model: 'Unknown' };
            const allEls = Array.from(document.querySelectorAll('*'));
            for (const el of allEls) {
                if (el.children.length > 0) continue;
                const text = (el.innerText || '').trim();
                if (text === 'Fast' || text === 'Planning') {
                    let current = el;
                    for (let i = 0; i < 5; i++) {
                        if (current && (window.getComputedStyle(current).cursor === 'pointer' || current.tagName === 'BUTTON')) { state.mode = text; break; }
                        current = current?.parentElement;
                    }
                }
                if (state.mode !== 'Unknown') break;
            }
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            const modelEl = textNodes.find(el => ["Gemini", "Claude", "GPT"].some(k => el.innerText.includes(k)) && el.closest('button')?.querySelector('svg.lucide-chevron-up'));
            if (modelEl) state.model = modelEl.innerText.trim();
            return state;
        } catch(e) { return { error: e.toString() }; }
    })()`;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", { expression: EXP, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

function isLocalRequest(req) {
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) return false;
    const ip = req.ip || req.socket.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' ||
        ip.includes('192.168.') || ip.includes('10.') || ip.includes('100.') ||
        ip.startsWith('::ffff:192.168.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:100.');
}

// --- Main Server ---
async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    const ACTIVE_PORTS = [9000, 9001, 9002, 9003];
    app.use(express.static(join(__dirname, 'public')));
    app.use(express.json({ limit: '50mb' }));
    app.use(cookieParser('antigravity_secret_key_1337'));

    // Serve Antigravity internal resources (icons, etc.)
    const vscodeResourcesPath = "D:/Program Files/Antigravity/resources/app";
    if (fs.existsSync(vscodeResourcesPath)) {
        console.log(`📂 Serving VSCode resources from: ${vscodeResourcesPath}`);
        app.use('/vscode-resources', express.static(vscodeResourcesPath));
    }

    // Fix favicon 404
    app.get('/favicon.ico', (req, res) => res.status(204).end());

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
    // --- Instance & Slot Management ---
    app.get('/instances', async (req, res) => {
        const list = await findAllInstances();
        res.json({ instances: list });
    });

    app.get('/slots', async (req, res) => {
        const instances = await findAllInstances();
        const slots = [9000, 9001, 9002, 9003].map(port => {
            const running = instances.find(i => i.port === port);
            return {
                port,
                title: running ? running.title : `Slot ${port}`,
                running: !!running
            };
        });
        res.json({ slots });
    });

    app.get('/debug-connections', (req, res) => {
        const active = Array.from(activeConnections.entries()).map(([port, conn]) => ({
            port,
            title: conn.title,
            contexts: conn.contexts.length,
            wsReady: conn.ws.readyState === WebSocket.OPEN
        }));
        const locks = Array.from(connectionLocks.keys());
        res.json({ active, locks });
    });

    app.post('/instance/start', async (req, res) => {
        const { port } = req.body;
        try {
            await spawnInstance(parseInt(port));
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/instance/stop', async (req, res) => {
        const { port } = req.body;
        try {
            await killInstance(parseInt(port));
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/instance/kill-all', async (req, res) => {
        try {
            exec(`taskkill /f /im antigravity.exe`);
            activeConnections.clear();
            snapshotCache.clear();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const getSocketPort = (ws) => ws.viewingPort || 9000;

    // --- API Endpoints adjusted for Multi-Session ---
    const getConn = (req) => {
        const port = parseInt(req.query.port) || 9000;
        const conn = activeConnections.get(port);
        if (!conn) console.log(`[ROUTING] Warning: No active connection for port ${port}`);
        return conn;
    }

    app.get('/instances', async (req, res) => {
        const list = await findAllInstances();
        res.json({ instances: list });
    });

    app.post('/switch-instance', async (req, res) => {
        const { port } = req.body;
        try {
            const conn = await getOrConnectParams(parseInt(port));
            res.json({ success: true, title: conn.title });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // --- Interactive Routes with Port Awareness ---
    app.post('/send', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[TRACE] /send received for Port ${port}. Message length: ${req.body.message?.length}`);

        try {
            const conn = await getOrConnectParams(port);
            console.log(`[TRACE] Port ${port} connection acquired. Injecting...`);
            const result = await injectMessage(conn, req.body.message);
            console.log(`[TRACE] Port ${port} inject result:`, result);
            res.json(result);

            // Immediate visual feedback
            setTimeout(() => triggerSnapshotForPort(port), 150);
            setTimeout(() => triggerSnapshotForPort(port), 600);
        } catch (e) {
            console.error(`[TRACE] Port ${port} send failed:`, e.message);
            res.status(503).json({ error: e.message });
        }
    });


    app.post('/remote-click', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[CMD] Clicking element on Port ${port}`);
        try {
            const conn = await getOrConnectParams(port);
            const result = await clickElement(conn, req.body);
            res.json(result);

            // Immediate visual feedback
            setTimeout(() => triggerSnapshotForPort(port), 300);
        } catch (e) {
            res.status(503).json({ error: e.message });
        }
    });

    app.post('/remote-scroll', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[CMD] Scrolling on Port ${port}`);
        try {
            const conn = await getOrConnectParams(port);
            const result = await remoteScroll(conn, req.body);
            res.json(result);

            // Instant sync feedback
            triggerSnapshotForPort(port);
        } catch (e) {
            res.status(503).json({ error: e.message });
        }
    });

    app.post('/set-mode', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[CMD] Setting mode for Port ${port}: ${req.body.mode}`);
        const conn = await getOrConnectParams(port).catch(() => null);
        if (!conn) return res.status(503).json({ error: 'Port not connected' });
        const result = await setMode(conn, req.body.mode);
        res.json(result);
        setTimeout(() => triggerSnapshotForPort(port), 300);
    });

    app.post('/set-model', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[CMD] Setting model for Port ${port}: ${req.body.model}`);
        const conn = await getOrConnectParams(port).catch(() => null);
        if (!conn) return res.status(503).json({ error: 'Port not connected' });
        const result = await setModel(conn, req.body.model);
        res.json(result);
    });

    app.post('/stop', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        console.log(`[CMD] Stopping generation on Port ${port}`);
        const conn = activeConnections.get(port);
        if (!conn) return res.status(503).json({ error: 'Port not connected' });
        const result = await stopGeneration(conn);
        res.json(result);
    });

    app.get('/app-state', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        let conn = activeConnections.get(port);
        if (!conn) {
            try { conn = await getOrConnectParams(port); } catch (e) { }
        }

        if (conn) {
            const state = await getAppState(conn);
            return res.json({ activePort: port, ...state });
        }
        res.json({ activePort: port, mode: 'Unknown', model: 'Unknown' });
    });

    app.get('/snapshot', async (req, res) => {
        const port = parseInt(req.query.port) || 9000;
        try {
            const conn = await getOrConnectParams(port);
            const snapshot = await captureSnapshot(conn);
            if (snapshot) {
                snapshot.hash = hashString(snapshot.html);
                res.json(snapshot);
            } else {
                res.status(503).json({ error: `Port ${port} snapshot failed` });
            }
        } catch (e) {
            res.status(503).json({ error: e.message });
        }
    });

    // Remote interaction endpoints needing CDP
    // We update frontend to send ?port=... in fetch calls OR rely on socket commands

    // --- WebSocket ---
    wss.on('connection', (ws, req) => {
        console.log('📱 Client Connected');
        ws.isAlive = true;
        ws.on('pong', () => ws.isAlive = true);

        // Default to 9000 to ensure polling starts even before switch_port message
        ws.viewingPort = 9000;

        ws.on('message', async (msg) => {
            try {
                const data = JSON.parse(msg);

                // Health check ping/pong (for detecting zombie connections on mobile)
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                    return;
                }

                if (data.type === 'switch_port') {
                    const newPort = parseInt(data.port);
                    console.log(`📡 Client requested switch to ${newPort}`);

                    // 1. Immediately update subscription so broadcasts reach the client during connection wait
                    ws.viewingPort = newPort;

                    // 2. Clear hash cache for this port to force immediate broadcast
                    snapshotCache.delete(newPort);

                    try {
                        const conn = await getOrConnectParams(newPort);
                        ws.send(JSON.stringify({
                            type: 'switched',
                            port: newPort,
                            title: conn.title
                        }));

                        // Immediate push after connection is confirmed
                        forcePushSnapshot(ws, newPort);
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'error', message: e.message }));
                    }
                }

            } catch (e) { }
        });
    });

    async function forcePushSnapshot(ws, port) {
        try {
            const conn = await getOrConnectParams(port);
            const snapshot = await captureSnapshot(conn);
            if (snapshot && ws.readyState === WebSocket.OPEN) {
                snapshot.hash = hashString(snapshot.html);
                ws.send(JSON.stringify({
                    type: 'snapshot_update',
                    port: port,
                    title: conn.title,
                    ...snapshot
                }));
            }
        } catch (e) {
            console.log(`Initial push failed for port ${port}:`, e.message);
        }
    }

    // --- Centralized Broadcast Loop ---
    // Heartbeat logic for mobile stability
    const interval = setInterval(() => {
        wss.clients.forEach(ws => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    // Reuseable helper to trigger a snapshot and broadcast for a specific port
    async function triggerSnapshotForPort(port) {
        try {
            let conn = activeConnections.get(port);
            if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
                conn = await getOrConnectParams(port);
            }
            const snapshot = await captureSnapshot(conn);
            if (snapshot) {
                const hash = hashString(snapshot.html);
                snapshotCache.set(port, hash); // Update cache so heartbeats don't re-send it
                snapshot.hash = hash;
                broadcastToPort(wss, port, snapshot);
                return snapshot;
            }
        } catch (e) {
            console.error(`Trigger failed for port ${port}:`, e.message);
        }
        return null;
    }

    setInterval(async () => {
        // 1. Identify which ports are actually being watched
        const watchedPorts = new Set();
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                watchedPorts.add(client.viewingPort || 9000);
            }
        });

        // 2. Fetch snapshots or maintain health for watched ports
        for (const port of watchedPorts) {
            try {
                let conn = activeConnections.get(port);

                // If we have a cached connection, check its health periodically
                if (conn && conn.ws.readyState === WebSocket.OPEN) {
                    const now = Date.now();
                    // Every 30 seconds (roughly 30 * POLL_INTERVAL), do a deep health check if idle
                    if (!conn.lastCheck || (now - conn.lastCheck > 30000)) {
                        const alive = await isCDPAlive(conn);
                        conn.lastCheck = now;
                        if (!alive) {
                            console.log(`📡 Port ${port} heartbeat failed. Forcing reconnect...`);
                            conn = await getOrConnectParams(port, true);
                        }
                    }
                } else {
                    // No connection or closed, attempt to establish
                    try {
                        conn = await getOrConnectParams(port);
                    } catch (e) {
                        const errorPayload = {
                            error: `Waiting for Port ${port}...`,
                            html: `<div style="padding:20px;text-align:center;color:#666;"><h3>Connecting to Port ${port}...</h3><p>${e.message}</p></div>`
                        };
                        broadcastToPort(wss, port, errorPayload);
                        continue;
                    }
                }

                if (!conn) continue;

                // Capture
                const snapshot = await captureSnapshot(conn);
                if (snapshot) {
                    const hash = hashString(snapshot.html);
                    const lastHash = snapshotCache.get(port);
                    // Only broadcast if changed (per port cache) - or if cache was cleared by switch_port
                    if (hash !== lastHash) {
                        snapshotCache.set(port, hash);
                        snapshot.hash = hash;
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
        const conn = activeConnections.get(port);
        const payload = JSON.stringify({
            type: 'snapshot_update',
            port: port,
            title: conn ? conn.title : `Port ${port}`,
            ...data
        });

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.viewingPort === port) {
                client.send(payload);
            }
        });
    }

    // Warmup connections to all ports for instant switching
    async function warmupConnections() {
        console.log('🔥 Warming up connections to all ports...');
        for (const port of [9000, 9001, 9002, 9003]) {
            try {
                await getOrConnectParams(port);
                console.log(`✅ Port ${port} warmed up`);
            } catch (e) {
                console.log(`⚠️  Port ${port} warmup skipped: ${e.message}`);
            }
        }
        console.log('🔥 Warmup complete!');
    }

    server.listen(SERVER_PORT, '0.0.0.0', () => {
        console.log(`🚀 Multi-Instance Server running on port ${SERVER_PORT}`);
        console.log(`   (Supports independent viewing of Ports 9000-9003)`);

        // Non-blocking warmup after 2 seconds
        setTimeout(() => warmupConnections(), 2000);
    });
}

// Start
killPortProcess(SERVER_PORT).then(createServer);
