import { chromium } from 'playwright';

(async () => {
    console.log('--- [UI Test] Starting E2E Verification ---');
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        console.log('1. Navigating to local V4 server...');
        await page.goto('http://localhost:3004', { waitUntil: 'networkidle' });

        console.log('2. Waiting for UI components to load...');
        await page.waitForSelector('#mainTitle');
        await page.waitForSelector('.setting-chip');

        // Wait a bit for JS to fully attach since we use setTimeout(bindInteractions, 100)
        await page.waitForTimeout(500);

        // --- Test 1: Model Selector (Blue Badge) ---
        console.log('3. Testing Blue Model Selector Badge...');
        const blueBadge = page.locator('#currentModelBadge');
        if (await blueBadge.count() > 0) {
            console.log('   - Clicking Blue Badge...');
            await blueBadge.click();

            // Should open modal
            console.log('   - Waiting for Modal Overlay...');
            await page.waitForSelector('#modalOverlay', { state: 'visible', timeout: 3000 });

            const modalTitle = await page.locator('.modal-title').textContent();
            console.log(`   - Modal Title: ${modalTitle}`);
            if (!modalTitle.includes('Model')) {
                throw new Error(`Expected Model modal, but got: ${modalTitle}`);
            }
            console.log('   [PASS] Model Selector works.');

            // Close modal by clicking overlay
            await page.mouse.click(1, 1); // Click outside (top left corner)
            await page.waitForSelector('#modalOverlay', { state: 'hidden', timeout: 3000 });
            console.log('   - Modal closed successfully.');
        } else {
            throw new Error('Blue Badge not found.');
        }

        await page.waitForTimeout(500);

        // --- Test 2: Main Title (Slot Manager) - Rapid Click Test ---
        console.log('4. Testing Main Title Rapid Clicks (Flicker Test)...');
        const mainTitle = page.locator('#mainTitle');
        console.log('   - Rapid clicking Main Title 3 times...');

        // Simulating very fast clicks
        await mainTitle.click();
        await mainTitle.click({ delay: 50 });
        await mainTitle.click({ delay: 50 });

        console.log('   - Clicks sent. Waiting for Modal Overlay...');
        await page.waitForSelector('#modalOverlay', { state: 'visible', timeout: 3000 });

        // Wait for potential flicker to settle
        await page.waitForTimeout(1000);

        const slotModalTitle = await page.locator('.modal-title').first().textContent();
        console.log(`   - Modal Title: ${slotModalTitle}`);

        const loadingBoxVisible = await page.locator('#slotLoadingBox').isVisible();
        console.log(`   - Loading box visible after 1s: ${loadingBoxVisible}`);

        if (loadingBoxVisible) {
            console.log('   [PASS/FAIL?] Note: Loading box visible. If it flickered, UI might be re-rendered.');
        }

        const slotItems = await page.locator('.slot-item').count();
        console.log(`   - Found ${slotItems} slots in manager.`);
        if (slotItems === 0) {
            throw new Error('No slots rendered. UI might be stuck in loading or reset by rapid clicks.');
        }

        console.log('--- [UI Test] ALL TESTS PASSED SUCCESSFULLY! ---');


    } catch (e) {
        console.error('--- [UI Test] FAILED ---');
        console.error(e.message);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
})();
