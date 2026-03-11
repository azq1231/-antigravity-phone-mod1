import { chromium } from 'playwright';

/**
 * 高鐵自動訂票腳本 v2.4 (Visible Filter Fix)
 */

async function runBooking() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();

    console.log('🚀 啟動高鐵訂票系統...');

    try {
        await page.goto('https://irs.thsrc.com.tw/IMINT/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 1. 清除遮罩
        await page.evaluate(() => {
            const trash = ['#cookiePolicy', '.cookie-policy-container', '#cookieAccpetBtn'];
            trash.forEach(s => document.querySelector(s)?.remove());
        });

        // 2. 起訖站
        await page.selectOption('select[name*="selectStartStation"]', { label: '台北' });
        await page.waitForTimeout(500);
        await page.selectOption('select[name*="selectDestinationStation"]', { label: '台南' });
        await page.waitForTimeout(500);

        // 3. 日期 - 加上 visible: true 確保選到可見欄位
        console.log('📅 設定日期：2026/04/04...');
        const dateInput = page.locator('input.uk-input').and(page.locator(':visible')).first();
        await dateInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('2026/04/04');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        // 4. 票數
        console.log('🎫 設定票數...');
        const selects = await page.$$('select[name*="ticketAmount"]');
        if (selects.length >= 1) await selects[0].selectOption({ index: 3 });
        if (selects.length >= 4) await selects[3].selectOption({ index: 1 });

        // 5. 車次模式切換
        console.log('🔄 切換至車次搜尋模式...');
        await page.click('label:has-text("車次")');
        await page.waitForTimeout(1500);

        // 6. 填寫車次 1313
        console.log('⌨️ 填寫車次 1313...');
        try {
            const trainNumField = page.locator('input[placeholder*="車次"], input[name*="trainConfront"]').and(page.locator(':visible')).first();
            await trainNumField.fill('1313');
        } catch (e) {
            console.log('⚠️ 使用座標填寫車次...');
            await page.mouse.click(750, 400);
            await page.keyboard.type('1313');
        }

        // 7. 聚焦驗證碼
        await page.focus('#securityCode');

        console.log('---------------------------------------------------------');
        console.log('✨ 腳本填單已完成！');
        console.log('👉 請在開啟的視窗輸入驗證碼，然後按【開始查詢】。');
        console.log('---------------------------------------------------------');

        await page.waitForNavigation({ timeout: 0 });

    } catch (error) {
        console.error('❌ 發生錯誤:', error.message);
        await page.screenshot({ path: 'thsr_final_error_v2.4.png' });
    }
}

runBooking();
