import winreg

def search_keys(hive, key_path, search_term):
    found_paths = []
    try:
        with winreg.OpenKey(hive, key_path) as key:
            i = 0
            while True:
                try:
                    sub_key_name = winreg.EnumKey(key, i)
                    full_path = f"{key_path}\\{sub_key_name}"
                    
                    # Check Key Name
                    if search_term.lower() in sub_key_name.lower():
                        found_paths.append((hive, full_path, "KEY_NAME_MATCH"))
                        print(f"FOUND (Key Name): {full_path}")
                    
                    # Check Default Value (Display Name)
                    try:
                        with winreg.OpenKey(hive, full_path) as subkey:
                            # Default value is empty string name
                            val, type = winreg.QueryValueEx(subkey, "")
                            if isinstance(val, str) and search_term.lower() in val.lower():
                                found_paths.append((hive, full_path, "VALUE_MATCH"))
                                print(f"FOUND (Value Match): {full_path} = {val}")
                    except OSError:
                        pass

                    i += 1
                except OSError:
                    break
    except Exception as e:
        # print(f"Error accessing {key_path}: {e}")
        pass
    return found_paths

def delete_key(hive, key_path):
    print(f"Attempting to delete: {key_path}")
    try:
        # Delete subkeys first
        with winreg.OpenKey(hive, key_path, 0, winreg.KEY_ALL_ACCESS) as key:
            while True:
                try:
                    sub_key = winreg.EnumKey(key, 0)
                    delete_key(hive, f"{key_path}\\{sub_key}")
                except OSError:
                    break
        
        # Winreg deletekey only works if no subkeys
        winreg.DeleteKey(hive, key_path)
        print(f"SUCCESS: Deleted {key_path}")
    except Exception as e:
        print(f"FAILED to delete {key_path}: {e}")

targets = [
    (winreg.HKEY_CURRENT_USER, r"Software\Classes\Directory\shell"),
    (winreg.HKEY_CURRENT_USER, r"Software\Classes\Directory\Background\shell"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\Directory\shell"),
    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\Directory\Background\shell"),
    (winreg.HKEY_CLASSES_ROOT, r"Directory\shell"),
    (winreg.HKEY_CLASSES_ROOT, r"Directory\Background\shell")
]

print("Starting deep scan...")
for hive, path in targets:
    # search for 'Antigravity' string in keys OR values
    keys = search_keys(hive, path, "Antigravity")
    for h, k, reasoning in keys:
        delete_key(h, k)

print("Scan complete.")
