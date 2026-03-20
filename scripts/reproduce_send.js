
import http from 'http';

async function reproduce() {
    const payload = JSON.stringify({
        message: "Reproduction test message",
        msgId: "repro_" + Date.now(),
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3004,
        path: '/send?port=9000',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    console.log('[REPRO] Sending test request...');
    const start = Date.now();
    
    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            const duration = Date.now() - start;
            console.log(`[REPRO] Status: ${res.statusCode}, Time: ${duration}ms`);
            console.log(`[REPRO] Response: ${body}`);
            process.exit(0);
        });
    });

    req.on('error', (e) => {
        console.error(`[REPRO] Error: ${e.message}`);
        process.exit(1);
    });

    req.write(payload);
    req.end();
}

reproduce();
