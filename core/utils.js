import { exec } from 'child_process';
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
        exec(`netstat -ano | findstr LISTENING | findstr :${port}`, (err, stdout) => {
            if (err || !stdout) return resolve(false);
            const lines = stdout.split('\n');
            const match = lines.some(line => {
                const parts = line.trim().split(/\s+/);
                const localAddr = parts[1] || '';
                return localAddr.endsWith(`:${port}`);
            });
            resolve(match);
        });
    });
}

export function cleanText(text) {
    if (!text) return '';
    return text.trim().replace(/\n{2,}/g, '\n');
}
