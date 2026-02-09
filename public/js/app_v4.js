// --- app_v4.js: V4.1 Stable Frontend Logic (Isolated) ---

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
    } catch (e) { console.error('Sync failed', e); }
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        updateStatus(true);
        ws.send(JSON.stringify({ type: 'switch_port', port: currentViewingPort }));
        fetchAppState();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'snapshot_update' && !userIsScrolling) {
            renderSnapshot(data);
        }
    };

    ws.onclose = () => {
        updateStatus(false);
        setTimeout(connectWebSocket, 2000);
    };

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
}

let cachedVLabel = 'V4.1'; // Initial fallback, will be updated by fetchAppState

function updateStatus(connected) {
    statusDot.className = connected ? 'status-dot connected' : 'status-dot disconnected';
    statusText.textContent = connected ? `Live (${cachedVLabel})` : 'Connecting...';
}

// Render Logic (V2 Style + CSS Fixes)
function renderSnapshot(data) {
    if (!data || !data.html) return;
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
            #ag-chat-root, #cascade, #cascade * { 
                background: transparent !important; 
                color: #ffffff !important; 
                font-family: 'Inter', 'Microsoft JhengHei', sans-serif !important; 
                -webkit-font-smoothing: antialiased !important;
                position: static !important; /* Force natural flow, kill absolute chaos */
                width: auto !important;
                height: auto !important;
                min-height: 0 !important;
                max-width: 100vw !important;
                border: none !important;
                box-shadow: none !important;
                transform: none !important;
            }
            #ag-chat-root, #cascade {
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
            }
            /* Global kill for UI elements that leak through */
            #cascade button, #cascade svg, #cascade input, #cascade textarea,
            #cascade [role="button"], #cascade [class*="toolbar"], #cascade [class*="menu"] {
                display: none !important;
            }
            #ag-chat-root p, #cascade p, #ag-chat-root span, #cascade span, #cascade div { 
                color: #ffffff !important; 
                opacity: 1 !important;
                line-height: 1.6 !important;
                font-size: 15px !important;
            }
            #ag-chat-root { margin-top: 0 !important; padding: 0 !important; }
            
            #ag-chat-root a, #cascade a { color: #60a5fa !important; font-weight: 600 !important; }
            ::-webkit-scrollbar { width: 6px !important; }
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
    if (isSending && retryCount === 0) return;
    const msg = messageInput.value.trim();
    if (!msg) return;

    if (retryCount === 0) {
        isSending = true;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<div class="loading-spinner"></div>';
        // Generate Idempotency Key
        window.currentMsgId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        console.log('[App] New Message ID:', window.currentMsgId);
    } else {
        sendBtn.innerHTML = `<span style="font-size:10px">Retry ${retryCount}/25</span>`;
        statusText.textContent = `⏳ Busy... (${retryCount}/25)`;
        console.log('[App] Retrying Message ID:', window.currentMsgId);
    }

    try {
        const res = await fetchWithAuth(`/send?port=${currentViewingPort}&_t=${Date.now()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, msgId: window.currentMsgId })
        });
        const data = await res.json();

        if (data.ok) {
            messageInput.value = '';
            statusText.textContent = 'Live (V4)';
            sendBtn.innerHTML = 'Send';
            sendBtn.disabled = false;
            isSending = false;
            forceScrollToBottom = true;
            // Quick refreshes
            setTimeout(() => fetchAppState(), 500);
            return;
        }

        // One-shot attempt (User Request: Do not retry)
        /*
        // Retry Logic Removed
        if ((data.reason === 'busy' || data.error === 'editor_not_found') && retryCount < 25) { ... } 
        */

        if (!data.ok) {
            console.warn('[App] Send failed:', data.error || data.reason);
            // Optimistic behavior: Don't alert if busy/editor_not_found as user assumes success
            // But let's keep status text updated
            statusText.textContent = `Push Failed: ${data.error || data.reason} `;
            // Intentionally NO alert and NO resetSendState immediately to let user see status
            // Actually, we must enable button again
            resetSendState();
        }
    } catch (e) {
        console.error(e);
        statusText.textContent = 'Network Error';
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
sendBtn.onclick = () => sendMessage(0);
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

// Start
connectWebSocket();
