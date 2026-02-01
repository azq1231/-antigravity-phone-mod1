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
const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000;
const SERVER_PORT = 3006; // V3 uses Port 3006
const AUTH_COOKIE_NAME = 'ag_auth_token_v3';
let AUTH_TOKEN = 'ag_v3_token';

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
            const pids = new Set();
            result.trim().split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            });
            pids.forEach(pid => { try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' }); } catch (e) { } });
        }
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) { return Promise.resolve(); }
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
            if (target?.webSocketDebuggerUrl) instances.push({ port, url: target.webSocketDebuggerUrl, title: target.title || `Antigravity (${port})` });
        } catch (e) { }
    }
    return instances;
}

async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP Timeout')); }, 3000);
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
        const timeoutId = setTimeout(() => { pendingCalls.delete(id); reject(new Error(`Timeout ${method}`)); }, 10000);
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

// --- V3 精準容器探測邏輯 ---
const DYNAMIC_UTILS_V3_JS = `
    const findHistoryContainerV3 = () => {
        const allMsgs = [...document.querySelectorAll('[class*="message"], [class*="chat-item"]')];
        const realMsgs = allMsgs.filter(m => !m.closest('[class*="welcome"], .jetski-logo, .getting-started'));
        
        if (realMsgs.length === 0) return document.querySelector('[data-lexical-editor="true"]')?.parentElement || document.body;
        
        // 尋找包含最多「真實訊息」的容器
        const containers = new Set();
        realMsgs.forEach(m => {
            let p = m.parentElement;
            for (let i = 0; i < 5; i++) {
                if (p) { containers.add(p); p = p.parentElement; }
            }
        });
        
        const best = [...containers].filter(c => c.tagName !== 'HTML' && c.tagName !== 'BODY').sort((a, b) => {
            const countA = realMsgs.filter(m => a.contains(m)).length;
            const countB = realMsgs.filter(m => b.contains(m)).length;
            if (countA !== countB) return countB - countA;
            return a.querySelectorAll('*').length - b.querySelectorAll('*').length; 
        })[0];
        
        return best || realMsgs[0].parentElement;
    };

    const findEditorContainerV3 = () => {
        const editor = document.querySelector('[data-lexical-editor="true"]');
        if (!editor) return null;
        
        let curr = editor;
        for (let i = 0; i < 15; i++) {
            if (!curr || curr === document.body) break;
            if (curr.getAttribute('role') === 'dialog' || curr.className.includes('chat') || curr.classList.contains('editor-instance')) {
                return curr;
            }
            curr = curr.parentElement;
        }
        return editor.parentElement;
    };
`;

