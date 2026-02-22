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
const activeModelText = document.getElementById('activeModelText');
const imageInput = document.getElementById('imageInput');
const attachBtn = document.getElementById('attachBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');
const mainTitle = document.getElementById('mainTitle');

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
let currentDisplayTitle = `Port ${currentViewingPort}`;
let cachedVLabel = 'V4.1';
let uiLock = false; // 全域互動鎖，防止多重視窗衝突

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
        if (data.model && data.model !== 'Unknown') {
            modelText.textContent = data.usage || data.model;
            if (activeModelText) activeModelText.textContent = data.model;
        }
        instanceText.textContent = `Port ${currentViewingPort}`;

        if (data.title && data.title !== 'Antigravity') {
            currentDisplayTitle = data.title;
        } else {
            currentDisplayTitle = `Port ${currentViewingPort}`;
        }

        if (mainTitle && mainTitle.textContent !== currentDisplayTitle) {
            mainTitle.textContent = currentDisplayTitle;
        }

        if (data.version) {
            const vMajorMinor = data.version.split('.').slice(0, 2).join('.');
            const vLabel = `V${vMajorMinor}`;
            cachedVLabel = vLabel;

            document.title = `${currentDisplayTitle} - Antigravity ${vLabel}`;
            if (messageInput) messageInput.placeholder = `Message ${vLabel}...`;

            const loadingMsg = document.querySelector('.loading-state p');
            if (loadingMsg) loadingMsg.textContent = `Waiting for ${vLabel} snapshot...`;

            if (statusText.textContent.includes('Live')) {
                statusText.textContent = `Live (${vLabel})`;
            }
        }
    } catch (e) {
        console.error('Sync failed', e);
        if (statusText) statusText.textContent = `❌ Sync Err: ${e.message.substring(0, 15)}`;
    }
}

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
                if (data.type === 'snapshot_update' && !userIsScrolling) {
                    if (data.port && data.port !== currentViewingPort) {
                        currentViewingPort = data.port;
                        localStorage.setItem('lastViewingPort', currentViewingPort);
                        if (instanceText) instanceText.textContent = `Port ${data.port}`;
                        currentDisplayTitle = `Port ${data.port}`;
                        if (mainTitle) mainTitle.textContent = currentDisplayTitle;
                        lastHash = '';
                    }
                    renderSnapshot(data);
                }
                if (data.type === 'force_port_switch' || data.type === 'switched') {
                    const newPort = data.port || data.newPort;
                    currentViewingPort = newPort;
                    localStorage.setItem('lastViewingPort', currentViewingPort);
                    if (instanceText) instanceText.textContent = `Port ${newPort}`;
                    currentDisplayTitle = `Port ${newPort}`;
                    if (mainTitle) mainTitle.textContent = currentDisplayTitle;
                    fetchAppState();
                    lastHash = '';
                }
            } catch (e) { console.error('[App] Msg Error', e); }
        };

        ws.onclose = (e) => {
            updateStatus(false);
            setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = (err) => {
            updateStatus(false);
        };
    } catch (e) {
        updateStatus(false);
    }
}

let lastScrollTime = 0;
if (chatContainer) {
    chatContainer.addEventListener('scroll', () => {
        userIsScrolling = true;
        clearTimeout(userScrollLockUntil);
        userScrollLockUntil = setTimeout(() => userIsScrolling = false, 1000);

        const now = Date.now();
        if (now - lastScrollTime > 50 && ws && ws.readyState === WebSocket.OPEN) {
            lastScrollTime = now;
            ws.send(JSON.stringify({ type: 'scroll_event', scrollTop: chatContainer.scrollTop }));
        }
    });
}

function updateStatus(connected) {
    if (statusDot) statusDot.className = connected ? 'status-dot connected' : 'status-dot disconnected';
    if (statusText) statusText.textContent = connected ? `Live (${cachedVLabel})` : 'Connecting...';
}

