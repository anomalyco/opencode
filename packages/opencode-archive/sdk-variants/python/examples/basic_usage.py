# Basic usage example (placeholder)
# After generating the client, this should reflect actual client entrypoints.

try:
    from opencode_ai import client  # type: ignore
except Exception:  # pragma: no cover
    client = None


def main() -> None:
    if client is None:
        print("Client not generated yet. Run the generator first:")
        print("    uv run python packages/sdk/python/scripts/generate.py")
        return
    print("Replace this with real example code once the client is generated.")


if __name__ == "__main__":
    main()
