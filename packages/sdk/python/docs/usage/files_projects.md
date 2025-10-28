# Files & Projects

Access file status and project information.

```python
from opencode_ai import OpenCodeClient

client = OpenCodeClient()

# Projects
for p in client.list_projects() or []:
    print(p.id, p.directory)

# Current path
pinfo = client.get_path()
print(pinfo.directory)

# File status
files = client.file_status() or []
for f in files:
    print(f.path, f.type)
```