function renderSnapshot(data) {
    if (!data) return;
    if (data.error || !data.html) {
        if (!lastHash) {
            const isWrongWindow = data.error === 'wrong_window';
            chatContent.innerHTML = `
                <div class="error-state" style="padding: 20px; text-align: center; color: ${isWrongWindow ? '#f59e0b' : '#ef4444'};">
                    <div style="font-size: 32px; margin-bottom: 12px;">${isWrongWindow ? '💬' : '⚠️'}</div>
                    <div style="font-weight: bold; margin-bottom: 8px;">${isWrongWindow ? '請開啟 Antigravity 對話框' : (data.error || 'No content found')}</div>
                    ${isWrongWindow ? `
                    <div style="font-size: 13px; opacity: 0.8; line-height: 1.6;">
                        目前連線到的是 VS Code 主視窗，而不是 Antigravity 的對話框。<br><br>
                        <strong>請在電腦上：</strong> 打開 Antigravity 點擊 Chat 圖示
                    </div>` : ''}
                </div>
            `;
        }
        return;
    }

    if (data.hash === lastHash && !forceScrollToBottom) return;
    lastHash = data.hash;

    const scrollPos = chatContainer.scrollTop;
    const isNearBottom = chatContainer.scrollHeight - scrollPos - chatContainer.clientHeight < 120;

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
                position: static !important;
                width: auto !important;
                height: auto !important;
                min-height: 0px !important;
                max-width: 100% !important;
                border: none !important;
                box-shadow: none !important;
                transform: none !important;
                top: auto !important;
                left: auto !important;
            }
            #chatContent { background-color: #0f172a !important; }
            [style*="height: 9"], [style*="height: 8"], [style*="height: 7"] { height: auto !important; min-height: 0px !important; }
            [class*="quick-input"], [class*="command-palette"], [class*="toolbar"], [class*="banner"] { display: none !important; }
            #ag-chat-root img, #cascade img { max-width: 100% !important; height: auto !important; display: block !important; }
            #cascade pre, #cascade code { background-color: #1e293b !important; padding: 8px !important; color: #e2e8f0 !important; overflow-x: auto !important; display: block !important; }
            #cascade p, #cascade span, #cascade div { color: #ffffff !important; line-height: 1.6 !important; font-size: 15px !important; }
            #cascade a { color: #60a5fa !important; text-decoration: underline !important; }
        `;
        document.head.appendChild(style);
    }

    if (data.css && data.cssType !== 'cached') {
        let dynamicStyle = document.getElementById('snapshot-styles');
        if (!dynamicStyle) {
            dynamicStyle = document.createElement('style');
            dynamicStyle.id = 'snapshot-styles';
            document.head.appendChild(dynamicStyle);
        }
        dynamicStyle.textContent = data.css;
    }

    if (chatContent.innerHTML !== data.html) {
        chatContent.innerHTML = data.html;
    }

    if (forceScrollToBottom || isNearBottom) {
        scrollToBottom();
        forceScrollToBottom = false;
    }
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

async function sendMessage(retryCount = 0) {
    const msg = messageInput.value.trim();
    if (!msg && !pendingImage) return;
    if (isSending && retryCount === 0) return;

    if (retryCount === 0) {
        isSending = true;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<div class="loading-spinner"></div>';
        window.currentMsgId = 'm_' + Date.now().toString(36);
    }

    try {
        const payload = { message: msg, msgId: window.currentMsgId };
        if (pendingImage) payload.image = pendingImage;

        const res = await fetchWithAuth(`/send?port=${currentViewingPort}&_t=${Date.now()}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.ok || data.ignored) {
            messageInput.value = '';
            pendingImage = null;
            if (attachBtn) attachBtn.classList.remove('active');
            statusText.textContent = `Live (${cachedVLabel})`;
            isSending = false;
            sendBtn.disabled = false;
            sendBtn.innerHTML = 'Send';
            forceScrollToBottom = true;
            return;
        }

        if (data.reason === 'busy' && retryCount < 5) {
            setTimeout(() => sendMessage(retryCount + 1), 2000);
            return;
        }
        throw new Error(data.error || 'Send failed');
    } catch (e) {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = 'Send';
        statusText.textContent = `❌ ${e.message}`;
    }
}

// --- Modals ---
const MODELS = [
    "Gemini 3 Pro (High)", "Gemini 3 Pro (Low)", "Gemini 3 Flash",
    "Claude Sonnet 4.5", "Claude Sonnet 4.5 (Thinking)",
    "Claude Sonnet 4.6 (Thinking)", "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

function showModal(title, options, onSelect) {
    modalList.innerHTML = '';
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.className = 'modal-title';
    modalList.appendChild(titleEl);

    options.forEach(opt => {
        const div = document.createElement('div');
        div.textContent = opt.label || opt;
        div.className = 'modal-option';
        div.onclick = () => {
            onSelect(opt.value || opt);
            modalOverlay.style.display = 'none';
        };
        modalList.appendChild(div);
    });
    modalOverlay.style.display = 'flex';
    // 動畫只播放一次
    const panel = modalOverlay.querySelector('.modal-panel');
    if (panel) {
        panel.classList.remove('animate-in');
        void panel.offsetWidth;
        panel.classList.add('animate-in');
        panel.addEventListener('animationend', () => panel.classList.remove('animate-in'), { once: true });
    }
}

modalOverlay.addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') modalOverlay.style.display = 'none';
});

