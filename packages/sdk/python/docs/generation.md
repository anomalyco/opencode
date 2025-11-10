# Generation workflow

The SDK is generated from the Opencode server's OpenAPI 3.1 spec.

Two source modes are supported:

- CLI (default): runs `bun dev generate` to emit the OpenAPI JSON
- Server: fetches `http://localhost:4096/doc` from a running server

Generator command

```bash
# From repo root
uv run --project packages/sdk/python python packages/sdk/python/scripts/generate.py --source cli
# Or
uv run --project packages/sdk/python python packages/sdk/python/scripts/generate.py --source server --server-url http://localhost:4096/doc
```

Post-generation

- The generator injects `extras.py` (OpenCodeClient) and patches `__init__.py` to export it
- Code is formatted with `ruff` (imports) and `black`
