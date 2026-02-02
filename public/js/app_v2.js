// --- app_v2.js: Robust testing frontend with retry logic ---
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const instanceText = document.getElementById('instanceText');
const statusText = document.getElementById('statusText');

let currentViewingPort = 9000;
let ws = null;
let isSending = false;

function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => {
        statusText.textContent = 'Live (V2)';
        statusText.style.color = '#10b981';
    };
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'snapshot_update') render(data);
    };
    ws.onclose = () => {
        statusText.textContent = 'Disconnected';
        statusText.style.color = '#ef4444';
        setTimeout(connect, 2000);
    };
}

function render(data) {
    if (data.html) chatContent.innerHTML = data.html;
    if (data.port) instanceText.textContent = `Port ${data.port}`;
}

async function sendMessage(retryCount = 0) {
    if (isSending && retryCount === 0) return;
    const msg = messageInput.value.trim();
    if (!msg) return;

    isSending = true;
    sendBtn.disabled = true;

    if (retryCount > 0) {
        sendBtn.innerHTML = `重試中 (${retryCount}/25)`;
        statusText.textContent = `⏳ 重試中 (${retryCount}/25)`;
    } else {
        sendBtn.textContent = '傳送中...';
    }

    try {
        const res = await fetch(`/send?port=${currentViewingPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        });
        const data = await res.json();

        if (data.ok) {
            messageInput.value = '';
            statusText.textContent = '✅ 已送出';
            isSending = false;
        } else {
            if (data.reason === 'busy' && retryCount < 25) {
                setTimeout(() => sendMessage(retryCount + 1), 2000);
            } else {
                statusText.textContent = `❌ ${data.error || data.reason}`;
                isSending = false;
            }
        }
    } catch (e) {
        if (retryCount < 25) {
            setTimeout(() => sendMessage(retryCount + 1), 2000);
        } else {
            statusText.textContent = '❌ 網路錯誤';
            isSending = false;
        }
    } finally {
        if (!isSending) {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
        }
    }
}

sendBtn.onclick = () => sendMessage(0);
connect();
console.log("[V2] App loaded. Connecting to:", location.host);