// --- Slot Manager (秒開：先抓資料再開窗) ---
let isSlotManagerOpening = false;
let lastSlotManagerCallTime = 0;
const openSlotManager = async () => {
    const now = Date.now();
    if (now - lastSlotManagerCallTime < 500 || isSlotManagerOpening) return;
    lastSlotManagerCallTime = now;
    isSlotManagerOpening = true;

    try {
        const res = await fetchWithAuth('/slots');
        const data = await res.json();

        const fragment = document.createDocumentFragment();
        const titleDiv = document.createElement('div');
        titleDiv.className = 'modal-title';
        titleDiv.textContent = 'Slot Manager / 工作槽位管理';
        fragment.appendChild(titleDiv);

        data.slots.forEach(slot => {
            const item = document.createElement('div');
            item.className = 'slot-item';
            item.innerHTML = `
                <div class="slot-info">
                    <div class="slot-port">PORT ${slot.port}${slot.port === currentViewingPort ? ' • VIEWING' : ''}</div>
                    <div class="slot-title">${slot.title || `Slot ${slot.port}`}</div>
                    <div class="slot-status ${slot.running ? 'status-running' : 'status-stopped'}">${slot.running ? 'RUNNING' : 'STOPPED'}</div>
                </div>
            `;
            const controls = document.createElement('div');
            controls.className = 'slot-controls';

            if (slot.running) {
                if (slot.port !== currentViewingPort) {
                    const switchBtn = document.createElement('button');
                    switchBtn.className = 'btn-s btn-switch';
                    switchBtn.textContent = 'Switch';
                    switchBtn.onclick = () => {
                        currentViewingPort = slot.port;
                        localStorage.setItem('lastViewingPort', slot.port);
                        instanceText.textContent = `Port ${slot.port}`;
                        currentDisplayTitle = `Port ${slot.port}`;
                        if (window.titleObserver) window.titleObserver.disconnect();
                        if (mainTitle) mainTitle.textContent = currentDisplayTitle;
                        if (window.titleObserver && mainTitle) window.titleObserver.observe(mainTitle, { childList: true, characterData: true, subtree: true });
                        lastHash = '';
                        chatContent.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Switching...</p></div>`;
                        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'switch_port', port: slot.port }));
                        fetchAppState(); loadSnapshot();
                        modalOverlay.style.display = 'none';
                    };
                    controls.appendChild(switchBtn);
                }
                const stopBtn = document.createElement('button');
                stopBtn.className = 'btn-s btn-stop';
                stopBtn.textContent = 'Stop';
                stopBtn.onclick = async () => {
                    stopBtn.disabled = true;
                    await fetchWithAuth('/stop-slot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: slot.port }) });
                    modalOverlay.style.display = 'none';
                    openSlotManager();
                };
                controls.appendChild(stopBtn);
            } else {
                const startBtn = document.createElement('button');
                startBtn.className = 'btn-s btn-start';
                startBtn.textContent = 'Start';
                startBtn.onclick = async () => {
                    startBtn.disabled = true;
                    await fetchWithAuth('/start-slot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port: slot.port }) });
                    modalOverlay.style.display = 'none';
                    openSlotManager();
                };
                controls.appendChild(startBtn);
            }
            item.appendChild(controls);
            fragment.appendChild(item);
        });

        const panicBtn = document.createElement('button');
        panicBtn.className = 'btn-kill-all';
        panicBtn.textContent = 'Panic: Kill All (清理記憶體)';
        panicBtn.onclick = async () => {
            if (confirm('Stop ALL?')) { await fetchWithAuth('/kill-all', { method: 'POST' }); modalOverlay.style.display = 'none'; openSlotManager(); }
        };
        fragment.appendChild(panicBtn);

        // 一次性寫入並顯示（秒開）
        modalList.innerHTML = '';
        modalList.appendChild(fragment);
        modalOverlay.style.display = 'flex';
        const panel = modalOverlay.querySelector('.modal-panel');
        if (panel) {
            panel.classList.remove('animate-in');
            void panel.offsetWidth;
            panel.classList.add('animate-in');
            panel.addEventListener('animationend', () => panel.classList.remove('animate-in'), { once: true });
        }
    } catch (e) {
        console.error('[UI] Slot error:', e);
    } finally {
        isSlotManagerOpening = false;
    }
};

// --- Model Selector (Robust) ---
let isModelSelectorOpening = false;
const openModelSelector = async () => {
    if (isModelSelectorOpening) return;
    isModelSelectorOpening = true;
    const oldStatus = statusText.textContent;
    statusText.textContent = '🔍 Scanning...';
    try {
        const res = await fetchWithAuth(`/available-models?port=${currentViewingPort}`);
        const data = await res.json();
        const handleSelect = async (val) => {
            statusText.textContent = `🚀 Switching...`;
            await fetchWithAuth(`/set-model?port=${currentViewingPort}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: val })
            });
            setTimeout(fetchAppState, 1000);
        };
        if (data.models && data.models.length > 0) showModal('Select Model (Detected)', data.models, handleSelect);
        else showModal('Select Model (Fallback)', MODELS, handleSelect);
    } catch (e) {
        showModal('Select Model (Fallback)', MODELS, (val) => {
            fetchWithAuth(`/set-model?port=${currentViewingPort}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: val })
            });
            setTimeout(fetchAppState, 1000);
        });
    } finally {
        statusText.textContent = oldStatus;
        isModelSelectorOpening = false;
    }
};

// --- Mode Selector (Robust) ---
let isModeSelectorOpening = false;
const openModeSelector = () => {
    if (isModeSelectorOpening) return;
    isModeSelectorOpening = true;
    showModal('Select Mode', ['Fast', 'Planning'], async (val) => {
        await fetchWithAuth(`/set-mode?port=${currentViewingPort}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: val })
        });
        setTimeout(fetchAppState, 1000);
        isModeSelectorOpening = false;
    });
    // If user clicks background, we must release lock
    const originalClose = modalOverlay.onclick;
    modalOverlay.onclick = (e) => {
        if (e.target.id === 'modalOverlay') {
            isModeSelectorOpening = false;
            modalOverlay.style.display = 'none';
            modalOverlay.onclick = originalClose;
        }
    };
};

