import http from 'http';

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

(async () => {
    try {
        const list = await getJson('http://127.0.0.1:9001/json');
        console.log('--- TARGETS ON 9000 ---');
        list.forEach(t => {
            console.log(`[${t.type}] "${t.title}"`);
            console.log(`   URL: ${t.url}`);
            console.log(`   WS:  ${t.webSocketDebuggerUrl}`);
            console.log('------------------------');
        });
    } catch (e) {
        console.error(e.message);
    }
})();
