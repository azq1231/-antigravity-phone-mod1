// --- app_v4.js: V4.1 Stable Frontend Logic (Isolated) ---

// --- Remote Logging to Server (Pro Debugging) ---
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function remoteLog(type, ...args) {
    if (typeof ws !== 'undefined' && ws && ws.readyState === 1) { // 1 = OPEN
        try {
            ws.send(JSON.stringify({ type: 'client_log', level: type, data: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }));
        } catch (e) { }
    }
    if (type === 'error') originalError(...args);
    else if (type === 'warn') originalWarn(...args);
    else originalLog(...args);
}
console.log = (...args) => remoteLog('log', ...args);
console.warn = (...args) => remoteLog('warn', ...args);
console.error = (...args) => remoteLog('error', ...args);


// Elements
const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const instanceText = document.getElementById('instanceText');
const modeText = document.getElementById('modeText');
const modelText = document.getElementById('modelText');
const imageInput = document.getElementById('imageInput');
const attachBtn = document.getElementById('attachBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');

// State
let ws = null;
let currentViewingPort = parseInt(localStorage.getItem('lastViewingPort')) || 9000;
let isSending = false;
let userIsScrolling = false;
let lastHash = '';
let forceScrollToBottom = false;
let userScrollLockUntil = 0;
let pingTimeout = null;
let pendingImage = null;

console.log('[DEBUG] imageInput element:', imageInput);
console.log('[DEBUG] attachBtn element:', attachBtn);
console.log('[DEBUG] sendBtn element:', sendBtn);

// Auth Helper
async function fetchWithAuth(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['ngrok-skip-browser-warning'] = 'true';
    const res = await fetch(url, options);
    return res;
}

// Sync App State (Mode, Model)
async function fetchAppState() {
    try {
        const res = await fetchWithAuth(`/app-state?port=${currentViewingPort}&_t=${Date.now()}`);
        const data = await res.json();
        if (data.mode && data.mode !== 'Unknown') modeText.textContent = data.mode;
        if (data.model && data.model !== 'Unknown') modelText.textContent = data.model;
        instanceText.textContent = `Port ${currentViewingPort}`;

        // Dynamic Version Injection (Single Source of Truth)
        if (data.version) {
            const vMajorMinor = data.version.split('.').slice(0, 2).join('.');
            const vLabel = `V${vMajorMinor}`;
            cachedVLabel = vLabel;

            document.title = `Antigravity ${vLabel} Stable`;
            const headerTitle = document.querySelector('.header h1');
            if (headerTitle) headerTitle.textContent = `Antigravity ${vLabel}`;

            if (messageInput) messageInput.placeholder = `Message ${vLabel}...`;

            const loadingMsg = document.querySelector('.loading-state p');
            if (loadingMsg) loadingMsg.textContent = `Waiting for ${vLabel} snapshot...`;

            // Only update status text if it already includes 'Live'
            if (statusText.textContent.includes('Live')) {
                statusText.textContent = `Live (${vLabel})`;
            }
        }
    } catch (e) {
        console.error('Sync failed', e);
        if (statusText) statusText.textContent = `❌ Sync Err: ${e.message.substring(0, 15)}`;
    }
}

// ... (in loadSnapshot)
async function loadSnapshot() {
    try {
        const res = await fetchWithAuth(`/snapshot?port=${currentViewingPort}&_t=${Date.now()}`);
        const data = await res.json();
        renderSnapshot(data);
    } catch (e) { }
}

