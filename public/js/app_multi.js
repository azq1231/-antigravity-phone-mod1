// --- Elements ---
const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const stopBtn = document.getElementById('stopBtn');

const modeBtn = document.getElementById('modeBtn');
const modelBtn = document.getElementById('modelBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');
const modalTitle = document.getElementById('modalTitle');
const modeText = document.getElementById('modeText');
const modelText = document.getElementById('modelText');

// --- State ---
let autoRefreshEnabled = true;
let userIsScrolling = false;
let userIsTyping = false;
let userScrollLockUntil = 0; // Timestamp until which we respect user scroll
let lastScrollPosition = 0;
let ws = null;
let idleTimer = null;
let lastHash = '';
let currentMode = 'Fast';
let pingTimeout = null;
let pongReceived = false;
let forceScrollToBottom = false; // V4: Force scroll after send
let firstLoadPorts = new Set();  // V4: Track first load per port

// Load last viewed port from storage, default to 9000
let currentViewingPort = parseInt(localStorage.getItem('lastViewingPort')) || 9000;

// --- Auth Utilities ---
async function fetchWithAuth(url, options = {}) {
    // Add ngrok skip warning header to all requests
    if (!options.headers) options.headers = {};
    options.headers['ngrok-skip-browser-warning'] = 'true';

    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            console.log('[AUTH] Unauthorized, redirecting to login...');
            window.location.href = '/login.html';
            return new Promise(() => { }); // Halt execution
        }
        return res;
    } catch (e) {
        throw e;
    }
}
const USER_SCROLL_LOCK_DURATION = 3000; // 3 seconds of scroll protection

// --- Sync State (Desktop is Always Priority) ---
async function fetchAppState() {
    try {
        // In multi-session, we ask about the specific port we are watching
        const res = await fetchWithAuth(`/app-state?port=${currentViewingPort}`);
        const data = await res.json();

        // Mode Sync (Fast/Planning) - Desktop is source of truth
        if (data.mode && data.mode !== 'Unknown') {
            modeText.textContent = data.mode;
            modeBtn.classList.toggle('active', data.mode === 'Planning');
            currentMode = data.mode;
        }

        // Model Sync - Desktop is source of truth
        if (data.model && data.model !== 'Unknown') {
            modelText.textContent = data.model;
        }

        // Active Port Sync - In multi-session, we trust our local selection
        // Use title for better recognition if available
        const name = data.title || `Port ${currentViewingPort}`;
        instanceText.textContent = cleanInstanceName({ title: name, port: currentViewingPort });

        console.log(`[SYNC] State updated for Port ${currentViewingPort}:`, data);
    } catch (e) { console.error('[SYNC] Failed to sync state', e); }
}

function cleanInstanceName(data) {
    if (!data.title) return `Port ${data.port}`;

    // Remove "Antigravity - " prefix if it exists to make it cleaner on mobile
    let name = data.title.replace(/^Antigravity\s*-\s*/i, '');

    // Remove common suffixes like " - Walkthrough" or " - Settings"
    name = name.replace(/\s*-\s*(Walkthrough|Settings|Launchpad)$/i, '');

    // Limit length for mobile screen
    if (name.length > 20) name = name.substring(0, 17) + '...';
    return name;
}

// --- SSL Banner ---
const sslBanner = document.getElementById('sslBanner');

async function checkSslStatus() {
    // Disabled SSL warning as per user request
    if (sslBanner) sslBanner.style.display = 'none';
}

