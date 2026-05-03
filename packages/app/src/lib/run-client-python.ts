import { loadPyodide, type PyodideInterface } from "pyodide"

let py: PyodideInterface | undefined

const STUB = `
class RangeRect:
    __slots__ = ("startRow", "endRow", "startColumn", "endColumn")
    def __init__(self, startRow=0, endRow=0, startColumn=0, endColumn=0):
        self.startRow = int(startRow)
        self.endRow = int(endRow)
        self.startColumn = int(startColumn)
        self.endColumn = int(endColumn)

class UniverSDK:
    __slots__ = ("_url",)
    def __init__(self, ws_url=None):
        self._url = ws_url
    def __repr__(self):
        return "UniverSDK"

import sys
import types
_m = types.ModuleType("veritly_univer_sdk")
_m.RangeRect = RangeRect
_m.UniverSDK = UniverSDK
sys.modules["veritly_univer_sdk"] = _m
`

async function runtime() {
  if (py) return py
  py = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" })
  await py.runPythonAsync(STUB)
  return py
}

/** Runs user `code` in Pyodide (first call downloads the runtime). */
export async function runClientPython(code: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
  const r = await runtime()
  const wrapped = `
import json
import sys
from io import StringIO
_buf = StringIO()
_err = StringIO()
_old_out, _old_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _buf, _err
_exit = 0
try:
    exec(compile(${JSON.stringify(code)}, "<micropython>", "exec"), {"__name__": "__main__"})
except SystemExit as e:
    c = e.code
    _exit = int(c) if isinstance(c, int) else 1
except BaseException as e:
    _err.write(repr(e) + "\\n")
    _exit = 1
finally:
    sys.stdout, sys.stderr = _old_out, _old_err
json.dumps({"stdout": _buf.getvalue(), "stderr": _err.getvalue(), "exit": _exit})
`
  const run = r.runPythonAsync(wrapped)
  const timed = new Promise<string>((resolve) => {
    setTimeout(() => resolve(""), timeoutMs)
  })
  const raw = await Promise.race([run, timed])
  if (raw === "") {
    return { output: "Error: Python run exceeded the tool timeout in the browser.", exitCode: 124 }
  }
  const parsed = JSON.parse(String(raw)) as { stdout: string; stderr: string; exit: number }
  const out = parsed.stdout + (parsed.stderr ? parsed.stderr : "")
  return { output: out, exitCode: parsed.exit }
}
