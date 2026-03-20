/**
 * Antigravity Automation Layer (V4 Stable Entry)
 * 經過拆分重構，現在這是一個入口點檔案，將邏輯轉發至專屬子模組。
 * 此架構優化了邏輯原子性，方便各別功能獨立開發與測試。
 */

import { captureSnapshot, injectScroll } from './auto_snap.js';
import { injectMessage, injectImage } from './auto_inject.js';
import { getDetailedUsage, openUsageDialog } from './auto_usage.js';
import { 
    getAppState, 
    setMode, 
    setModel, 
    discoverModels, 
    startNewChat, 
    selectChat, 
    getChatHistory 
} from './auto_state.js';
import { runAutoAccept } from './auto_accept.js';


// 再次確認：修改 core/*.js 後必須重啟伺服器 (node scripts/reboot.js)

export {
    // 快照與滾動 (auto_snap.js)
    captureSnapshot,
    injectScroll,

    // 輸入注入 (auto_inject.js)
    injectMessage,
    injectImage,

    // 用量偵測 (auto_usage.js)
    getDetailedUsage,
    openUsageDialog,

    // 狀態與模式切換 (auto_state.js)
    getAppState,
    setMode,
    setModel,
    discoverModels,
    startNewChat,
    selectChat,
    getChatHistory,

    // 自動按鈕點擊 (auto_accept.js)
    runAutoAccept
};

