
import { getOrConnectParams } from '../core/cdp_manager.js';
import { injectImage } from '../core/automation.js';

async function finalDiagnostic() {
    console.log('[DEBUG] Starting Final Diagnostic...');
    const testImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    try {
        console.log('[DEBUG] Connecting to Port 9000...');
        const conn = await getOrConnectParams(9000);

        console.log('[DEBUG] Calling injectImage...');
        const result = await injectImage(conn, testImg);

        console.log('\n--- INJECTION RESULT ---');
        console.log(JSON.stringify(result, null, 2));
        console.log('-------------------------\n');

        if (result.ok) {
            console.log('✅ Automation says IT WORKED. If you dont see it, the app is swallowing the event.');
        } else {
            console.log('❌ Automation FAILED. Reason:', result.error);
        }

    } catch (e) {
        console.error('[DEBUG] Fatal error during diagnostic:', e);
    }
    process.exit(0);
}

finalDiagnostic();
