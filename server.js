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
import { inspectUI } from './scripts/ui_inspector.js';
import { execSync } from 'child_process';
import { findAllInstances } from './core/cdp_manager.js';
import { spawnInstance, killInstance } from './core/instance_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000; // 1 second
const SERVER_PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';
// Note: hashString is defined later, so we'll initialize the token inside createServer or use a simple string for now.
let AUTH_TOKEN = 'ag_default_token';


let cdpConnection = null;
let activePort = 9000;
let activeTitle = 'Antigravity';
let lastSnapshot = null;
let lastSnapshotHash = null;
let isSwitching = false;

// Kill any existing process on the server port (prevents EADDRINUSE)
function killPortProcess(port) {
    try {
        if (process.platform === 'win32') {
            // Windows: Find PID using netstat and kill it
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
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        } else {
            // Linux/macOS: Use lsof and kill
            const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const pids = result.trim().split('\n').filter(p => p);
            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        }
        // Small delay to let the port be released
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
        // No process found on port - this is fine
        return Promise.resolve();
    }
}

// Get local IP address for mobile access
// Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters (172.x.x.x from WSL/Docker)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    name: name,
                    // Prioritize common home/office network ranges
                    priority: iface.address.startsWith('192.168.') ? 1 :
                        iface.address.startsWith('10.') ? 2 :
                            iface.address.startsWith('172.') ? 3 : 4
                });
            }
        }
    }

    // Sort by priority and return the best one
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Helper: HTTP GET JSON
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


// Connect to CDP
async function connectCDP(url) {
    // Determine port from URL for logging/tracking if needed, though mostly handled by caller
    // url format: ws://127.0.0.1:9000/...

    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    const pendingCalls = new Map(); // Track pending calls by ID
    const contexts = [];
    const CDP_CALL_TIMEOUT = 30000; // 30 seconds timeout

    // Single centralized message handler (fixes MaxListenersExceeded warning)
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Handle CDP method responses
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);

                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            // Handle execution context events
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const id = data.params.executionContextId;
                const idx = contexts.findIndex(c => c.id === id);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') {
                contexts.length = 0;
            }
        } catch (e) { }
    });

    // SAFETY FIX: Prevent unhandled 'error' events from crashing the process
    ws.on('error', (err) => {
        console.error('CDP WebSocket error:', err.message);
        // Clean up pending calls so they don't hang
        for (const [id, { reject, timeoutId }] of pendingCalls.entries()) {
            clearTimeout(timeoutId);
            reject(new Error('WebSocket Error: ' + err.message));
        }
        pendingCalls.clear();
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;

        // Setup timeout to prevent memory leaks from never-resolved calls
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });

        try {
            if (ws.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket is not open');
            }
            ws.send(JSON.stringify({ id, method, params }));
        } catch (e) {
            clearTimeout(timeoutId);
            pendingCalls.delete(id);
            reject(e);
        }
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts, url };
}

// Capture chat snapshot
async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        // 智慧型對話容器偵測 (精確定位訊息流)
        const findChatContainer = () => {
            // 1. 優先找原本的 cascade
            const cascade = document.getElementById('cascade');
            if (cascade) return cascade;
            
            // 2. 搜尋具備『訊息列表』特徵的容器 (ID 包含 cascade 且具有捲軸)
            const cascadeLike = document.querySelector('div[id*="cascade"][class*="overflow"]');
            if (cascadeLike) return cascadeLike;

            // 3. 搜尋主內容區 (排除側邊欄)
            const main = document.querySelector('main') || document.querySelector('[role="main"]');
            if (main) return main;

            // 4. 最後手段：尋找可見的捲軸容器
            return document.querySelector('.overflow-y-auto') || document.body;
        };

        const target = findChatContainer();
        if (!target) return { error: 'No container found' };
        
        const targetStyles = window.getComputedStyle(target);
        
        // Find the main scrollable container
        const scrollContainer = target.querySelector('.overflow-y-auto, [data-scroll-area]') || target;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };
        
        // Clone to modify it without affecting the original
        const clone = target.cloneNode(true);
        
        // 統一識別標籤，確保前端 CSS 永遠抓得到
        clone.id = 'ag-snapshot-content';
        
        // Remove the input box / chat window (last direct child div containing contenteditable)
        const inputs = clone.querySelectorAll('[contenteditable="true"], textarea, button[type="submit"], [role="textbox"]');
        inputs.forEach(el => {
            const container = el.closest('div[id*="cascade"] > div') || el.parentElement;
            if (container && container !== clone) container.remove();
        });
        
        const html = clone.outerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    rules.push(rule.cssText);
                }
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');
        
        return {
            html: html,
            css: allCSS,
            backgroundColor: targetStyles.backgroundColor,
            color: targetStyles.color,
            fontFamily: targetStyles.fontFamily,
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
            // console.log(`Trying context ${ctx.id} (${ctx.name || ctx.origin})...`);
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });

            if (result.exceptionDetails) {
                // console.log(`Context ${ctx.id} exception:`, result.exceptionDetails);
                continue;
            }

            if (result.result && result.result.value) {
                const val = result.result.value;
                if (val.error) {
                    // console.log(`Context ${ctx.id} script error:`, val.error);
                    // if (val.debug) console.log(`   Debug info:`, JSON.stringify(val.debug));
                } else {
                    return val;
                }
            }
        } catch (e) {
            console.log(`Context ${ctx.id} connection error:`, e.message);
        }
    }

    return null;
}

