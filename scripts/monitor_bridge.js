
import WebSocket from 'ws';

async function monitor() {
    const ws = new WebSocket('ws://127.0.0.1:3000');
    console.log("[MONITOR] 已連接到伺服器，正在監控快照推送...");
    
    let lastHash = '';
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'snapshot') {
                const head = msg.data.html ? msg.data.html.substring(0, 50).replace(/\n/g, ' ') : 'NULL';
                const status = msg.data.hash === lastHash ? "⚠️ 相同 (Skipped)" : "✅ 更新";
                console.log(`[${new Date().toLocaleTimeString()}] Port: ${msg.port} | Len: ${msg.data.html?.length} | Hash: ${msg.data.hash} | ${status}`);
                console.log(` Snippet: ${head}...`);
                lastHash = msg.data.hash;
            } else if (msg.type === 'appState') {
                console.log(`[STATE] Model: ${msg.data.model} | Mode: ${msg.data.mode}`);
            }
        } catch (e) {}
    });

    ws.on('open', () => {
        //切換到 9000 進行監控
        ws.send(JSON.stringify({ type: 'switchPort', port: 9000 }));
    });

    // 監控 15 秒
    setTimeout(() => {
        console.log("[MONITOR] 監控結束。");
        process.exit(0);
    }, 15000);
}

monitor();