async function enableHttps() {
    const btn = document.getElementById('enableHttpsBtn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await fetchWithAuth('/generate-ssl', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            sslBanner.innerHTML = `
                <span>✅ ${data.message}</span>
                <button onclick="location.reload()">Reload After Restart</button>
            `;
            sslBanner.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
        } else {
            btn.textContent = 'Failed - Retry';
            btn.disabled = false;
        }
    } catch (e) {
        btn.textContent = 'Error - Retry';
        btn.disabled = false;
    }
}

function dismissSslBanner() {
    sslBanner.style.display = 'none';
    localStorage.setItem('sslBannerDismissed', 'true');
}

// Check SSL on load
checkSslStatus();
// --- Models ---
const MODELS = [
    "Gemini 3 Pro (High)",
    "Gemini 3 Pro (Low)",
    "Gemini 3 Flash",
    "Claude Sonnet 4.5",
    "Claude Sonnet 4.5 (Thinking)",
    "Claude Opus 4.5 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

// --- WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WS Connected');
        updateStatus(true);

        // CRITICAL: Immediately tell the server WHICH port we want to watch
        // This prevents the server from defaulting us back to 9000
        ws.send(JSON.stringify({
            type: 'switch_port',
            port: currentViewingPort
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error' && data.message === 'Unauthorized') {
            window.location.href = '/login.html';
            return;
        }

        // Handle pong response for health check
        if (data.type === 'pong') {
            pongReceived = true;
            if (pingTimeout) clearTimeout(pingTimeout);
            console.log('[HEALTH] Pong received, connection healthy');
            return;
        }

        // V2: Receive snapshot data directly via WebSocket broadcast
        if (data.type === 'snapshot_update' && autoRefreshEnabled && !userIsScrolling && !userIsTyping) {
            if (data.port) {
                currentViewingPort = data.port;
                const name = cleanInstanceName(data);
                instanceText.textContent = name;
            }
            renderSnapshot(data);
        }

        if (data.type === 'switched') {
            currentViewingPort = data.port;
            localStorage.setItem('lastViewingPort', currentViewingPort);
            instanceText.textContent = cleanInstanceName(data);
            fetchAppState(); // Sync mode/model for the new port
        }
    };


    ws.onclose = () => {
        console.log('WS Disconnected');
        updateStatus(false);
        setTimeout(connectWebSocket, 2000);
    };
}

function updateStatus(connected) {
    if (connected) {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Live';
    } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Connecting...';
    }
}

// --- Connection Health Check (for detecting zombie connections after screen off) ---
function checkConnectionHealth() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('[HEALTH] WebSocket not open, reconnecting...');
        updateStatus(false);
        connectWebSocket();
        return;
    }

    // Send a ping message and expect a pong within 3 seconds
    pongReceived = false;
    try {
        ws.send(JSON.stringify({ type: 'ping' }));
        console.log('[HEALTH] Ping sent, waiting for pong...');
    } catch (e) {
        console.log('[HEALTH] Failed to send ping, reconnecting...');
        ws.close();
        return;
    }

    pingTimeout = setTimeout(() => {
        if (!pongReceived) {
            console.log('[HEALTH] Ping timeout (3s), forcing reconnect...');
            updateStatus(false);
            ws.close(); // This will trigger onclose and auto-reconnect
        }
    }, 3000);
}

// --- Visibility API: Detect screen wake and verify connection ---
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log('[WAKE] Screen resumed, checking connection health...');
        checkConnectionHealth();
    }
});
// Renamed from loadSnapshot to renderSnapshot as it now takes data
function renderSnapshot(data, force = false) {
    if (!data) return;

    // If it's an error/waiting state, show the message even if no HTML
    if (data.error && data.error.includes('Waiting')) {
        chatContent.innerHTML = data.html || `<div class="loading-state"><p>${data.error}</p></div>`;
        return;
    }

    if (!data.html) return;

    // Skip if hash matches and not forced (Performance boost)
    if (!force && data.hash && data.hash === lastHash) {
        return;
    }
    if (data.hash) lastHash = data.hash;

    try {
        // Capture scroll state BEFORE updating content
        const scrollPos = chatContainer.scrollTop;
        const scrollHeight = chatContainer.scrollHeight;
        const clientHeight = chatContainer.clientHeight;
        const isNearBottom = scrollHeight - scrollPos - clientHeight < 120;
        const isUserScrollLocked = Date.now() < userScrollLockUntil;

        // --- UPDATE STATS ---
        if (data.stats) {
            const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
            const nodes = data.stats.nodes;
            const statsText = document.getElementById('statsText');
            if (statsText) statsText.textContent = `${nodes} Nodes · ${kbs}KB`;
        }

        // --- CSS INJECTION (Cached) ---
        let styleTag = document.getElementById('cdp-styles');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'cdp-styles';
            document.head.appendChild(styleTag);
        }

        // (Keeping existing dark mode overrides logic from data.css)
        const darkModeOverrides = '/* --- BASE SNAPSHOT CSS --- */\n' +
            (data.css || '') +
            '\n\n/* --- FORCE DARK MODE OVERRIDE --- */\n' +
            ':root {\n' +
            '    --bg-app: #0f172a;\n' +
            '    --text-main: #f8fafc;\n' +
            '    --text-muted: #94a3b8;\n' +
            '    --border-color: #334155;\n' +
            '}\n' +
            '\n' +
            '#ag-chat-root, #cascade {\n' +
            '    background-color: transparent !important;\n' +
            '    color: var(--text-main) !important;\n' +
            '    font-family: \'Inter\', system-ui, sans-serif !important;\n' +
            '    position: relative !important;\n' +
            '    height: auto !important;\n' +
            '    width: 100% !important;\n' +
            '    min-height: 100px !important;\n' +
            '}\n' +
            '\n' +
            '#ag-chat-root *, #cascade * {\n' +
            '    position: static !important;\n' +
            '}\n' +
            '\n' +
            '#ag-chat-root [contenteditable="true"], \n' +
            '#ag-chat-root [data-lexical-editor="true"],\n' +
            '#ag-chat-root textarea:not(#messageInput),\n' +
            '#cascade [contenteditable="true"], \n' +
            '#cascade [data-lexical-editor="true"],\n' +
            '#cascade textarea:not(#messageInput) {\n' +
            '    display: none !important;\n' +
            '}\n' +
            '\n' +
            '/* --- Force Split View Visibility --- */\n' +
            '#ag-chat-root .split-view-container,\n' +
            '#ag-chat-root .split-view-view,\n' +
            '#cascade .split-view-container,\n' +
            '#cascade .split-view-view {\n' +
            '    position: relative !important;\n' +
            '    display: block !important;\n' +
            '    height: auto !important;\n' +
            '    width: 100% !important;\n' +
            '    left: auto !important;\n' +
            '    top: auto !important;\n' +
            '    transform: none !important;\n' +
            '    opacity: 1 !important;\n' +
            '    visibility: visible !important;\n' +
            '}\n' +
            '\n' +
            '/* --- Hide Workbench Artifacts --- */\n' +
            '#ag-chat-root footer,\n' +
            '#ag-chat-root .statusbar,\n' +
            '#ag-chat-root [class*="titlebar"],\n' +
            '#ag-chat-root [class*="activitybar"],\n' +
            '#ag-chat-root [class*="sidebar"],\n' +
            '#ag-chat-root [class*="auxiliarybar"],\n' +
            '#ag-chat-root [class*="banner"],\n' +
            '#ag-chat-root [class*="terminal"],\n' +
            '#ag-chat-root .action-item,\n' +
            '#ag-chat-root .action-label,\n' +
            '#ag-chat-root [aria-label*="Ask anything"],\n' +
            '#ag-chat-root [aria-label*="mention"],\n' +
            '#ag-chat-root p[class*="pointer-events-none"],\n' +
            '#ag-chat-root .monaco-alert,\n' +
            '#ag-chat-root .monaco-aria-container,\n' +
            '#cascade footer,\n' +
            '#cascade .statusbar,\n' +
            '#cascade [class*="titlebar"],\n' +
            '#cascade [class*="activitybar"],\n' +
            '#cascade [class*="sidebar"],\n' +
            '#cascade [class*="auxiliarybar"],\n' +
            '#cascade [class*="banner"],\n' +
            '#cascade [class*="terminal"],\n' +
            '#cascade .action-item,\n' +
            '#cascade .action-label,\n' +
            '#cascade [aria-label*="Ask anything"],\n' +
            '#cascade [aria-label*="mention"],\n' +
            '#cascade p[class*="pointer-events-none"],\n' +
            '#cascade .monaco-alert,\n' +
            '#cascade .monaco-aria-container {\n' +
            '    display: none !important;\n' +
            '}\n' +
            '\n' +
            '/* 全局文字顏色與對比度強化 */\n' +
            '#chatContent *, #ag-snapshot-content *, #cascade * {\n' +
            '    color: #f8fafc !important; /* 純白藍文字 */\n' +
            '    background-color: transparent !important; \n' +
            '    border-color: rgba(255,255,255,0.1) !important;\n' +
            '    text-shadow: 0 0 1px rgba(0,0,0,0.5) !important;\n' +
            '}\n' +
            '\n' +
            '/* 確保代碼塊背景依然深色 */\n' +
            'pre, code, .monaco-editor-background {\n' +
            '    background-color: #1e293b !important;\n' +
            '    color: #f1f5f9 !important;\n' +
            '}\n' +
            '\n' +
            '#chatContent a, #ag-snapshot-content a {\n' +
            '    color: #60a5fa !important;\n' +
            '    text-decoration: underline !important;\n' +
            '}\n' +
            '\n' +
            '/* Fix Inline Code - Ultra-compact */\n' +
            ':not(pre) > code {\n' +
            '    padding: 0px 2px !important;\n' +
            '    border-radius: 2px !important;\n' +
            '    background-color: rgba(255, 255, 255, 0.1) !important;\n' +
            '    font-size: 0.82em !important;\n' +
            '    line-height: 1 !important;\n' +
            '    white-space: normal !important;\n' +
            '}\n' +
            '\n' +
            'pre, code, .monaco-editor-background, [class*="terminal"] {\n' +
            '    background-color: #1e293b !important;\n' +
            '    color: #e2e8f0 !important;\n' +
            '    font-family: \'JetBrains Mono\', monospace !important;\n' +
            '    border-radius: 3px;\n' +
            '    border: 1px solid #334155;\n' +
            '}\n' +
            '                \n' +
            '/* Multi-line Code Block - Minimal */\n' +
            'pre {\n' +
            '    position: relative !important;\n' +
            '    white-space: pre-wrap !important; \n' +
            '    word-break: break-word !important;\n' +
            '    padding: 4px 6px !important;\n' +
            '    margin: 2px 0 !important;\n' +
            '    display: block !important;\n' +
            '    width: 100% !important;\n' +
            '}\n' +
            '                \n' +
            'pre.has-copy-btn {\n' +
            '    padding-right: 28px !important;\n' +
            '}\n' +
            '                \n' +
            '/* Single-line Code Block - Minimal */\n' +
            'pre.single-line-pre {\n' +
            '    display: inline-block !important;\n' +
            '    width: auto !important;\n' +
            '    max-width: 100% !important;\n' +
            '    padding: 0px 4px !important;\n' +
            '    margin: 0px !important;\n' +
            '    vertical-align: middle !important;\n' +
            '    background-color: #1e293b !important;\n' +
            '    font-size: 0.85em !important;\n' +
            '}\n' +
            '                \n' +
            'pre.single-line-pre > code {\n' +
            '    display: inline !important;\n' +
            '    white-space: nowrap !important;\n' +
            '}\n' +
            '                \n' +
            'pre:not(.single-line-pre) > code {\n' +
            '    display: block !important;\n' +
            '    width: 100% !important;\n' +
            '    overflow-x: auto !important;\n' +
            '    background: transparent !important;\n' +
            '    border: none !important;\n' +
            '    padding: 0 !important;\n' +
            '    margin: 0 !important;\n' +
            '}\n' +
            '                \n' +
            '.mobile-copy-btn {\n' +
            '    position: absolute !important;\n' +
            '    top: 2px !important;\n' +
            '    right: 2px !important;\n' +
            '    background: rgba(30, 41, 59, 0.5) !important; /* Transparent bg */\n' +
            '    color: #94a3b8 !important;\n' +
            '    border: none !important;\n' +
            '    width: 24px !important; \n' +
            '    height: 24px !important;\n' +
            '    padding: 0 !important;\n' +
            '    cursor: pointer !important;\n' +
            '    display: flex !important;\n' +
            '    align-items: center !important;\n' +
            '    justify-content: center !important;\n' +
            '    border-radius: 4px !important;\n' +
            '    transition: all 0.2s ease !important;\n' +
            '    -webkit-tap-highlight-color: transparent !important;\n' +
            '    z-index: 10 !important;\n' +
            '    margin: 0 !important;\n' +
            '}\n' +
            '                \n' +
            '.mobile-copy-btn:hover,\n' +
            '.mobile-copy-btn:focus {\n' +
            '    background: rgba(59, 130, 246, 0.2) !important;\n' +
            '    color: #60a5fa !important;\n' +
            '}\n' +
            '                \n' +
            '.mobile-copy-btn svg {\n' +
            '    width: 16px !important;\n' +
            '    height: 16px !important;\n' +
            '    stroke: currentColor !important;\n' +
            '    stroke-width: 2 !important;\n' +
            '    fill: none !important;\n' +
            '}\n' +
            '                \n' +
            'blockquote {\n' +
            '    border-left: 3px solid #3b82f6 !important;\n' +
            '    background: rgba(59, 130, 246, 0.1) !important;\n' +
            '    color: #cbd5e1 !important;\n' +
            '    padding: 8px 12px !important;\n' +
            '    margin: 8px 0 !important;\n' +
            '}\n' +
            '\n' +
            'table {\n' +
            '    border-collapse: collapse !important;\n' +
            '    width: 100% !important;\n' +
            '    border: 1px solid #334155 !important;\n' +
            '}\n' +
            'th, td {\n' +
            '    border: 1px solid #334155 !important;\n' +
            '    padding: 8px !important;\n' +
            '    color: #e2e8f0 !important;\n' +
            '}\n' +
            '\n' +
            '::-webkit-scrollbar {\n' +
            '    width: 6px !important;\n' +
            '    height: 6px !important;\n' +
            '}\n' +
            '::-webkit-scrollbar-track {\n' +
            '    background: transparent !important;\n' +
            '}\n' +
            '::-webkit-scrollbar-thumb {\n' +
            '    background: #334155 !important;\n' +
            '    border-radius: 10px !important;\n' +
            '}\n' +
            '::-webkit-scrollbar-thumb:hover {\n' +
            '    background: #475569 !important;\n' +
            '}\n' +
            '                \n' +
            '[style*=\"background-color: rgb(255, 255, 255)\"],\n' +
            '[style*=\"background-color: white\"],\n' +
            '[style*=\"background: white\"],\n' +
            '[style*=\"background:white\"],\n' +
            '[style*=\"background-color:white\"] {\n' +
            '    background-color: transparent !important;\n' +
            '}';
        styleTag.textContent = darkModeOverrides + (data.css_extra || '');
        // --- RENDER HTML ---
        // V4: Add a hint at the top if there might be virtualized content above
        const historyHint = `<div style="text-align:center; padding:10px; font-size:11px; color:var(--text-muted); opacity:0.5; border-bottom:1px solid var(--border); margin-bottm:10px;">向上滑動電腦版可看更多歷史紀錄 / Scroll up on PC for more history</div>`;
        chatContent.innerHTML = historyHint + data.html;

        // --- POST-RENDER PROCESS ---
        addMobileCopyButtons();

        // Smart scroll behavior: respect user scroll, only auto-scroll when appropriate
        const isFirstLoad = !firstLoadPorts.has(currentViewingPort);
        if (isFirstLoad) firstLoadPorts.add(currentViewingPort);

        if (forceScrollToBottom || isFirstLoad) {
            scrollToBottom();
            forceScrollToBottom = false;
        } else if (isUserScrollLocked) {
            const scrollPercent = scrollHeight > 0 ? scrollPos / scrollHeight : 0;
            const newScrollPos = chatContainer.scrollHeight * scrollPercent;
            chatContainer.scrollTop = newScrollPos;
        } else if (isNearBottom || scrollPos === 0) {
            scrollToBottom();
        } else {
            chatContainer.scrollTop = scrollPos;
        }

    } catch (err) {
        console.error('Render error:', err);
    }
}

// Helper to manually trigger a snapshot fetch (used as fallback or for manual refresh)
async function loadSnapshot() {
    try {
        // Add spin animation to refresh button
        const icon = refreshBtn.querySelector('svg');
        if (icon) {
            icon.classList.remove('spin-anim');
            void icon.offsetWidth; // trigger reflow
            icon.classList.add('spin-anim');
        }

        const response = await fetchWithAuth(`/snapshot?port=${currentViewingPort}`);
        if (!response.ok) {
            if (response.status === 503) return;
            throw new Error('Failed to load');
        }

        const data = await response.json();
        renderSnapshot(data, true); // Force render since it was explicitly requested
    } catch (err) {
        console.error('Snapshot load error:', err);
    }
}


// --- Mobile Code Block Copy Functionality ---
function addMobileCopyButtons() {
    // Find all pre elements (code blocks) in the chat
    const codeBlocks = chatContent.querySelectorAll('pre');

    codeBlocks.forEach((pre, index) => {
        // Skip if already has our button
        if (pre.querySelector('.mobile-copy-btn')) return;

        // Get the code text
        const codeElement = pre.querySelector('code') || pre;
        const textToCopy = (codeElement.textContent || codeElement.innerText).trim();

        // Check if there's a newline character in the TRIMMED text
        // This ensures single-line blocks with trailing newlines don't get buttons
        const hasNewline = /\n/.test(textToCopy);

        // If it's a single line code block, don't add the copy button
        if (!hasNewline) {
            pre.classList.remove('has-copy-btn');
            pre.classList.add('single-line-pre');
            return;
        }

        // Add class for padding
        pre.classList.remove('single-line-pre');
        pre.classList.add('has-copy-btn');

        // Create the copy button (icon only)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'mobile-copy-btn';
        copyBtn.setAttribute('data-code-index', index);
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            `;

        // Add click handler for copy
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const success = await copyToClipboard(textToCopy);

            if (success) {
                // Visual feedback - show checkmark
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            `;

                // Reset after 2 seconds
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            } else {
                // Show X icon briefly on error
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
            `;
                setTimeout(() => {
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            }
        });

        // Insert button into pre element
        pre.appendChild(copyBtn);
    });
}

