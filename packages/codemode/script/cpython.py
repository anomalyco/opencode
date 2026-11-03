"""Reference for the checked-in Code Mode fixtures only. This process is not a sandbox."""

import asyncio
import contextlib
import io
import json
import sys
import textwrap
from types import SimpleNamespace


async def run(source):
    calls = []
    logs = io.StringIO()

    async def echo(data=None, **kwargs):
        value = (kwargs if data is None else data)["value"]
        calls.append("echo")
        return value

    scope = {"tools": SimpleNamespace(echo=echo)}
    with contextlib.redirect_stdout(logs):
        try:
            # Code Mode takes an implicit async function body, including top-level return.
            exec("async def fixture():\n" + textwrap.indent(source, "    "), scope)
            result = {"value": await scope["fixture"]()}
        except Exception as exc:
            result = {"raises": type(exc).__name__}
    return {**result, "calls": calls, "logs": logs.getvalue().splitlines()}


if sys.implementation.name != "cpython":
    sys.exit("test:cpython requires CPython 3")

sources = json.loads(sys.stdin.buffer.read())
print(json.dumps({"python": sys.version.split()[0], "results": [asyncio.run(run(code)) for code in sources]}, allow_nan=False))
