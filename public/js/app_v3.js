// --- app_v3.js: Isolated frontend for V3 Layout testing ---
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusText = document.getElementById('statusText');

let currentViewingPort = 9000;
let ws = null;

let userIsTyping = false;
messageInput.onfocus = () => { userIsTyping = true; };
messageInput.onblur = () => { setTimeout(() => { userIsTyping = false; }, 500); };
messageInput.oninput = () => { userIsTyping = true; };

function connect() {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => { statusText.textContent = 'V3 Live'; statusText.style.color = '#a78bfa'; };
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'snapshot_update') {
            // Only update if not typing to prevent focus loss
            if (data.html && !userIsTyping) chatContent.innerHTML = data.html;

            // Inject workbench CSS to fix giant icons and broken layout
            if (data.css) {
                let style = document.getElementById('ag-dynamic-style');
                if (!style) {
                    style = document.createElement('style');
                    style.id = 'ag-dynamic-style';
                    document.head.appendChild(style);
                }
                style.textContent = data.css;
            }
        }
    };
    ws.onclose = () => setTimeout(connect, 2000);
}

async function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg) return;
    sendBtn.disabled = true;
    try {
        const res = await fetch(`/send?port=${currentViewingPort}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        if (data.ok) { messageInput.value = ''; statusText.textContent = '✅ Sent'; }
        else statusText.textContent = `❌ ${data.reason || 'Error'}`;
    } catch (e) { statusText.textContent = '❌ Error'; }
    finally { sendBtn.disabled = false; }
}

messageInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

sendBtn.onclick = sendMessage;
connect();
