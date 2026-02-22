import net from 'net';
import http from 'http';

export function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

export function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
}

export function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

export async function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', (err) => {
            // EADDRINUSE = port 被佔用中
            resolve(err.code === 'EADDRINUSE');
        });
        server.once('listening', () => {
            // 能綁定代表 port 沒有被用
            server.close(() => resolve(false));
        });
        server.listen(port, '127.0.0.1');
    });
}

export function cleanText(text) {
    if (!text) return '';
    return text.trim().replace(/\n{2,}/g, '\n');
}