// --- Cross-platform Clipboard Copy ---
async function copyToClipboard(text) {
    // Method 1: Modern Clipboard API (works on HTTPS or localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('[COPY] Success via Clipboard API');
            return true;
        } catch (err) {
            console.warn('[COPY] Clipboard API failed:', err);
        }
    }

    // Method 2: Fallback using execCommand (works on HTTP, older browsers)
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;

        // Avoid scrolling to bottom on iOS
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        textArea.style.opacity = '0';

        document.body.appendChild(textArea);

        // iOS specific handling
        if (navigator.userAgent.match(/ipad|iphone/i)) {
            const range = document.createRange();
            range.selectNodeContents(textArea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textArea.setSelectionRange(0, text.length);
        } else {
            textArea.select();
        }

        const success = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (success) {
            console.log('[COPY] Success via execCommand fallback');
            return true;
        }
    } catch (err) {
        console.warn('[COPY] execCommand fallback failed:', err);
    }

    // Method 3: For Android WebView or restricted contexts
    // Show the text in a selectable modal if all else fails
    console.error('[COPY] All copy methods failed');
    return false;
}

function scrollToBottom() {
    chatContainer.scrollTo({
        top: chatContainer.scrollHeight,
        behavior: 'smooth'
    });
}

// --- State ---
let isSending = false;

