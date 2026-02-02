/**
 * useMessaging Composable
 * 負責訊息發送、自動重試邏輯與快速動作
 */
export function useMessaging(deps) {
    const {
        messageInput,
        sendBtn,
        currentViewingPort,
        fetchWithAuth,
        loadSnapshot
    } = deps;

    let isSending = false;
    const retryLimit = 6;

    async function sendMessage(retryCount = 0) {
        const message = messageInput.value.trim();
        if (!message) return;

        // UI 反饋：載入狀態
        const originalBtnHTML = sendBtn.innerHTML;
        sendBtn.disabled = true;
        sendBtn.innerHTML = retryCount > 0
            ? `<div style="font-size: 12px;">重試中 ${retryCount}/${retryCount < 5 ? 5 : retryLimit - 1}</div>`
            : '<div class="loading-spinner-s"></div>';
        sendBtn.style.opacity = '0.8';

        if (retryCount === 0) {
            messageInput.blur();
        }

        try {
            const res = await fetchWithAuth(`/send?port=${currentViewingPort.value}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            const data = await res.json();
            console.log('[useMessaging] Send Result:', data);

            if (res.ok && data.ok) {
                // 成功：清空輸入
                messageInput.value = '';
                messageInput.style.height = 'auto';
                const wrapper = messageInput.closest('.input-wrapper');
                if (wrapper) wrapper.classList.remove('input-error');

                // 視覺反饋
                setTimeout(loadSnapshot, 300);
                setTimeout(loadSnapshot, 1000);

                // 重置按鈕
                resetButton(originalBtnHTML);
                return true;
            } else {
                // 判斷是否重試 (包含 editor_not_found 與 busy)
                const shouldRetry = (data?.reason === "busy" || data?.error === "editor_not_found") && retryCount < retryLimit;

                if (shouldRetry) {
                    const delay = Math.min(3000 * Math.pow(1.3, retryCount), 8000);
                    console.warn(`[useMessaging] ${data?.reason || data?.error}, 重試中... (${retryCount + 1}/${retryLimit - 1})`);

                    await new Promise(r => setTimeout(r, delay));
                    // 遞迴重試並傳回結果
                    const success = await sendMessage(retryCount + 1);
                    return success;
                } else {
                    // 失敗：顯示紅框
                    showError(data);
                    resetButton(originalBtnHTML);
                    return false;
                }
            }
        } catch (e) {
            console.error('[useMessaging] Network error:', e);
            showError({ error: 'network_error' });
            resetButton(originalBtnHTML);
            return false;
        }
    }

    function quickAction(text) {
        messageInput.value = text;
        sendMessage();
    }

    // --- Private Helpers ---
    function resetButton(html) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = html;
        sendBtn.style.opacity = '1';
    }

    function showError(data) {
        console.error('[useMessaging] Failure:', data);
        const wrapper = messageInput.closest('.input-wrapper');
        if (wrapper) {
            wrapper.classList.add('input-error');
            setTimeout(() => wrapper.classList.remove('input-error'), 3000);
        }

        if (data?.error === "editor_not_found" || data?.reason === "no_context") {
            loadSnapshot();
        }
    }

    return {
        sendMessage,
        quickAction
    };
}
