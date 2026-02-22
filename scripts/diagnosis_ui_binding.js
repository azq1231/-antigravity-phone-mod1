(async () => {
    console.log('--- [UI Diagnosis] Checking Model Selector Bindings ---');

    const activeModelText = document.getElementById('activeModelText');
    console.log('1. activeModelText element:', activeModelText ? 'FOUND' : 'NOT FOUND');

    if (activeModelText) {
        const parentChip = activeModelText.closest('.setting-chip');
        console.log('2. Parent chip (.setting-chip):', parentChip ? 'FOUND' : 'NOT FOUND');

        if (parentChip) {
            console.log('3. Parent chip onclick:', parentChip.onclick ? 'ASSIGNED' : 'NULL');
            console.log('4. Parent chip cursor style:', window.getComputedStyle(parentChip).cursor);

            // 手動模擬點擊測試
            console.log('5. Simulating click on parent chip...');
            parentChip.click();

            setTimeout(() => {
                const modal = document.getElementById('modalOverlay');
                const isVisible = modal && window.getComputedStyle(modal).display !== 'none';
                console.log('6. Modal visible after click:', isVisible ? 'YES' : 'NO');
                if (!isVisible) {
                    console.warn('   [FAIL] Modal did not show up. Possible causes: Binding failed or fetch error inside openModelSelector.');
                } else {
                    console.log('   [PASS] Modal triggered successfully.');
                }
            }, 1000);
        }
    }

    const modelSelectorBtn = document.querySelector('.setting-chip:nth-child(2)');
    console.log('7. Original model button (.setting-chip:nth-child(2)):', modelSelectorBtn ? 'FOUND' : 'NOT FOUND');
    if (modelSelectorBtn) {
        console.log('8. Original button onclick:', modelSelectorBtn.onclick ? 'ASSIGNED' : 'NULL');
    }

    console.log('--- [Diagnosis Done] ---');
})();