async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        ${DYNAMIC_UTILS_V3_JS}
        const cascade = findHistoryContainerV3();
        if (!cascade) return { error: 'history container not found' };
        
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight
        };
        
        const clone = cascade.cloneNode(true);
        // 為複製出的 HTML 注入穩定 ID，以便前端 CSS 隔離
        clone.id = 'ag-chat-root';
        
        // --- 物理剪裁：直接從 DOM 中移除不需要的元素 ---
        const prune = (root) => {
            const selectors = [
                'footer', '.statusbar', '[class*="titlebar"]', '[class*="activitybar"]', 
                '[class*="sidebar"]', '[class*="auxiliarybar"]', '[class*="banner"]',
                '[class*="terminal"]', '.action-item', '[aria-label*="Ask anything"]',
                '[aria-label*="mention"]', '.monaco-alert', '.monaco-aria-container',
                'p[class*="pointer-events-none"]', '.antigravity-cockpit', 
                '.composer-container', '.chat-input-container'
            ];
            selectors.forEach(s => {
                root.querySelectorAll(s).forEach(el => el.remove());
            });

            // 針對 Split View：移除不含訊息的視圖 (但保護訊息列表)
            if (root.classList.contains('split-view-container')) {
                [...root.children].forEach(child => {
                    const hasRealMsgs = child.querySelectorAll('[class*="message"], [class*="chat-item"]').length > 0;
                    if (!hasRealMsgs) {
                        child.remove();
                    }
                });
            }
            
            // 文字匹配剪裁 (加強保護：絕對不可刪除訊息物件)
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
            const toRemove = [];
            let node;
            const noiseWords = ["Review Changes", "Files With Changes", "Planning", "Gemini 3 Flash", "Gemini 3 Pro", "Task", "Debugging Layout"];
            while (node = walker.nextNode()) {
                if (noiseWords.some(word => node.textContent.includes(word))) {
                    // 如果這個文字是在「訊息」內部，絕對不能刪除
                    if (node.parentElement.closest('[class*="message"], [class*="chat-item"]')) continue;
                    toRemove.push(node.parentElement);
                }
            }
            toRemove.forEach(el => {
                let curr = el;
                for(let i=0; i<4; i++) {
                    if (curr && curr !== root) {
                        const next = curr.parentElement;
                        if (curr.className.includes('view') || curr.className.includes('container')) {
                             curr.remove();
                             break;
                        }
                        if (i === 3) curr.remove(); 
                        curr = next;
                    }
                }
            });
        };
        prune(clone);

        const html = clone.outerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try { for (const rule of sheet.cssRules) rules.push(rule.cssText); } catch (e) { }
        }
        
        return {
            html: html.replace(/vscode-file:\\/\\/vscode-app\\/.*?\\/resources\\/app\\//g, '/vscode-resources/'),
            css: rules.join('\\n').replace(/vscode-file:\\/\\/vscode-app\\/.*?\\/resources\\/app\\//g, '/vscode-resources/'),
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
        ${DYNAMIC_UTILS_V3_JS}
        
        const dialog = findEditorContainerV3();
        if (!dialog) return { ok: false, error: "editor_container_not_found" };

        const waitForEditor = async (container) => {
            const editor = container.querySelector('[data-lexical-editor="true"][contenteditable="true"]') || 
                         container.querySelector('textarea, [contenteditable="true"]');
            if (editor) return editor;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    obs.disconnect();
                    reject(new Error("Timeout waiting for editor"));
                }, 5000);

                const obs = new MutationObserver(() => {
                    const e = container.querySelector('[data-lexical-editor="true"][contenteditable="true"]') || 
                            container.querySelector('textarea, [contenteditable="true"]');
                    if (e) {
                        clearTimeout(timeout);
                        obs.disconnect();
                        resolve(e);
                    }
                });
                obs.observe(container, { childList: true, subtree: true });
            });
        };

        try {
            const editor = await waitForEditor(dialog);
            if (!editor) return { ok: false, error: "editor_not_found" };

            // 檢查是否繁忙
            const cancel = document.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]');
            const stopBtn = document.querySelector('button svg.lucide-square, button svg.lucide-circle-stop')?.closest('button');
            const busyEl = cancel || stopBtn;
            if (!${force} && busyEl && busyEl.offsetParent !== null && busyEl.offsetHeight > 0) return { ok: false, reason: "busy" };

            editor.focus();
            document.execCommand?.("selectAll", false, null);
            document.execCommand?.("delete", false, null);
            
            try {
                document.execCommand?.("insertText", false, ${safeText});
            } catch {
                editor.textContent = ${safeText};
                editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${safeText} }));
            }

            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            
            const submit = document.querySelector("svg.lucide-arrow-right, .lucide-send, button[aria-label*='Send']")?.closest("button");
            if (submit && !submit.disabled) {
                submit.click();
                return { ok: true, method: "click" };
            }
            
            editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
            return { ok: true, method: "enter" };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true, awaitPromise: true, contextId: ctx.id });
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { ok: false, reason: "no_context" };
}

// --- Server Routes ---
async function createServer() {
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.json());
    app.use(cookieParser());
    app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'index_v3.html')));
    app.use(express.static(join(__dirname, 'public')));

    app.get('/app-state', (req, res) => res.json({ activePort: req.query.port || 9000, mode: 'Fast', model: 'V3-Experimental' }));

    app.post('/send', async (req, res) => {
        try {
            const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
            const result = await injectMessage(conn, req.body.message, req.query.force === 'true');
            res.json(result);
        } catch (e) { res.status(503).json({ error: e.message }); }
    });

    setInterval(async () => {
        for (const ws of wss.clients) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            try {
                const conn = await getOrConnectParams(ws.viewingPort || 9000);
                const snapshot = await captureSnapshot(conn);
                if (snapshot) ws.send(JSON.stringify({ type: 'snapshot_update', port: conn.port, title: 'V3 Monitoring', ...snapshot }));
            } catch (e) { }
        }
    }, POLL_INTERVAL);

    wss.on('connection', ws => { ws.viewingPort = 9000; ws.on('message', msg => { const d = JSON.parse(msg); if (d.type === 'switch_port') ws.viewingPort = parseInt(d.port); }); });

    server.listen(SERVER_PORT, '0.0.0.0', () => console.log(`🚀 [V3] Testing Server on http://localhost:${SERVER_PORT}`));
}

killPortProcess(SERVER_PORT).then(createServer);
