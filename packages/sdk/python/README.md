# Opencode Python SDK

This package provides a Python SDK for the Opencode API. It is generated using openapi-python-client (not Stainless).

Documentation

- Full docs: see `mkdocs` site under `packages/sdk/python/docs/`
- Preview locally:

```bash
uv run --project packages/sdk/python mkdocs serve -f packages/sdk/python/mkdocs.yml
```

Badges

- PyPI: https://img.shields.io/pypi/v/chalicecode-ai?style=flat-square

Requirements

- Python 3.8+
- uv (recommended) -> https://docs.astral.sh/uv/
- openapi-python-client (invoked via `uvx`)

Install uv

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Set up the environment (from this directory)

```bash
uv sync --dev
```

Generate client code (from CLI-generated spec)

```bash
# From repository root OR from this directory
uv run python packages/sdk/python/scripts/generate.py --source cli
```

Alternatively, fetch spec from a running server

```bash
uv run python packages/sdk/python/scripts/generate.py --source server --server-url http://localhost:4096/doc
```

This will:

1. Produce an OpenAPI spec from the local CLI or a running server
2. Run openapi-python-client (via `uvx`) to generate client code
3. Copy the generated Python package into src/chalice-code_ai

Usage (after generation)

```python
from chalice_ai import ChaliceCodeClient

client = ChaliceCodeClient(base_url="http://localhost:4096")
print(client.get_config())

# See examples/basic_usage.py for more details

# Streaming events (sync)
for event in client.subscribe_events():
    print(event)
    break

# Error handling and retries
# Set retries>0 to enable exponential backoff for transient errors like 429/5xx
client = ChaliceCodeClient(retries=2, backoff_factor=0.1)

# Async usage example
# uv run --project packages/sdk/python python - <<'PY'
# import asyncio
# from chalice_ai import ChaliceCodeClient
# async def main():
#     client = ChaliceCodeClient()
#     async for event in client.subscribe_events_async():
#         print(event)
#         break
# asyncio.run(main())
# PY
```

Notes

- We intentionally do not use Stainless for the Python SDK.
- The generator targets OpenAPI 3.1 emitted by the chalice server at /doc.
- See scripts/generate.py for details and customization points.
