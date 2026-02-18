
import WebSocket from 'ws';
import fs from 'fs';

const ws = new WebSocket('ws://localhost:3004');

ws.on('open', () => {
    console.log('Connected to WS on 3004');
    ws.send(JSON.stringify({ type: 'switch_port', port: 9001 }));
});

ws.on('message', (data) => {
    const json = JSON.parse(data.toString());
    if (json.type === 'snapshot_update' && json.html) {
        fs.writeFileSync('last_ws_snapshot.html', json.html);
        console.log('Snapshot saved to last_ws_snapshot.html. Length:', json.html.length);
        console.log('Snapshot Port:', json.port);
        console.log('Snapshot Error:', json.error || 'None');
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('WS Error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('Timeout - No snapshot received');
    process.exit(1);
}, 10000);
