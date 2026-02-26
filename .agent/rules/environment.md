# Environment Rules

- **Operating System**: Windows 11
- **Primary Shell**: PowerShell / pwsh
- **Prohibited Commands**: `grep`, `ls -la`, `rm -rf`, `cat` (unless safe), `touch` (use `New-Item` or AI tool)
- **Mandatory Replacements**:
  - Use `Select-String` instead of `grep`.
  - Use `ls` or `Get-ChildItem` instead of `ls -la`.
  - Use `Remove-Item` instead of `rm -rf`.
  - Use `get_file_content` or `view_file` tool instead of `cat`.
- **Reasoning**: This project is built and optimized for the Windows Node.js environment. To avoid path encoding issues and permission conflicts, DO NOT suggest or use Linux-subsystem-specific workflows.