// Inject message into Antigravity
async function injectMessage(cdp, text) {
    // Use JSON.stringify for robust escaping (handles ", \, newlines, backticks, unicode, etc.)
    const safeText = JSON.stringify(text);

    const EXPRESSION = `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };

        // 強化版編輯器偵測邏輯 - 限制在 #cascade 內 (防止誤輸入到終端機)
        const findEditor = () => {
            const root = document.getElementById('cascade') || document;
            
            // 1. 優先尋找原本的 Lexical 編輯器
            const lexicalEditors = [...root.querySelectorAll('[data-lexical-editor="true"][contenteditable="true"]')]
                .filter(el => el.offsetParent !== null);
            if (lexicalEditors.length > 0) return lexicalEditors.at(-1);

            // 2. 備援：尋找任何可見的 contenteditable 區域
            const allContentEditable = [...root.querySelectorAll('[contenteditable="true"]')]
                .filter(el => el.offsetParent !== null && el.innerText.length < 5000);
            if (allContentEditable.length > 0) return allContentEditable.at(-1);

            // 3. 備援：尋找 textarea
            const textareas = [...root.querySelectorAll('textarea')]
                .filter(el => el.offsetParent !== null);
            if (textareas.length > 0) return textareas.at(-1);

            return null;
        };

        const editor = findEditor();
        if (!editor) return { ok:false, error:"editor_not_found", debug: { html: document.body.innerHTML.substring(0, 500) } };

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

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        // 強化版發送按鈕偵測
        const findSubmitBtn = () => {
            // 1. 尋找常見的發送圖標按鈕
            const selectors = [
                'button svg.lucide-arrow-right',
                'button svg.lucide-send',
                'button[type="submit"]',
                '[aria-label*="Send"]',
                '[data-testid="send-button"]'
            ];
            for (const s of selectors) {
                const btn = document.querySelector(s)?.closest('button') || document.querySelector(s);
                if (btn && btn.offsetParent !== null && !btn.disabled) return btn;
            }
            
            // 2. 尋找包含「Send」字樣的按鈕
            const allBtns = [...document.querySelectorAll('button')];
            return allBtns.find(b => b.innerText.toLowerCase().includes('send') && b.offsetParent !== null && !b.disabled);
        };

        const submit = findSubmitBtn();
        if (submit) {
            submit.click();
            return { ok:true, method:"click_submit" };
        }

        // Submit button not found, but text is inserted - trigger Enter key
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter", keyCode: 13, which: 13 }));
        editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true, key:"Enter", code:"Enter", keyCode: 13, which: 13 }));
        
        return { ok:true, method:"enter_keypress" };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.result && result.result.value) {
                return result.result.value;
            }
        } catch (e) { }
    }

    return { ok: false, reason: "no_context" };
}

// Set functionality mode (Fast vs Planning)
async function setMode(cdp, mode) {
    if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };

    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the current mode indicator.
            // It will have text 'Fast' or 'Planning'.
            // It might not be a <button>, could be a <div> with cursor-pointer.
            
            // 1. Get all elements with text 'Fast' or 'Planning'
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                // Must have single text node child to avoid parents
                if (el.children.length > 0) return false;
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });

            // 2. Find the one that looks interactive (cursor-pointer)
            // Traverse up from text node to find clickable container
            let modeBtn = null;
            
            for (const el of candidates) {
                let current = el;
                // Go up max 4 levels
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

            // Check if already set
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };

            // 3. Click to open menu
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 4. Find the dialog
            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            
            // Fallback: Just look for any new visible container if role=dialog is missing
            if (!visibleDialog) {
                // Maybe it's not role=dialog? Look for a popover-like div
                 visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText.includes('${mode}') &&
                               !d.innerText.includes('Files With Changes'); // Anti-context menu
                    });
            }

            if (!visibleDialog) return { error: 'Dropdown not opened or options not visible' };

            // 5. Click the option
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${mode}'
            );

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }
            
            return { error: 'Mode option text not found in dialog. Dialog text: ' + visibleDialog.innerText.substring(0, 50) };

        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Stop Generation
async function stopGeneration(cdp) {
    const EXP = `(async () => {
        // Look for the cancel button
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            cancel.click();
            return { success: true };
        }
        
        // Fallback: Look for a square icon in the send button area
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) {
            stopBtn.click();
            return { success: true, method: 'fallback_square' };
        }

        return { error: 'No active generation found to stop' };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Click Element (Remote)
async function clickElement(cdp, { selector, index, textContent }) {
    const EXP = `(async () => {
        try {
            // Strategy: Find all elements matching the selector
            // If textContent is provided, filter by that too for safety
            let elements = Array.from(document.querySelectorAll('${selector}'));
            
            if ('${textContent}') {
                elements = elements.filter(el => el.textContent.includes('${textContent}'));
            }

            const target = elements[${index}];

            if (target) {
                target.click();
                // Also try clicking the parent if the target is just a label
                // target.parentElement?.click(); 
                return { success: true };
            }
            
            return { error: 'Element not found at index ${index}' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Click failed in all contexts' };
}

// Remote scroll - sync phone scroll to desktop
async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    // Try to scroll the chat container in Antigravity
    const EXPRESSION = `(async () => {
        try {
            // Find the main scrollable chat container
            const scrollables = [...document.querySelectorAll('#cascade [class*="scroll"], #cascade [style*="overflow"]')]
                .filter(el => el.scrollHeight > el.clientHeight);
            
            // Also check for the main chat area
            const chatArea = document.querySelector('#cascade .overflow-y-auto, #cascade [data-scroll-area]');
            if (chatArea) scrollables.unshift(chatArea);
            
            if (scrollables.length === 0) {
                // Fallback: scroll the main cascade element
                const cascade = document.querySelector('#cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            // Use percentage-based scrolling for better sync
            if (${scrollPercent} !== undefined) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed in all contexts' };
}

// Set AI Model
async function setModel(cdp, modelName) {
    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the specific model we want to click.
            // But first we must find the Open Menu button.
            
            // 1. Find the model selector button (currently displaying some model)
            // It will usually contain a model name like "Gemini" or "Claude" and have a chevron.
            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model"];
            
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                if (el.children.length > 0) return false; // Text nodes only
                const txt = el.textContent;
                return KNOWN_KEYWORDS.some(k => txt.includes(k));
            });

            // Find clickable parent
            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                        // Must also likely contain the chevron to be the selector, not just a label
                        if (current.querySelector('svg.lucide-chevron-up') || current.innerText.includes('Model')) {
                            modelBtn = current;
                            break;
                        }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }

            if (!modelBtn) return { error: 'Model selector button not found' };

            // 2. Click to open
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 3. Find the dialog/dropdown
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div'))
                .find(d => {
                    const style = window.getComputedStyle(d);
                    return d.offsetHeight > 0 && 
                           (style.position === 'absolute' || style.position === 'fixed') && 
                           d.innerText.includes('${modelName}') && 
                           !d.innerText.includes('Files With Changes');
                });

            if (!visibleDialog) return { error: 'Model list not opened' };

            // 4. Select specific model inside the dialog
            // Search deep for the specific text
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            
            // Try exact match first
            let target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${modelName}'
            );
            
            // Try partial/inclusive match
            if (!target) {
                 target = allDialogEls.find(el => 
                    el.children.length === 0 && el.textContent.includes('${modelName}')
                );
            }

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }

            return { error: 'Model "${modelName}" not found in list. Visible: ' + visibleDialog.innerText.substring(0, 100) };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Get App State (Mode & Model)
async function getAppState(cdp) {
    const EXP = `(async () => {
        try {
            const state = { mode: 'Unknown', model: 'Unknown' };
            
            // 1. Get Mode (Fast/Planning)
            // Strategy: Find the clickable mode button which contains either "Fast" or "Planning"
            // It's usually a button or div with cursor:pointer containing the mode text
            const allEls = Array.from(document.querySelectorAll('*'));
            
            // Find elements that are likely mode buttons
            for (const el of allEls) {
                if (el.children.length > 0) continue;
                const text = (el.innerText || '').trim();
                if (text !== 'Fast' && text !== 'Planning') continue;
                
                // Check if this or a parent is clickable (the actual mode selector)
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                        state.mode = text;
                        break;
                    }
                    current = current.parentElement;
                }
                if (state.mode !== 'Unknown') break;
            }
            
            // Fallback: Just look for visible text
            if (state.mode === 'Unknown') {
                const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
                if (textNodes.some(el => el.innerText.trim() === 'Planning')) state.mode = 'Planning';
                else if (textNodes.some(el => el.innerText.trim() === 'Fast')) state.mode = 'Fast';
            }

            // 2. Get Model
            // Strategy: Look for button containing a known model keyword
            const KNOWN_MODELS = ["Gemini", "Claude", "GPT"];
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            const modelEl = textNodes.find(el => {
                const txt = el.innerText;
                // Avoids "Select Model" placeholder if possible, but usually a model is selected
                return KNOWN_MODELS.some(k => txt.includes(k)) && 
                       // Check if it's near a chevron (likely values in the header)
                       el.closest('button')?.querySelector('svg.lucide-chevron-up');
            });
            
            if (modelEl) {
                state.model = modelEl.innerText.trim();
            }
            
            return state;
        } catch(e) { return { error: e.toString() }; }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Simple hash function
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// Check if a request is from the same Wi-Fi (internal network)
function isLocalRequest(req) {
    // 1. Check for proxy headers (Cloudflare, ngrok, etc.)
    // If these exist, the request is coming via an external tunnel/proxy
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) {
        return false;
    }

    // 2. Check the remote IP address
    const ip = req.ip || req.socket.remoteAddress || '';

    // Standard local/private IPv4 and IPv6 ranges
    return ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
        ip.startsWith('172.2') || ip.startsWith('172.3') ||
        ip.startsWith('::ffff:192.168.') ||
        ip.startsWith('::ffff:10.');
}

// Initialized at top level
isSwitching = false; // Lock to prevent poll loop from interfering during switch

async function initCDP(targetPort = null) {
    // Strategy: If targetPort is specified, we MUST connect to it or fail.
    // If no targetPort, we look for any available instance (fallback behavior for startup).

    console.log(`🔍 [Init] Target: ${targetPort || 'Auto-Discover'}`);

    let instances = [];

    // Retry finding instances (give it a moment if just launched)
    for (let attempt = 1; attempt <= 3; attempt++) {
        instances = await findAllInstances();
        // If we have a specific target, check if it's in the list
        if (targetPort) {
            const found = instances.find(i => i.port === targetPort);
            if (found) break; // Found our target!
        } else if (instances.length > 0) {
            break; // Found at least one instance for auto-discover
        }

        if (attempt < 3) {
            // console.log(`   Attempt ${attempt} empty/missing target. Retrying in 500ms...`);
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Log what we found for debugging
    // console.log('   Available Ports:', instances.map(i => i.port).join(', '));

    let target = null;

    if (targetPort) {
        target = instances.find(i => i.port === targetPort);
        if (!target) {
            // CRITICAL CHANGE: Do NOT fallback if user specifically requested a port.
            // Throwing error here prevents the "silent revert" to 9000.
            const msg = `Target port ${targetPort} not found or has no active chat window.`;
            console.error(`❌ ${msg}`);
            throw new Error(msg);
        }
    } else {
        // Startup / Auto-recovery mode: Default to first available
        if (instances.length > 0) target = instances[0];
    }

    if (!target) {
        throw new Error(`No Antigravity instances found. Is it running with --remote-debugging-port?`);
    }

    console.log(`✅ Connecting to Antigravity on port ${target.port}...`);

    // Set switching lock
    isSwitching = true;

    try {
        // Close existing connection only if we are actually switching or it's dead
        if (cdpConnection && cdpConnection.ws) {
            // Remove listeners to prevent "close" event from triggering anything elsewhere if needed
            // But main cleanup is fine.
            try { cdpConnection.ws.close(); } catch (e) { }
        }

        // Connect using the first available target URL if exists
        const connectionUrl = target.url || (target.targets && target.targets[0] ? target.targets[0].url : null);
        if (!connectionUrl) throw new Error("No target URL found for instance");

        cdpConnection = await connectCDP(connectionUrl);

        // Update active port and title ONLY after success
        activePort = target.port;
        activeTitle = target.title;

        // Force refresh caches
        lastSnapshot = null;
        lastSnapshotHash = null;

        console.log(`✅ Connected! Found ${cdpConnection.contexts.length} execution contexts\n`);
        return true;
    } catch (e) {
        console.error(`❌ Connection failed: ${e.message}`);
        // Only reset activePort if we were trying to switch and failed entirely
        // If we were recovering, keep trying
        throw e;
    } finally {
        // Release lock
        isSwitching = false;
    }
}

// Background polling
async function startPolling(wss) {
    let lastErrorLog = 0;

    // We keep polling the currently connected instance
    const poll = async () => {
        // If we are in the middle of switching, DON'T interfere!
        if (isSwitching) {
            // console.log('⏳ Polling paused (switching)...');
            setTimeout(poll, 1000);
            return;
        }

        // Auto-reconnect logic
        if (!cdpConnection || (cdpConnection.ws && cdpConnection.ws.readyState !== WebSocket.OPEN)) {
            console.log('🔄 CDP connection lost. Scanning for instances...');
            try {
                // IMPORTANT: Always try to reconnect to the `activePort` we intended to be on.
                // If activePort is null, it means we have no target yet (startup).
                await initCDP(activePort);
            } catch (err) {
                // console.log('   Retrying in 2s...');
            }
            setTimeout(poll, 2000);
            return;
        }

        // Double check: Are we actually connected to the RIGHTS port?
        // If user switched activePort but CDP is still old, forcing a reconnect might be needed,
        // but initCDP already handles connection replacement. 
        // We just ensure we don't accidentally drift.

        try {
            const snapshot = await captureSnapshot(cdpConnection);

            // LOGIC FIX: Even if snapshot has error, we might need to send it 
            // if we are stuck on a stale screen from a previous instance.
            // We verify by checking if the hash changed (even for error states).

            let payload = null;

            if (snapshot && !snapshot.error) {
                payload = snapshot;
            } else {
                // Construct a visual error state for the phone
                // instead of suppressing it.
                payload = {
                    html: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#64748b;text-align:center;padding:20px;">
                            <div style="font-size:24px;margin-bottom:10px;">⚠️</div>
                            <div style="font-weight:500;margin-bottom:5px;">Waiting for Antigravity...</div>
                            <div style="font-size:12px;opacity:0.8;">${snapshot?.error || 'No active chat found (Port ' + activePort + ')'}</div>
                            <div style="font-size:12px;margin-top:20px;opacity:0.6;">Please open a chat window on your computer.</div>
                           </div>`,
                    css: '',
                    error: snapshot?.error,
                    timestamp: new Date().toISOString()
                };
            }

            const hash = hashString(payload.html + (payload.error || ''));

            // Only update if content changed
            if (hash !== lastSnapshotHash) {
                lastSnapshot = payload; // Save even if it's an error frame
                lastSnapshotHash = hash;

                // Broadcast to all connected clients
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'snapshot_update',
                            port: activePort,
                            title: activeTitle,
                            timestamp: new Date().toISOString()
                        }));
                    }
                });

                console.log(`📸 Snapshot updated (hash: ${hash}) ${payload.error ? '[Error State]' : ''}`);
            }

            // Still log warning for server admin
            if (snapshot?.error) {
                const now = Date.now();
                if (!lastErrorLog || now - lastErrorLog > 10000) {
                    console.warn(`⚠️  Snapshot issue: ${snapshot.error}`);
                    lastErrorLog = now;
                }
            }

        } catch (err) {
            console.error('Poll error:', err.message);
        }

        setTimeout(poll, POLL_INTERVAL);
    };

    poll();
}

