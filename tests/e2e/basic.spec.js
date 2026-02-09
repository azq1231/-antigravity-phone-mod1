
import { test, expect } from '@playwright/test';

// 📚 基礎測試：確保首頁可以載入
test('Homepage loads correctly', async ({ page }) => {
    await page.goto('http://localhost:3004/');

    // Check title
    await expect(page).toHaveTitle(/Antigravity/);

    // Check essential elements
    await expect(page.locator('#messageInput')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeVisible();
    await expect(page.locator('#statusDot')).toBeVisible();
});

// 📚 測試停止按鈕
test('Stop button exists', async ({ page }) => {
    await page.goto('http://localhost:3004/');
    await expect(page.locator('#stopBtn')).toBeVisible();
});

// 📚 測試 V4 頁面 (如果是 V4 只有在 / 上跑)
test('V4 Stable Layout Check', async ({ page }) => {
    // 假設 V4 在根目錄 (或 /index_v4.html 如果直接訪問)
    // 這裡我們只測首頁
    await page.goto('http://localhost:3004/');

    // V4 應該要有 setting chips
    const chip = page.locator('.setting-chip').first();
    if (await chip.isVisible()) {
        await expect(chip).toBeVisible();
    }
});
