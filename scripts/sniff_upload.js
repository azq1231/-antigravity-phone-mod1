
import { getOrConnectParams } from '../core/cdp_manager.js';

async function sniffUpload() {
    console.log('[SNIFFER] Connecting to Port 9000...');
    const conn = await getOrConnectParams(9000);

    // Handle list vs single
    const cdpList = Array.isArray(conn) ? conn : [conn];
    const target = cdpList[0]; // Assume first is enough for now

    console.log('[SNIFFER] Enabling Network Domain...');
    await target.call("Network.enable");

    // Listen for requests
    target.on("Network.requestWillBeSent", (params) => {
        const { request } = params;

        // Filter: Look for POST/PUT requests related to images or uploads
        if (request.method === 'POST' || request.method === 'PUT') {
            const url = request.url.toLowerCase();
            const hasData = request.hasPostData;

            // Check content-type for multipart/form-data or application/octet-stream
            const cType = request.headers['Content-Type'] || request.headers['content-type'] || '';

            if (url.includes('upload') || url.includes('file') || url.includes('image') || cType.includes('multipart') || cType.includes('image')) {
                console.log('\n🔥 [CAPTURE] POTENTIAL UPLOAD DETECTED 🔥');
                console.log(`URL: ${request.url}`);
                console.log(`Method: ${request.method}`);
                console.log(`Headers:`, JSON.stringify(request.headers, null, 2));

                if (hasData && request.postDataEntries) {
                    console.log(`Payload Type: Multipart/Form-Data (Contains ${request.postDataEntries.length} parts)`);
                } else if (hasData && request.postData) {
                    console.log(`Payload Data (First 100 chars): ${request.postData.substring(0, 100)}...`);
                }

                console.log('\n✅ SNIFFER MISSION COMPLETE. You can stop now.');
                process.exit(0);
            }
        }
    });

    console.log('\n🎧 [SNIFFER] LISTEN MODE ACTIVE 🎧');
    console.log('👉 Please manually upload an image in the Antigravity (Port 9000) window NOW.');
    console.log('   (Waiting for network activity...)');

    // Keep alive
    await new Promise(r => { });
}

sniffUpload();