// Create Express app
async function createServer() {
    const app = express();

    // Check for SSL certificates
    const keyPath = join(__dirname, 'certs', 'server.key');
    const certPath = join(__dirname, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    let server;
    let httpsServer = null;

    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        httpsServer = https.createServer(sslOptions, app);
        server = httpsServer;
    } else {
        server = http.createServer(app);
    }

    const wss = new WebSocketServer({ server });

    // Initialize Auth Token (wait for hashString to be available)
    AUTH_TOKEN = hashString(APP_PASSWORD + 'antigravity_salt');

    app.use(compression());
    app.use(express.json());
    app.use(cookieParser('antigravity_secret_key_1337'));

    // Simplified CORS + Ngrok Bypass Middleware
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning');
        res.setHeader('ngrok-skip-browser-warning', 'true');

        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });

    // Auth Middleware
    app.use((req, res, next) => {
        const publicPaths = ['/login', '/login.html', '/favicon.ico'];
        if (publicPaths.includes(req.path) || req.path.startsWith('/css/')) {
            return next();
        }

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            return next();
        }

        // Magic Link / QR Code Auto-Login
        if (req.query.key === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            // Remove the key from the URL by redirecting to the base path
            return res.redirect('/');
        }

        const token = req.signedCookies[AUTH_COOKIE_NAME];
        if (token === AUTH_TOKEN) {
            return next();
        }

        // If it's an API request, return 401, otherwise redirect to login
        if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/snapshot') || req.path.startsWith('/send')) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login.html');
        }
    });

    app.use(express.static(join(__dirname, 'public')));

    // Login endpoint
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE_NAME);
        res.json({ success: true });
    });

    // Get current snapshot
    app.get('/snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(lastSnapshot);
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            cdpConnected: cdpConnection?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: hasSSL
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = join(__dirname, 'certs', 'server.key');
        const certPath = join(__dirname, 'certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: hasSSL,
            certsExist: certsExist,
            message: hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            const { execSync } = await import('child_process');
            execSync('node generate_ssl.js', { cwd: __dirname, stdio: 'pipe' });
            res.json({
                success: true,
                message: 'SSL certificates generated! Restart the server to enable HTTPS.'
            });
        } catch (e) {
            res.status(500).json({
                success: false,
                error: e.message
            });
        }
    });

    // Debug UI Endpoint (Privacy Fix: Removed console.log of UI tree)
    app.get('/debug-ui', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
        const uiTree = await inspectUI(cdpConnection);
        res.type('json').send(uiTree);
    });

    // Set Mode
    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(cdpConnection, mode);
        res.json(result);
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(cdpConnection, model);
        res.json(result);
    });

    // Stop Generation
    app.post('/stop', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(cdpConnection);
        res.json(result);
    });

    // Send message
    app.post('/send', async (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!cdpConnection) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const result = await injectMessage(cdpConnection, message);

        res.json({
            success: result.ok !== false,
            method: result.method || 'attempted',
            details: result
        });
    });

    // --- Slot & Instance Management ---
    app.get('/slots', async (req, res) => {
        try {
            const instances = await findAllInstances();
            const slots = PORTS.map(port => {
                const inst = instances.find(i => i.port === port);
                return { port, running: !!inst, title: inst ? inst.title : `Slot ${port}` };
            });
            res.json({ slots });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/instance/start', async (req, res) => {
        try {
            const { port } = req.body;
            const result = await spawnInstance(port);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/instance/stop', async (req, res) => {
        try {
            const { port } = req.body;
            const result = await killInstance(port);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/instance/kill-all', async (req, res) => {
        try {
            for (const port of PORTS) {
                await killInstance(port);
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Diagnostic Monitor Page
    app.get('/debug', (req, res) => {
        try {
            const monitorPath = join(__dirname, 'scripts', 'send_monitor.html');
            if (fs.existsSync(monitorPath)) {
                res.sendFile(monitorPath);
            } else {
                res.status(404).send('Monitor file not found in scripts/send_monitor.html');
            }
        } catch (e) {
            res.status(500).send('Error loading monitor: ' + e.message);
        }
    });

    // WebSocket connection with Auth check
    wss.on('connection', (ws, req) => {
        // Parse cookies from headers
        const rawCookies = req.headers.cookie || '';
        const parsedCookies = {};
        rawCookies.split(';').forEach(c => {
            const [k, v] = c.trim().split('=');
            if (k && v) {
                try {
                    parsedCookies[k] = decodeURIComponent(v);
                } catch (e) {
                    parsedCookies[k] = v;
                }
            }
        });

        // Verify signed cookie manually
        const signedToken = parsedCookies[AUTH_COOKIE_NAME];
        let isAuthenticated = false;

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            isAuthenticated = true;
        } else if (signedToken) {
            const token = cookieParser.signedCookie(signedToken, 'antigravity_secret_key_1337');
            if (token === AUTH_TOKEN) {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated) {
            console.log('🚫 Unauthorized WebSocket connection attempt');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            setTimeout(() => ws.close(), 100);
            return;
        }

        console.log('📱 Client connected (Authenticated)');

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'switch_port') {
                    const port = parseInt(msg.port);
                    console.log(`📡 Client requested switch to Port ${port}`);

                    try {
                        await initCDP(port);
                        // Notify success
                        ws.send(JSON.stringify({
                            type: 'port_switched',
                            port: activePort,
                            success: true
                        }));
                    } catch (e) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: `Switch failed: ${e.message}`
                        }));
                    }
                }
            } catch (e) {
                console.error('WS Message Error:', e.message);
            }
        });

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return { server, wss, app, hasSSL };
}