// WebSocket Connection
function connectWebSocket() {
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        console.log(`[App] Connecting to ${protocol}//${host}`);

        ws = new WebSocket(`${protocol}//${host}`);

        ws.onopen = () => {
            console.log('[App] WS Connected');
            updateStatus(true);
            ws.send(JSON.stringify({ type: 'switch_port', port: currentViewingPort }));
            fetchAppState();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // Handle snapshot update
                if (data.type === 'snapshot_update' && !userIsScrolling) {
                    // Update current viewing port UI if server indicates a switch (Auto-Hunt)
                    if (data.port && data.port !== currentViewingPort) {
                        console.log(`[App] Server forced port switch to ${data.port}`);
                        currentViewingPort = data.port;
                        localStorage.setItem('lastViewingPort', currentViewingPort);
                        if (instanceText) instanceText.textContent = `Port ${data.port}`;
                        lastHash = ''; // Reset hash to force full re-render on port switch
                    }
                    renderSnapshot(data);
                }

                // Handle manual/force switch acknowledgment
                if (data.type === 'force_port_switch' || data.type === 'switched') {
                    const newPort = data.port || data.newPort;
                    console.log(`[App] Port switched to ${newPort}`);
                    currentViewingPort = newPort;
                    localStorage.setItem('lastViewingPort', currentViewingPort);
                    if (instanceText) instanceText.textContent = `Port ${newPort}`;
                    fetchAppState();
                    lastHash = '';
                }
            } catch (e) { console.error('[App] Msg Error', e); }
        };

        ws.onclose = (e) => {
            console.warn('[App] WS Closed', e.code);
            updateStatus(false);
            if (statusText) statusText.textContent = `Disconnected (${e.code})`;
            setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = (err) => {
            console.error('[App] WS Error', err);
            if (statusText) statusText.textContent = '❌ WS Err';
        };
    } catch (e) {
        if (statusText) statusText.textContent = '❌ WS Setup Err';
    }
}

// Scroll Sync (Client -> Server)
let lastScrollTime = 0;
chatContainer.addEventListener('scroll', () => {
    userIsScrolling = true;
    clearTimeout(userScrollLockUntil);
    userScrollLockUntil = setTimeout(() => userIsScrolling = false, 1000);

    const now = Date.now();
    if (now - lastScrollTime > 50 && ws && ws.readyState === WebSocket.OPEN) {
        lastScrollTime = now;
        ws.send(JSON.stringify({
            type: 'scroll_event',
            scrollTop: chatContainer.scrollTop
        }));
    }
});

let cachedVLabel = 'V4.1'; // Initial fallback, will be updated by fetchAppState

function updateStatus(connected) {
    statusDot.className = connected ? 'status-dot connected' : 'status-dot disconnected';
    statusText.textContent = connected ? `Live (${cachedVLabel})` : 'Connecting...';
}

