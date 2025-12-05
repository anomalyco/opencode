# Quickstart

Create a client and make your first calls.

```python
from opencode_ai import OpenCodeClient

client = OpenCodeClient(base_url="http://localhost:4096")

# List projects
for p in client.list_projects() or []:
    print(p.id, p.directory)

# Get path info
path = client.get_path()
print(path.directory)

# Stream events (sync)
for event in client.subscribe_events():
    print(event)
    break
```
