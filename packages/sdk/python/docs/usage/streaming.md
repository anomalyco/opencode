# Streaming (SSE)

Subscribe to the event stream. The wrapper provides both sync and async interfaces.

```python
from chalice_ai import ChaliceCodeClient

client = ChaliceCodeClient()

# Sync streaming
for event in client.subscribe_events():
    print(event)
    break
```

Async variant:

```python
import asyncio
from chalice_ai import ChaliceCodeClient

async def main():
    client = ChaliceCodeClient()
    async for event in client.subscribe_events_async():
        print(event)
        break

asyncio.run(main())
```