// --- UI Binding & Start ---
if (sendBtn) sendBtn.onclick = () => sendMessage(0);
messageInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(0); } };
refreshBtn.onclick = () => { location.reload(); };
document.getElementById('scrollToBottom').onclick = () => { scrollToBottom(); forceScrollToBottom = true; };

if (newChatBtn) {
    newChatBtn.onclick = async () => {
        try {
            const res = await fetchWithAuth(`/new-chat?port=${currentViewingPort}`, { method: 'POST' });
            if ((await res.json()).success) { statusText.textContent = '🆕 New chat...'; setTimeout(() => { loadSnapshot(); fetchAppState(); }, 2000); }
        } catch (e) { }
    };
}

if (historyBtn) {
    historyBtn.onclick = async () => {
        try {
            const res = await fetchWithAuth(`/history?port=${currentViewingPort}`);
            const data = await res.json();
            if (data.success && data.items) renderHistoryModal(data.items);
        } catch (e) { }
    };
}

function renderHistoryModal(items) {
    modalList.innerHTML = '<div class="modal-title">History</div>';
    items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = `history-item ${item.active ? 'active' : ''}`;
        div.textContent = item.title || 'Untitled Chat';
        div.onclick = async () => {
            modalOverlay.style.display = 'none';
            chatContent.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><p>Loading...</p></div>`;
            await fetchWithAuth(`/select-chat?port=${currentViewingPort}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) });
            setTimeout(() => { loadSnapshot(); fetchAppState(); }, 1500);
        };
        modalList.appendChild(div);
    });
    modalOverlay.style.display = 'flex';
}

if (imageInput) {
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (attachBtn) attachBtn.classList.add('active');
        const reader = new FileReader();
        reader.onload = (ev) => { pendingImage = ev.target.result; statusText.textContent = '📷 Ready'; setTimeout(() => statusText.textContent = `Live (${cachedVLabel})`, 3000); };
        reader.readAsDataURL(file);
    });
}

if (mainTitle) {
    mainTitle.textContent = currentDisplayTitle;
    window.titleObserver = new MutationObserver(() => {
        if (mainTitle.textContent !== currentDisplayTitle) mainTitle.textContent = currentDisplayTitle;
    });
    window.titleObserver.observe(mainTitle, { childList: true, characterData: true, subtree: true });
}

window.openSlotManager = openSlotManager;
window.openModelSelector = openModelSelector;
window.openModeSelector = openModeSelector;

connectWebSocket();
