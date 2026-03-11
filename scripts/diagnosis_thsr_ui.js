import { chromium } from 'playwright';

/**
 * THSR UI 診斷腳本 v1.2
 * 目的：驗證「我同意」按鈕、起訖站、日期設定及「依車次搜尋」模式的精確選取器。
 */

async function diagnose() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('🔍 開始診斷 THSR UI...');

    try {
        await page.goto('https://irs.thsrc.com.tw/IMINT/', { waitUntil: 'domcontentloaded' });

        // 1. 診斷並執行：Cookie/個資彈窗
        console.log('--- 步驟 1: 處理彈窗 ---');
        try {
            const agreeBtn = await page.waitForSelector('#cookieAccpetBtn, text="我同意"', { timeout: 5000 });
            await agreeBtn.click();
            console.log('✅ 已關閉彈窗');
            await page.waitForTimeout(500); // 等待消失
        } catch (e) {
            console.log('ℹ️ 未發現彈窗');
        }

        // 2. 模擬填寫起訖站
        console.log('--- 步驟 2: 模擬填寫起訖站 ---');
        await page.selectOption('#BookingS1Form_selectStartStation', { label: '台北' });
        await page.selectOption('#BookingS1Form_selectDestinationStation', { label: '台南' });
        console.log('[PASS] 已選擇 台北 -> 台南');

        // 3. 模擬日期設定
        console.log('--- 步驟 3: 模擬日期設定 ---');
        await page.evaluate(() => {
            const hidden = document.querySelector('#toTimeInputField');
            const visible = document.querySelector('input.uk-input:not(#securityCode)');
            if (hidden) hidden.value = '2026/04/04';
            if (visible) visible.value = '2026/04/04';
        });
        const dateVal = await page.$eval('#toTimeInputField', el => el.value);
        console.log(`[VERIFY] 日期數值已設為: ${dateVal}`);

        // 4. 模擬車次切換
        console.log('--- 步驟 4: 模擬車次切換 ---');
        await page.click('input[value="radio33"]');
        console.log('[PASS] 已點擊 依車次搜尋 (radio33)');

        // 關鍵：等待車次輸入框出現
        await page.waitForTimeout(1000);
        const trainInput = await page.waitForSelector('input[placeholder*="車次"], input[name*="trainConfront"]', { timeout: 10000 });
        if (trainInput) {
            console.log('[PASS] 成功看到車次輸入框');
            await trainInput.fill('1313');
        }

        // 5. 驗證碼區塊
        console.log('--- 步驟 5: 驗證碼區塊 ---');
        const cap = await page.waitForSelector('#securityCode', { timeout: 5000 });
        if (cap) console.log('[PASS] 找到驗證碼輸入框');

        console.log('✅ 診斷全數通過！所有關鍵元素皆可操作。');
    } catch (e) {
        console.error('❌ 診斷失敗:', e.message);
    } finally {
        await browser.close();
    }
}

diagnose();
