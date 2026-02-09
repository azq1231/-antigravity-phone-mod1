import { spawn, exec } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isPortInUse } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

export const runningProcesses = new Map(); // port -> child_process

export async function spawnInstance(port) {
    if (await isPortInUse(port)) return { success: true, alreadyRunning: true };

    const userData = join(projectRoot, `.user_data_${port}`);
    const cmd = `"D:\\Program Files\\Antigravity\\Antigravity.exe"`;
    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir="${userData}"`,
        '--no-first-run',
        '--disable-workspace-trust'
    ];

    const fullCmd = `${cmd} ${args.join(' ')}`;
    console.log(`[V4-SPAWN] Port ${port}: ${fullCmd}`);

    const child = spawn(fullCmd, [], { detached: true, stdio: 'ignore', shell: true });
    child.unref();
    runningProcesses.set(port, child);

    // Wait for port to be ready
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await isPortInUse(port)) return { success: true };
    }
    return { error: 'Timeout waiting for port' };
}

export async function killInstance(port, activeConnections) {
    console.log(`[V4-KILL] Port ${port}`);
    return new Promise((resolve) => {
        const portCmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port} ^| findstr LISTENING') do taskkill /f /pid %a`;
        exec(portCmd, (err) => {
            if (!err) console.log(`[V4-KILL] Killed ${port}`);
            if (activeConnections) activeConnections.delete(port);
            runningProcesses.delete(port);
            resolve({ success: true });
        });
    });
}
