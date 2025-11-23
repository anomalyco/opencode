# Installation

Requirements

- Python 3.8+
- uv (recommended) -> https://docs.astral.sh/uv/

Install uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Project setup

```bash
# From repo root or this directory
uv sync --dev --project packages/sdk/python
```

Using pip (alternative)

```bash
pip install opencode-ai
```

Preview docs locally

```bash
# From repo root
uv run --project packages/sdk/python mkdocs serve -f packages/sdk/python/mkdocs.yml
```
