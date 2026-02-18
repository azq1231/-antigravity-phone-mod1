
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3004');

ws.on('open', () => {
    console.log('Connected to WS on 3004');
    ws.send(JSON.stringify({ type: 'switch_port', port: 9001 }));
});

ws.on('message', (data) => {
    console.log('Received message:', data.toString().substring(0, 200));
    process.exit(0);
});

ws.on('error', (err) => {
    console.error('WS Error:', err.message);
    process.exit(1);
});

setTimeout(() => {
    console.log('Timeout');
    process.exit(1);
}, 5000);
