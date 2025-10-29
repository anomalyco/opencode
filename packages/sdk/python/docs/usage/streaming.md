# Streaming (SSE)

Subscribe to the event stream. The wrapper provides both sync and async interfaces.

```python
from opencode_ai import OpenCodeClient

client = OpenCodeClient()

# Sync streaming
for event in client.subscribe_events():
    print(event)
    break
```

Async variant:

```python
import asyncio
from opencode_ai import OpenCodeClient

async def main():
    client = OpenCodeClient()
    async for event in client.subscribe_events_async():
        print(event)
        break

asyncio.run(main())
```