// --- Inputs ---
async function sendMessage(retryCount = 0, originalHTML = null) {
    if (typeof retryCount !== 'number') retryCount = 0;

    if (isSending && retryCount === 0) return;

    const message = messageInput.value.trim();
    if (!message) return;

    if (retryCount === 0) isSending = true;
    const originalBtnHTML = originalHTML || sendBtn.innerHTML;

    try {
        sendBtn.disabled = true;
        if (retryCount === 0) {
            sendBtn.innerHTML = '<div class="loading-spinner-s"></div>';
            messageInput.blur();
        } else {
            // Updated UI: More descriptive than "Retrying"
            sendBtn.innerHTML = `<div style="font-size: 10px; line-height: 1.2;">AI 思考中...<br>(${retryCount}/25)</div>`;
        }
        sendBtn.style.opacity = '0.8';

        const res = await fetchWithAuth(`/send?port=${currentViewingPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        const data = await res.json();

        if (res.ok && data.ok) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            const wrapper = messageInput.closest('.input-wrapper');
            if (wrapper) wrapper.classList.remove('input-error');

            setTimeout(loadSnapshot, 100);
            setTimeout(loadSnapshot, 300);
            setTimeout(loadSnapshot, 1000);
            setTimeout(loadSnapshot, 3000);
            forceScrollToBottom = true;
            return true;
        }

        // Increased Retry Limit to 25 (approx 150 seconds total)
        const shouldRetry = (data?.reason === "busy" || data?.error === "editor_not_found" || data?.reason === "no_context") && retryCount < 25;
        if (shouldRetry) {
            // Log retry reason for debugging
            if (retryCount === 0) {
                if (data?.reason === "busy") {
                    console.log('[SEND] Antigravity 正在生成回應,自動重試中...');
                } else if (data?.error === "editor_not_found") {
                    console.log('[SEND] 找不到編輯器元素,自動重試中...');
                } else if (data?.reason === "no_context") {
                    console.log('[SEND] CDP 上下文暫時不可用,自動重試中...');
                }
            }

            // Exponential backoff, capping at 6 seconds
            const delay = Math.min(2000 * Math.pow(1.2, retryCount), 6000);
            await new Promise(r => setTimeout(r, delay));
            return await sendMessage(retryCount + 1, originalBtnHTML);
        }

        // OPTIMISTIC CLEAR: If we got a response but it's not retryable,
        // clear the input anyway (message likely sent despite error response)
        console.warn('[SEND] Non-retryable response, clearing input optimistically:', data);
        messageInput.value = '';
        messageInput.style.height = 'auto';

        throw new Error(data?.reason || data?.error || 'Send failed');

    } catch (e) {
        console.error('[SEND] Error:', e.message);

        // Show user-friendly error message based on error type
        let userMessage = '';
        if (e.message.includes('editor_not_found')) {
            userMessage = '⚠️ 找不到輸入框\n請確認 Antigravity 在對話頁面';
            loadSnapshot();
        } else if (e.message.includes('no_context')) {
            userMessage = '❌ 連線異常\n請重新整理頁面或重啟 Antigravity';
        } else if (e.message.includes('busy')) {
            userMessage = '⏳ Antigravity 忙碌中\n請稍後再試';
        } else if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
            userMessage = '🌐 網路連線問題\n請檢查 Tailscale 或 Wi-Fi 連線';
        }

        // Show error in UI
        const wrapper = messageInput.closest('.input-wrapper');
        if (wrapper) {
            wrapper.classList.add('input-error');
            setTimeout(() => wrapper.classList.remove('input-error'), 3000);

            // Display error message as tooltip or alert (optional)
            if (userMessage && retryCount === 0) {
                // Only show alert on first failure, not during retries
                console.error('[SEND] ' + userMessage.replace(/\n/g, ' '));
            }
        }

        return false;

    } finally {
        if (retryCount === 0) {
            isSending = false;
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalBtnHTML;
            sendBtn.style.opacity = '1';
        }
    }
}

function quickAction(text) {
    if (isSending) return;
    messageInput.value = text;
    messageInput.dispatchEvent(new Event('input'));
    sendMessage();
}
window.quickAction = quickAction;

// --- Event Listeners ---
sendBtn.addEventListener('click', sendMessage);

refreshBtn.addEventListener('click', () => {
    loadSnapshot();
    fetchAppState();
});

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('focus', () => {
    userIsTyping = true;
});

messageInput.addEventListener('blur', () => {
    // Delay resetting typing flag to allow for click events on send button
    setTimeout(() => { userIsTyping = false; }, 500);
});

messageInput.addEventListener('input', function () {
    userIsTyping = true;
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// --- Scroll Sync to Desktop ---
let scrollSyncTimeout = null;
let lastScrollSync = 0;
const SCROLL_SYNC_DEBOUNCE = 150; // ms between scroll syncs
let snapshotReloadPending = false;

async function syncScrollToDesktop() {
    const scrollPercent = chatContainer.scrollTop / (chatContainer.scrollHeight - chatContainer.clientHeight);
    try {
        await fetchWithAuth(`/remote-scroll?port=${currentViewingPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scrollPercent })
        });

        // After scrolling desktop, reload snapshot to get newly visible content
        // (Antigravity uses virtualized scrolling - only visible messages are in DOM)
        if (!snapshotReloadPending) {
            snapshotReloadPending = true;
            setTimeout(() => {
                loadSnapshot();
                snapshotReloadPending = false;
            }, 300);
        }
    } catch (e) {
        console.log('Scroll sync failed:', e.message);
    }
}

