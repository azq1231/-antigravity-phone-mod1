Dim oShell, oFSO, oFile
Set oShell = CreateObject("WScript.Shell")
Set oFSO   = CreateObject("Scripting.FileSystemObject")

' 取得 VBS 所在目錄（去掉尾部反斜線）
Dim sDir
sDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

Dim sTmp
sTmp = oFSO.GetSpecialFolder(2) ' C:\Users\...\AppData\Local\Temp

' ── 寫入 Server 暫存 bat ──────────────────────────────
Dim sBatServer
sBatServer = sTmp & "\ag_v4_server.bat"
Set oFile = oFSO.CreateTextFile(sBatServer, True)
oFile.WriteLine "@echo off"
oFile.WriteLine "title AG-V4-Server"
oFile.WriteLine "color 0B"
oFile.WriteLine "cd /d """ & sDir & """"
oFile.WriteLine "echo [AG] Server starting..."
oFile.WriteLine "node server_v4.js"
oFile.WriteLine "pause"
oFile.Close

' ── 寫入 Tunnel 暫存 bat ────────────────────────────── 
Dim sBatTunnel
sBatTunnel = sTmp & "\ag_v4_tunnel.bat"
Set oFile = oFSO.CreateTextFile(sBatTunnel, True)
oFile.WriteLine "@echo off"
oFile.WriteLine "title AG-V4-Tunnel"
oFile.WriteLine "color 0D"
oFile.WriteLine "cd /d """ & sDir & """"
oFile.WriteLine "echo [AG] Tunnel starting (ag.monyangood.com)..."
oFile.WriteLine """" & sDir & "\cloudflared.exe"" tunnel --config """ & sDir & "\cloudflared_config.yml"" run"
oFile.WriteLine "if errorlevel 1 (echo [AG] Tunnel FAILED! & pause)"
oFile.Close

Set oFSO = Nothing

' ── 啟動兩個視窗（conhost 繞過 Windows Terminal）────────
oShell.Run "C:\Windows\System32\conhost.exe cmd.exe /k " & sBatServer, 1, False
WScript.Sleep 2000
oShell.Run "C:\Windows\System32\conhost.exe cmd.exe /k " & sBatTunnel, 1, False

Set oShell = Nothing
