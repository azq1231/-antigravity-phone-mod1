import urllib.request
import json

def check(port):
    try:
        url = f"http://127.0.0.1:{port}/json/list"
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            print(f"--- PORT {port} ---")
            print(json.dumps(data, indent=2))
            
            # Analysis
            workbench = next((t for t in data if 'workbench.html' in t.get('url', '')), None)
            page = next((t for t in data if t.get('type') == 'page'), None)
            
            if workbench:
                print(f"✅ Found workbench on {port}")
            elif page:
                print(f"⚠️ Found page (not workbench) on {port}: {page.get('title')}")
            else:
                print(f"❌ No page target found on {port}")
                
    except Exception as e:
        print(f"❌ Error checking port {port}: {e}")

check(9000)
check(9001)