chatContainer.addEventListener('scroll', () => {
    userIsScrolling = true;
    // Set a lock to prevent auto-scroll jumping for a few seconds
    userScrollLockUntil = Date.now() + USER_SCROLL_LOCK_DURATION;
    clearTimeout(idleTimer);

    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 120;
    if (isNearBottom) {
        scrollToBottomBtn.classList.remove('show');
        // If user scrolled to bottom, clear the lock so auto-scroll works
        userScrollLockUntil = 0;
    } else {
        scrollToBottomBtn.classList.add('show');
    }

    // Debounced scroll sync to desktop
    const now = Date.now();
    if (now - lastScrollSync > SCROLL_SYNC_DEBOUNCE) {
        lastScrollSync = now;
        clearTimeout(scrollSyncTimeout);
        scrollSyncTimeout = setTimeout(syncScrollToDesktop, 100);
    }

    idleTimer = setTimeout(() => {
        userIsScrolling = false;
        autoRefreshEnabled = true;
    }, 5000);
});

scrollToBottomBtn.addEventListener('click', () => {
    userIsScrolling = false;
    userScrollLockUntil = 0; // Clear lock so auto-scroll works again
    scrollToBottom();
});

// (Duplicate quickAction removed)

// --- Stop Logic ---
stopBtn.addEventListener('click', async () => {
    stopBtn.style.opacity = '0.5';
    try {
        const res = await fetchWithAuth(`/stop?port=${currentViewingPort}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            // alert('Stopped');
        } else {
            // alert('Error: ' + data.error);
        }
    } catch (e) { }
    setTimeout(() => stopBtn.style.opacity = '1', 500);
});



// --- Settings Logic ---

function openModal(title, options, onSelect) {
    modalTitle.textContent = title;
    modalList.innerHTML = '';
    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'modal-option';
        div.textContent = opt;
        div.onclick = () => {
            onSelect(opt);
            closeModal();
        };
        modalList.appendChild(div);
    });
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
};

modeBtn.addEventListener('click', () => {
    openModal('Select Mode', ['Fast', 'Planning'], async (mode) => {
        modeText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth(`/set-mode?port=${currentViewingPort}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            const data = await res.json();
            if (data.success) {
                currentMode = mode;
                modeText.textContent = mode;
                modeBtn.classList.toggle('active', mode === 'Planning');
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modeText.textContent = currentMode;
            }
        } catch (e) {
            modeText.textContent = currentMode;
        }
    });
});

