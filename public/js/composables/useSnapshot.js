/**
 * useSnapshot Composable
 * 負責畫面快照的載入、渲染與自動刷新邏輯
 */
export function useSnapshot(deps) {
    const {
        chatContainer,
        chatContent,
        refreshBtn,
        currentViewingPort,
        fetchWithAuth,
        addMobileCopyButtons,
        scrollToBottom,
        userScrollLockUntil // 傳入一個對象 { value: number } 以保持響應性
    } = deps;

    let lastHash = '';

    /**
     * 渲染快照內容
     */
    function renderSnapshot(data, force = false) {
        if (!data) return;

        // 如果是錯誤/等待狀態，即便沒有 HTML 也顯示訊息
        if (data.error && data.error.includes('Waiting')) {
            chatContent.innerHTML = data.html || `<div class="loading-state"><p>${data.error}</p></div>`;
            return;
        }

        if (!data.html) return;

        // 效能優化：如果 Hash 沒變且非強制刷新，則跳過
        if (!force && data.hash && data.hash === lastHash) {
            return;
        }
        if (data.hash) lastHash = data.hash;

        try {
            // 在更新內容前擷取滾動狀態
            const scrollPos = chatContainer.scrollTop;
            const scrollHeight = chatContainer.scrollHeight;
            const clientHeight = chatContainer.clientHeight;
            const isNearBottom = scrollHeight - scrollPos - clientHeight < 120;
            const isUserScrollLocked = Date.now() < userScrollLockUntil.value;

            // --- 更新統計數據 ---
            if (data.stats) {
                const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
                const nodes = data.stats.nodes;
                const statsText = document.getElementById('statsText');
                if (statsText) statsText.textContent = `${nodes} Nodes · ${kbs}KB`;
            }

            // --- CSS 注入 (快取處理) ---
            let styleTag = document.getElementById('cdp-styles');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'cdp-styles';
                document.head.appendChild(styleTag);
            }

            const darkModeOverrides = '/* --- BASE SNAPSHOT CSS --- */\n' +
                (data.css || '') +
                '\n\n/* --- FORCE DARK MODE OVERRIDE --- */\n' +
                ':root {\n' +
                '    --bg-app: #0f172a;\n' +
                '    --text-main: #f8fafc;\n' +
                '    --text-muted: #94a3b8;\n' +
                '    --border-color: #334155;\n' +
                '}\n' +
                '\n' +
                '#cascade {\n' +
                '    background-color: transparent !important;\n' +
                '    color: var(--text-main) !important;\n' +
                '    font-family: \'Inter\', system-ui, sans-serif !important;\n' +
                '    position: relative !important;\n' +
                '    height: auto !important;\n' +
                '    width: 100% !important;\n' +
                '}\n' +
                '\n' +
                '#cascade * {\n' +
                '    position: static !important;\n' +
                '}\n' +
                '\n' +
                '#cascade p, #cascade h1, #cascade h2, #cascade h3, #cascade h4, #cascade h5, #cascade span, #cascade div, #cascade li {\n' +
                '    color: inherit !important;\n' +
                '}\n' +
                '\n' +
                '#cascade a {\n' +
                '    color: #60a5fa !important;\n' +
                '    text-decoration: underline;\n' +
                '}\n' +
                '\n' +
                '/* Fix Inline Code - Ultra-compact */\n' +
                ':not(pre) > code {\n' +
                '    padding: 0px 2px !important;\n' +
                '    border-radius: 2px !important;\n' +
                '    background-color: rgba(255, 255, 255, 0.1) !important;\n' +
                '    font-size: 0.82em !important;\n' +
                '    line-height: 1 !important;\n' +
                '    white-space: normal !important;\n' +
                '}\n' +
                '\n' +
                'pre, code, .monaco-editor-background, [class*="terminal"] {\n' +
                '    background-color: #1e293b !important;\n' +
                '    color: #e2e8f0 !important;\n' +
                '    font-family: \'JetBrains Mono\', monospace !important;\n' +
                '    border-radius: 3px;\n' +
                '    border: 1px solid #334155;\n' +
                '}\n' +
                '                \n' +
                '/* Multi-line Code Block - Minimal */\n' +
                'pre {\n' +
                '    position: relative !important;\n' +
                '    white-space: pre-wrap !important; \n' +
                '    word-break: break-word !important;\n' +
                '    padding: 4px 6px !important;\n' +
                '    margin: 2px 0 !important;\n' +
                '    display: block !important;\n' +
                '    width: 100% !important;\n' +
                '}\n' +
                '                \n' +
                'pre.has-copy-btn {\n' +
                '    padding-right: 28px !important;\n' +
                '}\n' +
                '                \n' +
                '/* Single-line Code Block - Minimal */\n' +
                'pre.single-line-pre {\n' +
                '    display: inline-block !important;\n' +
                '    width: auto !important;\n' +
                '    max-width: 100% !important;\n' +
                '    padding: 0px 4px !important;\n' +
                '    margin: 0px !important;\n' +
                '    vertical-align: middle !important;\n' +
                '    background-color: #1e293b !important;\n' +
                '    font-size: 0.85em !important;\n' +
                '}\n' +
                '                \n' +
                'pre.single-line-pre > code {\n' +
                '    display: inline !important;\n' +
                '    white-space: nowrap !important;\n' +
                '}\n' +
                '                \n' +
                'pre:not(.single-line-pre) > code {\n' +
                '    display: block !important;\n' +
                '    width: 100% !important;\n' +
                '    overflow-x: auto !important;\n' +
                '    background: transparent !important;\n' +
                '    border: none !important;\n' +
                '    padding: 0 !important;\n' +
                '    margin: 0 !important;\n' +
                '}\n' +
                '                \n' +
                '.mobile-copy-btn {\n' +
                '    position: absolute !important;\n' +
                '    top: 2px !important;\n' +
                '    right: 2px !important;\n' +
                '    background: rgba(30, 41, 59, 0.5) !important;\n' +
                '    color: #94a3b8 !important;\n' +
                '    border: none !important;\n' +
                '    width: 24px !important; \n' +
                '    height: 24px !important;\n' +
                '    padding: 0 !important;\n' +
                '    cursor: pointer !important;\n' +
                '    display: flex !important;\n' +
                '    align-items: center !important;\n' +
                '    justify-content: center !important;\n' +
                '    border-radius: 4px !important;\n' +
                '    transition: all 0.2s ease !important;\n' +
                '    -webkit-tap-highlight-color: transparent !important;\n' +
                '    z-index: 10 !important;\n' +
                '    margin: 0 !important;\n' +
                '}\n' +
                '                \n' +
                '.mobile-copy-btn:hover,\n' +
                '.mobile-copy-btn:focus {\n' +
                '    background: rgba(59, 130, 246, 0.2) !important;\n' +
                '    color: #60a5fa !important;\n' +
                '}\n' +
                '                \n' +
                '.mobile-copy-btn svg {\n' +
                '    width: 16px !important;\n' +
                '    height: 16px !important;\n' +
                '    stroke: currentColor !important;\n' +
                '    stroke-width: 2 !important;\n' +
                '    fill: none !important;\n' +
                '}\n' +
                '                \n' +
                'blockquote {\n' +
                '    border-left: 3px solid #3b82f6 !important;\n' +
                '    background: rgba(59, 130, 246, 0.1) !important;\n' +
                '    color: #cbd5e1 !important;\n' +
                '    padding: 8px 12px !important;\n' +
                '    margin: 8px 0 !important;\n' +
                '}\n' +
                '\n' +
                'table {\n' +
                '    border-collapse: collapse !important;\n' +
                '    width: 100% !important;\n' +
                '    border: 1px solid #334155 !important;\n' +
                '}\n' +
                'th, td {\n' +
                '    border: 1px solid #334155 !important;\n' +
                '    padding: 8px !important;\n' +
                '    color: #e2e8f0 !important;\n' +
                '}\n' +
                '\n' +
                '::-webkit-scrollbar {\n' +
                '    width: 0 !important;\n' +
                '}\n' +
                '                \n' +
                '[style*=\"background-color: rgb(255, 255, 255)\"],\n' +
                '[style*=\"background-color: white\"],\n' +
                '[style*=\"background: white\"] {\n' +
                '    background-color: transparent !important;\n' +
                '}';
            styleTag.textContent = darkModeOverrides + (data.css_extra || '');

            // --- 渲染 HTML ---
            chatContent.innerHTML = data.html;

            // --- 渲染後處理 ---
            addMobileCopyButtons();

            // 智慧滾動行為：尊重使用者滾動鎖定，僅在適當時候自動滾動
            if (isUserScrollLocked) {
                // 使用百分比還原滾動位置
                const scrollPercent = scrollHeight > 0 ? scrollPos / scrollHeight : 0;
                const newScrollPos = chatContainer.scrollHeight * scrollPercent;
                chatContainer.scrollTop = newScrollPos;
            } else if (isNearBottom || scrollPos === 0) {
                // 在底部或尚未滾動時，自動捲動到底部
                scrollToBottom();
            } else {
                // 保留精確滾動位置
                chatContainer.scrollTop = scrollPos;
            }

        } catch (err) {
            console.error('[useSnapshot] Render error:', err);
        }
    }

    /**
     * 手動觸發快照獲取
     */
    async function loadSnapshot() {
        try {
            // 重新整理按鈕旋轉動畫
            const icon = refreshBtn.querySelector('svg');
            if (icon) {
                icon.classList.remove('spin-anim');
                void icon.offsetWidth; // 強制重繪
                icon.classList.add('spin-anim');
            }

            const response = await fetchWithAuth(`/snapshot?port=${currentViewingPort.value}`);
            if (!response.ok) {
                if (response.status === 503) return;
                throw new Error('Failed to load');
            }

            const data = await response.json();
            renderSnapshot(data, true); // 強制渲染
        } catch (err) {
            console.error('[useSnapshot] Load error:', err);
        }
    }

    return {
        renderSnapshot,
        loadSnapshot,
        getLastHash: () => lastHash
    };
}
