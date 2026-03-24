# CHANGELOG

## 1.23.258 (2026-03-18)

- 修正手機端圖標破圖 (Broken Icons) 錯誤。

- 修正 Vite 資源路徑雙重疊加 (Double Assets) 問題。
- 強化 VS Code AppData 路徑資源映射。
- 確保所有靜態資源透過 `/assets` 與 `/vscode-resources` 正確提供。
- 校準 `base: '/'` 以確保絕對路徑解析。
- **Auto-Accept 功能整合**: 自動點擊「接受」、「繼續」、「執行」等按鈕（參考 `antigravity-auto-accept` 專案）。
- **圖標回退 v2**: 加入對 `.svg`、`.ico` 等格式與帶參數 URL 的全面支援。