// --- Instance & Slot Management ---
const instanceBtn = document.getElementById('instanceBtn');
const instanceText = document.getElementById('instanceText');

instanceBtn.addEventListener('click', () => openSlotManager());

async function openSlotManager() {
    modalTitle.textContent = 'Slot Manager / 工作槽位管理';
    modalList.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div></div>';
    openModalUI();

    try {
        const res = await fetchWithAuth('/slots');
        const data = await res.json();
        renderSlots(data.slots);
    } catch (e) {
        modalList.innerHTML = `<div style="padding:20px; color:var(--error);">Failed to load slots: ${e.message}</div>`;
    }
}

function renderSlots(slots) {
    modalList.innerHTML = '';
    slots.forEach(slot => {
        const item = document.createElement('div');
        item.className = 'slot-item';

        const cleanTitle = (slot.title || '').replace(/^Antigravity\s*-\s*/i, '');
        const isCurrent = slot.port === currentViewingPort;

        item.innerHTML = `
            <div class="slot-info">
                <div class="slot-port">PORT ${slot.port} ${isCurrent ? '• VIEWING' : ''}</div>
                <div class="slot-title">${cleanTitle || 'Slot ' + slot.port}</div>
                <div class="slot-status ${slot.running ? 'status-running' : 'status-stopped'}">
                    ${slot.running ? 'Running' : 'Stopped'}
                </div>
            </div>
            <div class="slot-controls">
                ${slot.running
                ? `<button class="btn-s btn-switch" onclick="handleSlotAction('switch', ${slot.port})">Switch</button>
                       <button class="btn-s btn-stop" onclick="handleSlotAction('stop', ${slot.port})">Stop</button>`
                : `<button class="btn-s btn-start" onclick="handleSlotAction('start', ${slot.port})">Start</button>`
            }
            </div>
        `;
        modalList.appendChild(item);
    });

    const killAllBtn = document.createElement('button');
    killAllBtn.className = 'btn-kill-all';
    killAllBtn.textContent = 'Panic: Kill All Instances (清理記憶體)';
    killAllBtn.onclick = () => handleSlotAction('kill-all');
    modalList.appendChild(killAllBtn);
}