// Render Logic (V2 Style + CSS Fixes)
function renderSnapshot(data) {
    if (!data) return;

    if (data.error || !data.html) {
        if (!lastHash) { // Only show error if we have nothing else to display
            const isWrongWindow = data.error === 'wrong_window';
            chatContent.innerHTML = `
                <div class="error-state" style="padding: 20px; text-align: center; color: ${isWrongWindow ? '#f59e0b' : '#ef4444'};">
                    <div style="font-size: 32px; margin-bottom: 12px;">${isWrongWindow ? '💬' : '⚠️'}</div>
                    <div style="font-weight: bold; margin-bottom: 8px;">${isWrongWindow ? '請開啟 Antigravity 對話框' : (data.error || 'No content found')}</div>
                    ${isWrongWindow ? `
                    <div style="font-size: 13px; opacity: 0.8; line-height: 1.6;">
                        目前連線到的是 VS Code 主視窗，<br>
                        而不是 Antigravity 的對話框。<br><br>
                        <strong>請在電腦上：</strong><br>
                        1. 打開 Antigravity<br>
                        2. 點擊左側 Chat 圖示<br>
                        3. 確保對話框是展開的
                    </div>` : `
                    <div style="font-size: 11px; margin-top: 10px; opacity: 0.6;">Try switching ports or opening the chat panel.</div>`}
                </div>
            `;
        }
        return;
    }

    // Re-enabled hash check for UI stability
    if (data.hash === lastHash && !forceScrollToBottom) return;
    lastHash = data.hash;

    const scrollPos = chatContainer.scrollTop;
    const isNearBottom = chatContainer.scrollHeight - scrollPos - chatContainer.clientHeight < 120;

    // Inject CSS Fixes (High Contrast)
    if (!document.getElementById('v4-styles')) {
        const style = document.createElement('style');
        style.id = 'v4-styles';
        style.textContent = `
            #chat-content-root, #ag-chat-root, #cascade, #conversation, #chat, #chat-area, 
            #ag-chat-root *, #cascade *, #conversation *, #chat *, #chat-area * { 
                background-color: transparent !important; 
                color: #ffffff !important; 
                fill: #ffffff !important;
                font-family: 'Inter', 'Microsoft JhengHei', sans-serif !important; 
                -webkit-font-smoothing: antialiased !important;
                position: static !important; /* Force natural flow */
                width: auto !important;
                height: auto !important;
                min-height: 0px !important; /* Kill massive height stretches */
                max-width: 100% !important;
                border: none !important;
                box-shadow: none !important;
                transform: none !important;
                top: auto !important;
                left: auto !important;
            }
            
            /* Root-level forced background if transparent fallback fails */
            #chatContent { background-color: #0f172a !important; }

            /* --- Layout Fixes --- */
            [style*="height: 9"], [style*="height: 8"], [style*="height: 7"], 
            [style*="min-height: 9"], [style*="min-height: 8"], [style*="min-height: 7"] {
                height: auto !important;
                min-height: 0px !important;
            }

            /* --- UI Element Cleanup (Hiding Noise) --- */
            /* Hide Command Palette / Quick Open overlays */
            [class*="quick-input"], [class*="command-palette"], [placeholder*="Open window"], 
            .monaco-inputbox, .quick-input-widget, 
            /* Hide toolbars and banners */
            [class*="toolbar"], [class*="banner"], [class*="footer"], [class*="menu"],
            #cascade button, #cascade input, #cascade textarea, #cascade [role="button"] {
                display: none !important;
            }

            /* --- CRITICAL: Contain Images and SVGs --- */
            #ag-chat-root img, #cascade img, #ag-chat-root svg, #cascade svg {
                max-width: 100% !important;
                height: auto !important;
                max-height: 70vh !important;
                object-fit: contain !important;
                display: block !important;
            }
            
            svg:not([class*="code-block-copy"]):not([width]):not([height]) {
                 width: 1.25em !important;
                 height: 1.25em !important;
            }

            #cascade pre, #cascade code {
                background-color: #1e293b !important;
                border: 1px solid #334155 !important;
                border-radius: 6px !important;
                padding: 8px !important;
                color: #e2e8f0 !important;
                overflow-x: auto !important;
                display: block !important;
            }

            #cascade p, #cascade span, #cascade div { 
                color: #ffffff !important; 
                opacity: 1 !important;
                line-height: 1.6 !important;
                font-size: 15px !important;
                background: transparent !important;
            }

            #cascade a { color: #60a5fa !important; font-weight: 600 !important; text-decoration: underline !important; }
            ::-webkit-scrollbar { width: 4px !important; }
            ::-webkit-scrollbar-thumb { background: #475569 !important; border-radius: 10px; }
            `;
        document.head.appendChild(style);
    }

    // Add CSS from snapshot
    let dynamicStyle = document.getElementById('snapshot-styles');
    if (!dynamicStyle) {
        dynamicStyle = document.createElement('style');
        dynamicStyle.id = 'snapshot-styles';
        document.head.appendChild(dynamicStyle);
    }
    dynamicStyle.textContent = data.css || '';

    chatContent.innerHTML = data.html;

    if (forceScrollToBottom || isNearBottom) {
        scrollToBottom();
        forceScrollToBottom = false;
    }
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

// Messaging Logic (V3 Robust Retry)
async function sendMessage(retryCount = 0) {
    console.log('[DEBUG] sendMessage called, retryCount:', retryCount, 'isSending:', isSending, 'pendingImage:', pendingImage ? 'exists' : 'null');

    if (isSending && retryCount === 0) {
        console.log('[DEBUG] Blocked: isSending is true');
        return;
    }
    const msg = messageInput.value.trim();
    console.log('[DEBUG] msg:', msg, 'pendingImage:', pendingImage ? 'exists' : 'null');

    if (!msg && !pendingImage) {
        console.log('[DEBUG] Blocked: no msg and no pendingImage');
        return;
    }

    if (retryCount === 0) {
        isSending = true;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<div class="loading-spinner"></div>';
        // Generate Idempotency Key
        window.currentMsgId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    } else {
        sendBtn.innerHTML = `<span style="font-size:10px">Retry ${retryCount}/25</span>`;
        statusText.textContent = `⏳ Busy... (${retryCount}/25)`;
    }

    try {
        if (pendingImage) statusText.textContent = '📤 Uploading Image...';
        else statusText.textContent = '🚀 Sending Message...';

        const payload = { message: msg, msgId: window.currentMsgId };
        if (pendingImage) payload.image = pendingImage;

        console.log('[DEBUG] Sending payload with image:', pendingImage ? 'yes' : 'no');

        const res = await fetchWithAuth(`/send?port=${currentViewingPort}&_t=${Date.now()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Server returned ${res.status}`);
        }

        const data = await res.json();

        if (data.ok) {
            messageInput.value = '';
            pendingImage = null; // Clear image
            if (attachBtn) attachBtn.classList.remove('active');

            statusText.textContent = `Live (${cachedVLabel})`;
            sendBtn.innerHTML = 'Send';
            sendBtn.disabled = false;
            isSending = false;
            forceScrollToBottom = true;
            setTimeout(() => fetchAppState(), 500);
            return;
        }
        throw new Error(data.error || 'Server processing failed');
    } catch (e) {
        console.warn('[App] Send failed:', e);
        statusText.textContent = `❌ ${e.message}`;
        if (!e.message.includes('Timeout')) {
            console.error('Send failed details:', e);
        }
        resetSendState();
    }
}

