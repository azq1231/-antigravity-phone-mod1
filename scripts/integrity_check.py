import os
import sys
import subprocess
import json

def run_check(name, command):
    print(f"[*] Running {name}...")
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"[OK] {name} passed.")
            return True
        else:
            print(f"[FAIL] {name} failed:")
            print(result.stdout)
            print(result.stderr)
            return False
    except Exception as e:
        print(f"[ERROR] Could not run {name}: {e}")
        return False

def main():
    print("=== Antigravity System Integrity Check ===")
    
    success = True
    
    # 1. Javascript Syntax Check
    js_files = []
    for root, dirs, files in os.walk("."):
        if "node_modules" in dirs: dirs.remove("node_modules")
        for f in files:
            if f.endswith(".js"):
                js_files.append(os.path.join(root, f))
    
    for js in js_files:
        if not run_check(f"Syntax: {js}", f"node --check {js}"):
            success = False

    # 2. Version Consistency (Template)
    # 這裡未來可以加入比對 app_v135.js 與 server.js 版本號的邏輯
    
    # 3. Forbidden Patterns (FIXME, console.log)
    for js in js_files:
        with open(js, "r", encoding="utf-8") as f:
            content = f.read()
            if "FIXME" in content:
                print(f"[WARN] FIXME found in {js}")
            # console.log 暫不強制報錯，但可記錄

    if success:
        print("\n[RESULT] All critical checks passed! 🚀")
        sys.exit(0)
    else:
        print("\n[RESULT] Integrity check FAILED. Please fix the errors above.")
        sys.exit(1)

if __name__ == "__main__":
    main()