// Main
async function main() {
    try {
        await initCDP();
    } catch (err) {
        console.warn(`⚠️  Initial CDP discovery failed: ${err.message}`);
        console.log('💡 Start Antigravity with --remote-debugging-port=9000 to connect.');
    }

    try {
        const { server, wss, app, hasSSL } = await createServer();

        // Start background polling (it will now handle reconnections)
        startPolling(wss);

        // Remote Click
        app.post('/remote-click', async (req, res) => {
            const { selector, index, textContent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await clickElement(cdpConnection, { selector, index, textContent });
            res.json(result);
        });

        // Remote Scroll - sync phone scroll to desktop
        app.post('/remote-scroll', async (req, res) => {
            const { scrollTop, scrollPercent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await remoteScroll(cdpConnection, { scrollTop, scrollPercent });
            res.json(result);
        });

        // Get App State
        app.get('/app-state', async (req, res) => {
            if (!cdpConnection) return res.json({ mode: 'Unknown', model: 'Unknown', activePort });
            const result = await getAppState(cdpConnection);
            result.activePort = activePort;
            result.title = activeTitle;
            res.json(result);
        });

        // List active instances
        app.get('/instances', async (req, res) => {
            const list = await findAllInstances();
            res.json({
                instances: list,
                activePort: activePort
            });
        });

        // Switch Instance
        app.post('/switch-instance', async (req, res) => {
            const { port } = req.body;
            if (!port) return res.status(400).json({ error: 'Port required' });

            try {
                // Broadcast "Switching..." state to clients for immediate feedback
                // (Optional but good UX)
                console.log(`Attempting to switch CDP instance to port ${port}...`);
                await initCDP(parseInt(port));
                res.json({ success: true, activePort });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // Kill any existing process on the port before starting
        await killPortProcess(SERVER_PORT);

        // Start server
        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        server.listen(SERVER_PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on ${protocol}://${localIP}:${SERVER_PORT}`);
            if (hasSSL) {
                console.log(`💡 First time on phone? Accept the security warning to proceed.`);
            }
        });

        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            wss.close(() => {
                console.log('   WebSocket server closed');
            });
            server.close(() => {
                console.log('   HTTP server closed');
            });
            if (cdpConnection?.ws) {
                cdpConnection.ws.close();
                console.log('   CDP connection closed');
            }
            setTimeout(() => process.exit(0), 1000);
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
