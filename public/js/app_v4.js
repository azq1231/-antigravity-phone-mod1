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
            
            /* --- CRITICAL: Contain Images and SVGs --- */
            img, svg {
                max-width: 100% !important;
                height: auto !important;
                max-height: 80vh !important; /* Prevent giant vertical scaling */
                object-fit: contain !important;
            }
            
            /* Specific fix for small icons expanding */
            svg:not([class*="code-block-copy"]):not([width]):not([height]) {
                 width: 1.25em !important;
                 height: 1.25em !important;
            }

            #ag-chat-root, #cascade {
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
            }
                /* Global kill for UI elements that leak through */
                #cascade button, #cascade svg:not(.copy-icon):not([viewBox]), #cascade input, #cascade textarea,
                #cascade [role="button"], #cascade [class*="toolbar"], #cascade [class*="menu"],
                #cascade [class*="banner"], #cascade footer {
                    display: none !important;
                }
                
                /* Ensure buttons are REALLY gone */
                button { display: none !important; }

                #cascade pre, #cascade code {
                    background: #0f172a !important; /* Force deep slate for code */
                    border: 1px solid #1e293b !important;
                    border-radius: 4px !important;
                    padding: 4px 8px !important;
                    color: inherit !important; /* Preserve token colors */
                }
                #ag-chat-root :not([class*="mtk"]):not([style*="color"]) p, 
                #cascade :not([class*="mtk"]):not([style*="color"]) p,
                #ag-chat-root :not([class*="mtk"]):not([style*="color"]) span,
                #cascade :not([class*="mtk"]):not([style*="color"]) span,
                #cascade :not([class*="mtk"]):not([style*="color"]) div { 
                    color: #ffffff !important; 
                    opacity: 1 !important;
                    line-height: 1.6 !important;
                    font-size: 15px !important;
                }
                /* Explicitly allow tokens and links to keep their colors */
                #cascade [class*="mtk"], #cascade [style*="color"], #cascade a {
                    color: inherit !important;
                }
                #ag-chat-root a, #cascade a { color: #60a5fa !important; font-weight: 600 !important; text-decoration: underline !important; }
                ::-webkit-scrollbar { width: 4px !important; }
                ::-webkit-scrollbar-thumb { background: #334155 !important; border-radius: 10px; }
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