function resetSendState() {
    isSending = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = 'Send';
    statusText.textContent = 'Error';
}

// --- Modal & Actions ---
const MODELS = [
    "Gemini 3 Pro (High)", "Gemini 3 Pro (Low)", "Gemini 3 Flash",
    "Claude Sonnet 4.5", "Claude Sonnet 4.5 (Thinking)", "Claude Opus 4.5 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

function showModal(title, options, onSelect) {
    const list = document.getElementById('modalList');
    list.innerHTML = '';

    // Add Title
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.className = 'modal-title';
    list.appendChild(titleEl);

    options.forEach(opt => {
        const div = document.createElement('div');
        div.textContent = opt.label || opt;
        div.className = 'modal-option';
        div.onclick = () => {
            onSelect(opt.value || opt);
            document.getElementById('modalOverlay').style.display = 'none';
        };
        list.appendChild(div);
    });
    document.getElementById('modalOverlay').style.display = 'flex';
}

// Background close for modals
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') {
        document.getElementById('modalOverlay').style.display = 'none';
    }
});

// Interactive Handlers
document.querySelector('.setting-chip:nth-child(1)').onclick = () => { // Mode
    showModal('Select Mode', ['Fast', 'Planning'], async (val) => {
        await fetchWithAuth(`/set-mode?port=${currentViewingPort}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: val })
        });
        setTimeout(fetchAppState, 1000);
    });
};

document.querySelector('.setting-chip:nth-child(2)').onclick = () => { // Model
    showModal('Select Model', MODELS, async (val) => {
        await fetchWithAuth(`/set-model?port=${currentViewingPort}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: val })
        });
        setTimeout(fetchAppState, 1000);
    });
};