async function handleSlotAction(action, port) {
    console.log(`[SLOT] Action: ${action} on Port: ${port}`);

    if (action === 'switch') {
        instanceText.textContent = 'Switching...';

        // 1. Update local port immediately so commands are routed correctly
        currentViewingPort = port;
        localStorage.setItem('lastViewingPort', port);

        // V4: Reset first load state for this port so it scrolls to bottom once re-connected
        firstLoadPorts.delete(port);
        lastHash = '';
        chatContent.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); padding:40px; text-align:center;">
                <div class="loading-spinner" style="margin-bottom:20px;"></div>
                <h3>Switching to Port ${port}...</h3>
                <p>Establishing connection to Antigravity instance.</p>
            </div>
        `;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'switch_port', port }));
        }
        closeModal();
        return;
    }


    const endpoint = action === 'kill-all' ? '/instance/kill-all' : `/instance/${action}`;
    try {
        const res = await fetchWithAuth(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port })
        });
        const data = await res.json();
        if (data.success) {
            openSlotManager();
        } else {
            alert('Action failed: ' + data.error);
        }
    } catch (e) {
        alert('Action error: ' + e.message);
    }
}

window.handleSlotAction = handleSlotAction;

function openModalUI() {
    modalOverlay.classList.add('show');
}
// (Duplicate closeModal removed)


modelBtn.addEventListener('click', () => {
    openModal('Select Model', MODELS, async (model) => {
        const prev = modelText.textContent;
        modelText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth(`/set-model?port=${currentViewingPort}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            const data = await res.json();
            if (data.success) {
                modelText.textContent = model;
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modelText.textContent = prev;
            }
        } catch (e) {
            modelText.textContent = prev;
        }
    });
});

