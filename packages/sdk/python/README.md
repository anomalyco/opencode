# Opencode Python SDK

This package provides a Python SDK for the Opencode API. It is generated using openapi-python-client (not Stainless).

Status: scaffolding in place; generation wired up via scripts/generate.py.

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

Generate client code
```bash
# From repository root OR from this directory
uv run python packages/sdk/python/scripts/generate.py
```
This will:
1) Produce an OpenAPI spec from the local server/CLI
2) Run openapi-python-client (via `uvx`) to generate client code
3) Copy the generated Python package into src/opencode_ai

Usage (after generation)
```python
from opencode_ai import Client  # naming may differ depending on generator output

# See examples/basic_usage.py for more details
```

Notes
- We intentionally do not use Stainless for the Python SDK.
- The generator targets OpenAPI 3.1 emitted by the opencode server at /doc.
- See scripts/generate.py for details and customization points.