document.querySelector('.setting-chip:nth-child(3)').onclick = async () => { // Instance
    const res = await fetchWithAuth('/slots');
    const data = await res.json();

    const panel = document.getElementById('modalList');
    panel.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'modal-title';
    header.textContent = 'Slot Manager / 工作槽位管理';
    panel.appendChild(header);

    // Render Slots
    data.slots.forEach(slot => {
        const item = document.createElement('div');
        item.className = 'slot-item';

        // Info
        const info = document.createElement('div');
        info.className = 'slot-info';

        const portLabel = document.createElement('div');
        portLabel.className = 'slot-port';
        portLabel.textContent = `PORT ${slot.port}${slot.port === currentViewingPort ? ' • VIEWING' : ''} `;

        const title = document.createElement('div');
        title.className = 'slot-title';
        title.textContent = slot.title || `Slot ${slot.port} `;

        const status = document.createElement('div');
        status.className = `slot-status ${slot.running ? 'status-running' : 'status-stopped'}`;
        status.textContent = slot.running ? 'RUNNING' : 'STOPPED';

        info.appendChild(portLabel);
        info.appendChild(title);
        info.appendChild(status);
        item.appendChild(info);

        // Controls
        const controls = document.createElement('div');
        controls.className = 'slot-controls';

        if (slot.running) {
            if (slot.port !== currentViewingPort) {
                const switchBtn = document.createElement('button');
                switchBtn.className = 'btn-s btn-switch';
                switchBtn.textContent = 'Switch';
                switchBtn.onclick = () => {
                    const targetPort = slot.port;
                    currentViewingPort = targetPort;
                    localStorage.setItem('lastViewingPort', targetPort);

                    // Update UI state immediately
                    instanceText.textContent = `Port ${targetPort} `;
                    lastHash = ''; // Force render next frame

                    // Show loading state
                    chatContent.innerHTML = `
                        <div class="loading-state">
                            <div class="loading-spinner"></div>
                            <p>Switching to Port ${targetPort}...</p>
                        </div>
                    `;

                    // Notify Server
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'switch_port', port: targetPort }));
                    }

                    // Actions
                    fetchAppState();
                    loadSnapshot();
                    modalOverlay.style.display = 'none'; // Auto-close for better UX
                };
                controls.appendChild(switchBtn);
            }

            const stopBtn = document.createElement('button');
            stopBtn.className = 'btn-s btn-stop';
            stopBtn.textContent = 'Stop';
            stopBtn.onclick = async () => {
                stopBtn.disabled = true;
                stopBtn.textContent = '...';
                await fetchWithAuth('/stop-slot', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ port: slot.port })
                });
                setTimeout(() => document.querySelector('.setting-chip:nth-child(3)').click(), 1000);
            };
            controls.appendChild(stopBtn);
        } else {
            const startBtn = document.createElement('button');
            startBtn.className = 'btn-s btn-start';
            startBtn.textContent = 'Start';
            startBtn.onclick = async () => {
                startBtn.disabled = true;
                startBtn.textContent = '...';
                await fetchWithAuth('/start-slot', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ port: slot.port })
                });
                setTimeout(() => document.querySelector('.setting-chip:nth-child(3)').click(), 3000); // Give it time
            };
            controls.appendChild(startBtn);
        }

        item.appendChild(controls);
        panel.appendChild(item);
    });

    // Panic Button
    const panicBtn = document.createElement('button');
    panicBtn.className = 'btn-kill-all';
    panicBtn.textContent = 'Panic: Kill All Instances (清理記憶體)';
    panicBtn.onclick = async () => {
        if (!confirm('Are you sure you want to stop ALL instances?')) return;
        panicBtn.textContent = 'Killing...';
        await fetchWithAuth('/kill-all', { method: 'POST' });
        setTimeout(() => document.querySelector('.setting-chip:nth-child(3)').click(), 2000);
    };
    panel.appendChild(panicBtn);

    document.getElementById('modalOverlay').style.display = 'flex';
};

// --- Event Listeners ---
console.log('[DEBUG] sendBtn element:', sendBtn);
if (sendBtn) {
    sendBtn.onclick = () => {
        console.log('[DEBUG] sendBtn clicked!');
        sendMessage(0);
    };
} else {
    console.error('[DEBUG] sendBtn element NOT FOUND!');
}

messageInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(0); } };
refreshBtn.onclick = () => { location.reload(); };
chatContainer.onscroll = () => {
    userIsScrolling = true;
    clearTimeout(window.scrollTimer);
    window.scrollTimer = setTimeout(() => userIsScrolling = false, 2000);
};
document.getElementById('scrollToBottom').onclick = () => {
    scrollToBottom();
    forceScrollToBottom = true; // Temporary lock
};

// --- History & New Chat Logic ---
if (newChatBtn) {
    newChatBtn.onclick = async () => {
        newChatBtn.style.opacity = '0.5';
        try {
            const res = await fetchWithAuth(`/new-chat?port=${currentViewingPort}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                statusText.textContent = '🆕 Starting new chat...';
                setTimeout(() => {
                    loadSnapshot();
                    fetchAppState();
                }, 2000);
            }
        } catch (e) {
            console.error('New Chat failed', e);
        } finally {
            newChatBtn.style.opacity = '1';
        }
    };
}

if (historyBtn) {
    historyBtn.onclick = async () => {
        historyBtn.style.opacity = '0.5';
        try {
            const res = await fetchWithAuth(`/history?port=${currentViewingPort}`);
            const data = await res.json();
            if (data.success && data.items) {
                renderHistoryModal(data.items);
            } else {
                alert('No history found or failed to load.');
            }
        } catch (e) {
            console.error('History load failed', e);
        } finally {
            historyBtn.style.opacity = '1';
        }
    };
}

function renderHistoryModal(items) {
    modalList.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Chat History';
    modalList.appendChild(title);

    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `history-item ${item.active ? 'active' : ''}`;

        div.innerHTML = `
            <div class="history-item-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
            </div>
            <div class="history-item-content">
                <div class="history-item-title">${item.title || 'Untitled Chat'}</div>
            </div>
        `;

        div.onclick = async () => {
            modalOverlay.style.display = 'none';
            chatContent.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <p>Switching to chat...</p>
                </div>
            `;
            try {
                const res = await fetchWithAuth(`/select-chat?port=${currentViewingPort}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ index })
                });
                const result = await res.json();
                if (result.success) {
                    setTimeout(() => {
                        loadSnapshot();
                        fetchAppState();
                    }, 1500);
                }
            } catch (e) {
                console.error('Select chat failed', e);
                loadSnapshot();
            }
        };

        modalList.appendChild(div);
    });

    modalOverlay.style.display = 'flex';
}

// Image Upload Event Listener
if (imageInput) {
    imageInput.addEventListener('change', (e) => {
        console.log('[DEBUG] change event triggered!');
        const file = e.target.files[0];
        console.log('[DEBUG] selected file:', file);
        if (!file) return;

        // 立即顯示載入狀態
        if (attachBtn) {
            attachBtn.classList.add('active');
            attachBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        }
        statusText.textContent = '📷 Processing image...';

        const reader = new FileReader();
        reader.onload = (event) => {
            pendingImage = event.target.result;
            console.log('[DEBUG] Image loaded, size:', Math.round(pendingImage.length / 1024), 'KB');

            // 恢復圖示並顯示完成狀態
            if (attachBtn) {
                attachBtn.classList.add('active');
                attachBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
            }
            statusText.textContent = '📷 Image ready! Click Send to upload';

            // 3秒後恢復狀態文字
            setTimeout(() => {
                statusText.textContent = `Live (${cachedVLabel})`;
            }, 3000);
        };
        reader.onerror = () => {
            console.error('[App] Failed to read image file');
            if (attachBtn) attachBtn.classList.remove('active');
            statusText.textContent = '❌ Failed to read image';
            alert('Failed to read image file');
        };
        reader.readAsDataURL(file);
    });
} else {
    console.error('[DEBUG] imageInput element not found!');
}

// Start
connectWebSocket();
