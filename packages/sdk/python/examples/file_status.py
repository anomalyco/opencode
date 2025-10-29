from opencode_ai import OpenCodeClient

client = OpenCodeClient()
files = client.file_status() or []
for f in files:
    print(f.path, f.type)
