import net from 'net';

const LOCAL_PORT = 9222;
const TARGET_PORT = 9001; // 您目前主要工作的端口

const server = net.createServer(socket => {
    const target = net.createConnection(TARGET_PORT, '127.0.0.1');

    // 雙向流量轉發
    socket.pipe(target).pipe(socket);

    socket.on('error', () => target.destroy());
    target.on('error', () => socket.destroy());
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`\x1b[31m[錯誤] Port ${LOCAL_PORT} 已被佔用！\x1b[0m`);
        console.error(`\x1b[33m請先關閉所有 Chrome 視窗，然後再試一次。\x1b[0m`);
    } else {
        console.error(`[錯誤] ${e.message}`);
    }
    process.exit(1);
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`\n\x1b[32m===========================================\x1b[0m`);
    console.log(`\x1b[32m🚀 CDP 端口橋接已啟動！\x1b[0m`);
    console.log(`\x1b[36m輸入端: 127.0.0.1:${LOCAL_PORT} (給 Auto CDP 用)\x1b[0m`);
    console.log(`\x1b[36m輸出端: 127.0.0.1:${TARGET_PORT} (指向您的 IDE)\x1b[0m`);
    console.log(`\x1b[32m===========================================\x1b[0m`);
    console.log(`已進入監聽狀態，請勿關閉此視窗...\n`);
});
