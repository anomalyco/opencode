# Testing

Run unit, mock, and integration tests.

```bash
# Sync dev dependencies
uv sync --dev --project packages/sdk/python

# Run tests
uv run --project packages/sdk/python pytest -q
```

Notes

- Integration test starts a headless opencode server via Bun in a subprocess
- SSE behavior is validated using real streaming from the server
