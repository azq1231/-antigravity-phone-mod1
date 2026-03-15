/**
 * Antigravity Automation Layer (V4 Modular)
 * 經過拆分重構，現在這是一個入口點檔案，將邏輯轉發至專屬子模組。
 */

import { captureSnapshot } from './auto_snap.js';
import { injectScroll, injectMessage, injectImage } from './auto_inject.js';
import { getDetailedUsage, openUsageDialog } from './auto_usage.js';
import { getAppState, setMode, setModel, discoverModels, startNewChat, selectChat, getChatHistory } from './auto_state.js';

// 導出所有函數，保持向下相容性
export {
    captureSnapshot,
    injectScroll,
    injectMessage,
    injectImage,
    getDetailedUsage,
    openUsageDialog,
    getAppState,
    setMode,
    setModel,
    discoverModels,
    startNewChat,
    selectChat,
    getChatHistory
};