// --- Viewport / Keyboard Handling ---
// This fixes the issue where the keyboard hides the input or layout breaks
if (window.visualViewport) {
    function handleResize() {
        // Resize the body to match the visual viewport (screen minus keyboard)
        document.body.style.height = window.visualViewport.height + 'px';

        // Scroll to bottom if keyboard opened
        if (document.activeElement === messageInput) {
            setTimeout(scrollToBottom, 100);
        }
    }

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    handleResize(); // Init
} else {
    // Fallback for older browsers without visualViewport support
    window.addEventListener('resize', () => {
        document.body.style.height = window.innerHeight + 'px';
    });
    document.body.style.height = window.innerHeight + 'px'; // Init
}

// --- Remote Click Logic (Thinking/Thought) ---
chatContainer.addEventListener('click', async (e) => {
    // Strategy: Check if the clicked element OR its parent contains "Thought" or "Thinking" text.
    // This handles both opening (collapsed) and closing (expanded) states.

    // 1. Find the nearest container that might be the "Thought" block
    const target = e.target.closest('div, span, p, summary, button, details');
    if (!target) return;

    const text = target.innerText || '';

    // Check if this looks like a thought toggle (matches "Thought for Xs" or "Thinking" patterns)
    // Also match the header of expanded thoughts which may have more content
    const isThoughtToggle = /Thought|Thinking/i.test(text) && text.length < 500;

    if (isThoughtToggle) {
        // Visual feedback - briefly dim the clicked element
        target.style.opacity = '0.5';
        setTimeout(() => target.style.opacity = '1', 300);

        // Extract just the first line for matching (e.g., "Thought for 3s")
        const firstLine = text.split('\n')[0].trim();

        try {
            const response = await fetchWithAuth(`/remote-click?port=${currentViewingPort}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selector: target.tagName.toLowerCase(),
                    index: 0,  // Usually there's only one visible thought toggle
                    textContent: firstLine  // Use first line for more reliable matching
                })
            });

            // Reload snapshot multiple times to catch the UI change
            // Desktop animation takes time, so we poll a few times
            setTimeout(loadSnapshot, 400);   // Quick check
            setTimeout(loadSnapshot, 800);   // After animation starts
            setTimeout(loadSnapshot, 1500);  // After animation completes
        } catch (e) {
            console.error('Remote click failed:', e);
        }
    }
});

// --- Init ---
connectWebSocket();
// 立即同步及抓取畫面，解決 "Waiting for snapshot..." 延遲問題
fetchAppState().then(() => {
    loadSnapshot(); // 獲取狀態後立刻抓取第一次畫面
});
setInterval(fetchAppState, 5000);
