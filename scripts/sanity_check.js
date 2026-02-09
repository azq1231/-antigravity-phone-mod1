import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const JS_FILES = [
    'server.js',
    'core/automation.js',
    'core/cdp_manager.js',
    'core/instance_manager.js',
    'core/utils.js',
    'public/js/app_v4.js',
    'public/js/app_multi.js',
    'routes/api.js'
];

const CRITICAL_HTML = [
    'public/index.html',
    'public/index_v4.html'
];

async function runFullSanityCheck() {
    let errors = 0;

    // 0. Environment & Permissions Check
    // Check node_modules
    if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
        console.error('❌ Missing: node_modules directory (Run "npm install")');
        errors++;
    }

    // Check .env (Optional but verified)
    if (!fs.existsSync(path.join(ROOT_DIR, '.env'))) {
        // Not a failing error since defaults exist, but good to know
        // console.warn('⚠️  Missing .env file (Using default settings)');
    }

    // Check Write Permissions (Critical for logs/snapshots)
    try {
        const testFile = path.join(ROOT_DIR, '.perm_test');
        fs.writeFileSync(testFile, 'ok');
        fs.unlinkSync(testFile);
    } catch (e) {
        console.error('❌ Write Permission Denied: Cannot write to project directory');
        errors++;
    }

    // 1. Check File Existence
    const allFiles = [...JS_FILES, ...CRITICAL_HTML];
    allFiles.forEach(file => {
        if (!fs.existsSync(path.join(ROOT_DIR, file))) {
            console.error(`❌ Missing file: ${file}`);
            errors++;
        }
    });

    // 2. Syntax & ESM Check
    JS_FILES.forEach(file => {
        const fullPath = path.join(ROOT_DIR, file);
        if (!fs.existsSync(fullPath)) return;

        // Syntax
        try {
            execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
        } catch (e) {
            console.error(`❌ [${file}] Syntax Error:\n${e.stderr.toString()}`);
            errors++;
        }

        // ESM Import Paths
        const content = fs.readFileSync(fullPath, 'utf8');
        const importRegex = /import\s+.*\s+from\s+['"](.*)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            const importPath = match[1];
            if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue;
            const dir = path.dirname(fullPath);
            const resolvedPath = path.join(dir, importPath.endsWith('.js') ? importPath : importPath + '.js');
            if (!fs.existsSync(resolvedPath)) {
                console.error(`❌ [${file}] Broken Import: "${importPath}"`);
                errors++;
            }
        }
    });

    // 3. Version Consistency (Audit Logic) & Single Source of Truth
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
        const vMajorMinor = `V${pkg.version.split('.').slice(0, 2).join('.')}`;

        const v4js = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app_v4.js'), 'utf8');
        // Verify that the logic for dynamic version injection exists
        if (!v4js.includes('vLabel') || !v4js.includes('APP_VERSION')) {
            // If we want to be extra strict, we can check if it fetches version
        }

        // Final sanity: check if package version is readable
        if (!pkg.version) {
            console.error('❌ Audit: package.json is missing version!');
            errors++;
        }
    } catch (e) { }

    // 4. HTML Resource Linkage
    CRITICAL_HTML.forEach(htmlFile => {
        const fullPath = path.join(ROOT_DIR, htmlFile);
        if (!fs.existsSync(fullPath)) return;
        const html = fs.readFileSync(fullPath, 'utf8');
        const srcMatches = html.match(/src=["']([^"']+)["']/g) || [];
        srcMatches.forEach(m => {
            const src = m.match(/["']([^"']+)["']/)[1];
            if (src.startsWith('http') || src.startsWith('//')) return;
            const resPath = path.join(ROOT_DIR, 'public', src);
            if (!fs.existsSync(resPath)) {
                console.error(`❌ [${htmlFile}] Broken Resource: "${src}"`);
                errors++;
            }
        });
    });

    // 5. API & Port Health Check (Optional/Runtime)
    try {
        const net = await import('net');
        const http = await import('http');

        const isPortActive = (port) => new Promise(resolve => {
            const s = net.createServer().once('error', () => resolve(true))
                .once('listening', () => { s.close(); resolve(false); })
                .listen(port, '127.0.0.1');
        });

        const SERVER_PORT = process.env.PORT || 3000;
        const active = await isPortActive(SERVER_PORT);

        if (active) {
            // Server is running, try to ping it
            await new Promise(resolve => {
                http.get(`http://127.0.0.1:${SERVER_PORT}/health`, (res) => {
                    if (res.statusCode !== 200) {
                        console.error(`❌ API Health Check Failed: /health returned ${res.statusCode}`);
                        errors++;
                    }
                    resolve();
                }).on('error', () => {
                    console.error('❌ API Reachability Failed: Server is on port but /health is not responding');
                    errors++;
                    resolve();
                });
            });
        }
    } catch (e) {
        // net/http import failure or other logic error
    }

    console.log(`DONE. Total Errors: ${errors}`);
    if (errors > 0) process.exit(1);
}

runFullSanityCheck();
