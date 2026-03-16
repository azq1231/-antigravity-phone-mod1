
import fs from 'fs';
import path from 'path';

// 模擬 core/auto_snap.js 的排序邏輯
function simulateSorting(candidates) {
    const qualityScore = { exact: 1000000, loose: 1000, fallback: 0 };
    
    console.log("\n=== 候選者權重分析表 ===");
    console.log("ID\tQuality\tFocus\tVisible\tLength\tTitle");
    
    candidates.forEach(c => {
        console.log(`${c.id}\t${c.matchQuality}\t${c.hasFocus}\t${c.visibility}\t${c.html.length}\t${c.targetTitle}`);
    });

    const sorted = [...candidates].sort((a, b) => {
        const qa = qualityScore[a.matchQuality] || 0;
        const qb = qualityScore[b.matchQuality] || 0;
        if (qa !== qb) return qb - qa;
        
        if (a.hasFocus !== b.hasFocus) return a.hasFocus ? -1 : 1;
        if (a.visibility !== b.visibility) return a.visibility === 'visible' ? -1 : 1;
        
        // 關鍵的長度陷阱
        return b.html.length - a.html.length;
    });

    console.log("\n=== 最終勝出者 ===");
    console.log(`ID: ${sorted[0].id}, Title: ${sorted[0].targetTitle}, Length: ${sorted[0].html.length}`);
    return sorted[0];
}

const snapDir = 'd:/MyProjects/antigravity_phone_chat_ori/dump_snaps';
const files = fs.readdirSync(snapDir).filter(f => f.endsWith('.json'));

const candidates = files.map(f => {
    const content = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8'));
    return {
        id: f,
        ...content,
        matchQuality: content.matchQuality || 'fallback',
        hasFocus: content.hasFocus || false,
        visibility: content.visibility || 'hidden'
    };
});

if (candidates.length > 0) {
    simulateSorting(candidates);
} else {
    console.log("沒有找到 dump 數據，請確認 dump_snaps 目錄。");
}
