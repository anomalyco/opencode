# Publishing (maintainers)

Automated publishing runs on GitHub Releases.

Workflow

- Create a new Release (the tag value becomes the package version)
- The `publish-python-sdk` workflow will:
  - Generate the SDK from OpenAPI (CLI path)
  - Set the version in `pyproject.toml` and generator config
  - Build wheel/sdist and upload to PyPI

Prerequisites

- Repository secret: `PYPI_API_TOKEN`

Manual publish

```bash
# TestPyPI
REPOSITORY=testpypi PYPI_TOKEN=$TEST_PYPI_API_TOKEN \
uv run --project packages/sdk/python python packages/sdk/python/scripts/publish.py

# PyPI
REPOSITORY=pypi PYPI_TOKEN=$PYPI_API_TOKEN \
uv run --project packages/sdk/python python packages/sdk/python/scripts/publish.py
```
