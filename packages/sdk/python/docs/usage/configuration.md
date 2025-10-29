# Configuration

OpenCodeClient accepts common options for auth, timeouts, and retries.

```python
from opencode_ai import OpenCodeClient

client = OpenCodeClient(
    base_url="http://localhost:4096",
    token="pypi-or-other-token",
    auth_header_name="Authorization",
    auth_prefix="Bearer",
    timeout=30.0,  # seconds
    retries=2,
    backoff_factor=0.2,  # exponential backoff
)
```

- Auth: sets the header `{auth_header_name}: {auth_prefix} {token}` when `token` is provided
- Retries: retry on transient httpx.RequestError and 429/5xx
- Timeouts: passed to httpx.Timeout
