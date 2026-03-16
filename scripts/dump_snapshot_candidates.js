
import { getOrConnectParams } from '../core/cdp_manager.js';
import fs from 'fs';

const CAPTURE_SCRIPT = `(() => {
    try {
        const isChatContainer = (el) => el && (el.id === 'conversation' || el.id === 'chat' || el.id === 'cascade');
        const exactTarget = [
            document.querySelector('#conversation'),
            document.querySelector('#chat'),
            document.querySelector('#cascade')
        ].find(el => el && (el.offsetHeight > 0 || isChatContainer(el)));
        
        return {
            html: (exactTarget || document.body).innerHTML,
            len: (exactTarget || document.body).innerHTML.length,
            title: document.title,
            quality: exactTarget ? 'exact' : 'fallback',
            hasFocus: document.hasFocus(),
            visibility: document.visibilityState
        };
    } catch (e) { return { error: e.toString() }; }
})()`;

async function dump() {
    const port = 9000;
    const conns = await getOrConnectParams(port);
    console.log(`[DUMP] Found ${conns.length} connections on Port ${port}.`);
    
    if (!fs.existsSync('dump_snaps')) fs.mkdirSync('dump_snaps');

    for (let cidx = 0; cidx < conns.length; cidx++) {
        const conn = conns[cidx];
        const ctxs = conn.contexts || [{id: undefined}];
        for (let midx = 0; midx < ctxs.length; midx++) {
            const ctx = ctxs[midx];
            try {
                const res = await conn.call("Runtime.evaluate", { 
                    expression: CAPTURE_SCRIPT, 
                    returnByValue: true, 
                    contextId: ctx.id 
                });
                const val = res.result?.value;
                if (val && !val.error) {
                    const filename = `dump_snaps/port_${port}_c${cidx}_m${midx}.json`;
                    fs.writeFileSync(filename, JSON.stringify(val, null, 2));
                    console.log(`  Saved: ${filename} | Qual: ${val.quality} | Len: ${val.len} | Focus: ${val.hasFocus} | Vis: ${val.visibility}`);
                }
            } catch (e) {}
        }
    }
}

dump();
