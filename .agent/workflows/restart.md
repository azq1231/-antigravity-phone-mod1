---
description: 當修改伺服器端代碼（如 server_v4.js, core/*.js, routes/*.js）後，執行此流程自動重啟服務。
---

// turbo-all

1. 執行專用的重啟腳本
   `node scripts/reboot.js`
2. 驗證服務是否成功啟動
   `tasklist /FI "IMAGENAME eq node.exe"`
