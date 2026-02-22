import { execSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { openSync, existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function reboot() {
    console.log('--- [Reboot System] Starting Server Restart Sequence ---');

    try {
        console.log('1. Terminating existing Node.js instances...');
        const myPid = process.pid;

        // Windows taskkill, exclude current PID
        execSync(`taskkill /F /IM node.exe /FI "PID ne ${myPid}"`, { stdio: 'inherit' });
    } catch (e) {
        console.log('   (No other node processes found or kill failed, proceeding...)');
    }

    console.log('2. Launching server_v4.js in background...');
    const serverPath = join(__dirname, '..', 'server_v4.js');

    const logDir = join(__dirname, '..', 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir);
    const out = openSync(join(logDir, 'server_restart.log'), 'a');
    const err = openSync(join(logDir, 'server_restart_err.log'), 'a');

    const child = spawn('node', ['server_v4.js'], {
        cwd: join(__dirname, '..'),
        detached: true,
        stdio: ['ignore', out, err]
    });

    child.unref();

    console.log('3. Restart successful. Server is running PID:', child.pid);
    console.log('   Logs are flowing to logs/server_restart.log');
    console.log('--- [Reboot System] Done ---');
    process.exit(0);
}

reboot();
