---
description: 在開始開發新任務前進行「戰前推演」，分析潛在風險並連結 Global Skills。
---

# Onboard 戰前推演流程

當用戶發起新任務或使用 `/onboard` 指令時，執行以下步驟：

1. **環境掃描**：
   - 使用 `list_dir` 和 `grep_search` 確認目標功能的相關檔案。
   - 檢查 `C:\Users\kuo_1\.gemini\antigravity\global_skills` 是否有相關的開發規範。

2. **風險分析 (Edge Case Discovery)**：
   - 列出至少 3 個可能導致失敗的「邊界情況」（例如：網路延遲、非同步競爭、空值處理）。
   - 參考 `global_skills/testing-patterns/SKILL.md` 制定測試策略。

3. **引用技能**：
   - 根據任務性質，顯式讀取並遵循以下技能：
     - `testing-patterns`: 負責自動化測試生成。
     - `code-review-checklist`: 負責代碼品質與安全初審。
     - `systematic-debugging`: 負責問題診斷。

4. **輸出計畫**：
   - 撰寫 `implementation_plan.md`，並包含「自動化驗證步驟」。
