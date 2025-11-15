# Files & Projects

Access file status and project information.

```python
from chalice_ai import ChaliceCodeClient

client = ChaliceCodeClient()

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
