import { loadPyodide, type PyodideInterface } from "pyodide"

/** Same patch as `packages/app/package.json` `pyodide` dependency; CDN path must match. */
export const PYODIDE_VERSION = "0.26.4" as const

export const PYODIDE_CDN_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

export async function loadPyodideWithIndex(
  indexURL: string,
  opts?: { enableRunUntilComplete?: boolean },
): Promise<PyodideInterface> {
  return loadPyodide({
    indexURL,
    /** Lets `asyncio.run()` / `run_until_complete` block under WebLoop when JSPI is available (Chrome-family). */
    enableRunUntilComplete: opts?.enableRunUntilComplete ?? true,
  })
}

/** Base64 UTF-8 (browser-safe; embeds Python source without json.loads quirks). */
export function utf8ToB64(text: string): string {
  const u = new TextEncoder().encode(text)
  let bin = ""
  u.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

export async function veritlyUniverSdkInstalled(rt: PyodideInterface): Promise<boolean> {
  const tag = await rt.runPythonAsync(`
import sys
m = sys.modules.get("veritly_univer_sdk")
"yes" if m is not None and getattr(m, "UniverSDK", None) is not None else "no"
`)
  return String(tag) === "yes"
}

export type InstallVeritlyUniverSdkOpts = {
  source: string
  /** When set, runs `os.environ.setdefault("UNIVER_SDK_WS", value)` before install. */
  relayWsDefault?: string
}

/** Idempotent: skips if `veritly_univer_sdk` with `UniverSDK` is already loaded. */
export async function installVeritlyUniverSdkFromSource(
  rt: PyodideInterface,
  opts: InstallVeritlyUniverSdkOpts,
): Promise<void> {
  if (await veritlyUniverSdkInstalled(rt)) return

  const { source, relayWsDefault } = opts
  if (typeof source !== "string" || source.length < 50) {
    throw new Error("veritly_univer_sdk source is missing or too short; cannot install into Pyodide.")
  }

  const env =
    relayWsDefault === undefined || relayWsDefault === ""
      ? ""
      : `
import os
os.environ.setdefault("UNIVER_SDK_WS", ${JSON.stringify(relayWsDefault)})
`

  const b64 = utf8ToB64(source)
  await rt.runPythonAsync(`
import base64, sys, types
${env}
_src = base64.b64decode(${JSON.stringify(b64)}).decode("utf-8")
_m = types.ModuleType("veritly_univer_sdk")
_m.__file__ = "veritly_univer_sdk.py"
sys.modules["veritly_univer_sdk"] = _m
exec(compile(_src, "veritly_univer_sdk.py", "exec"), _m.__dict__)
import veritly_univer_sdk as _v
assert getattr(_v, "UniverSDK", None) is not None, "veritly_univer_sdk install produced no UniverSDK"
`)
}

/** Run `code` under stdout/stderr capture; result is JSON from Python (same as browser tool). */
export async function runCapturedPython(
  rt: PyodideInterface,
  code: string,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number }> {
  const wrapped = `
import asyncio
import json
import sys
from io import StringIO
_buf = StringIO()
_err = StringIO()
_old_out, _old_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _buf, _err
_st = {"exit": 0}
async def __runner():
    try:
        _g = {"__name__": "__main__", "__builtins__": __import__("builtins")}
        exec(compile(${JSON.stringify(code)}, "<pyodide>", "exec"), _g, _g)
        fn = _g.get("main")
        if callable(fn):
            if asyncio.iscoroutinefunction(fn):
                await fn()
            else:
                fn()
    except SystemExit as e:
        c = e.code
        _st["exit"] = int(c) if isinstance(c, int) else 1
    except BaseException as e:
        _err.write(repr(e) + "\\n")
        _st["exit"] = 1
try:
    await __runner()
except SystemExit as e:
    c = e.code
    _st["exit"] = int(c) if isinstance(c, int) else 1
except BaseException as e:
    _err.write(repr(e) + "\\n")
    _st["exit"] = 1
finally:
    sys.stdout, sys.stderr = _old_out, _old_err
json.dumps({"stdout": _buf.getvalue(), "stderr": _err.getvalue(), "exit": _st["exit"]})
`
  const run = rt.runPythonAsync(wrapped)
  const timed = new Promise<string>((resolve) => {
    setTimeout(() => resolve(""), timeoutMs)
  })
  const raw = await Promise.race([run, timed])
  if (raw === "") {
    return { output: "Error: Pyodide run exceeded the tool timeout in the browser.", exitCode: 124 }
  }
  const text = String(raw).trim()
  if (!text) {
    return {
      output:
        "Error: Pyodide returned an empty result (cannot parse JSON). Check the browser console for Pyodide errors.",
      exitCode: 1,
    }
  }
  let parsed: { stdout: string; stderr: string; exit: number }
  try {
    parsed = JSON.parse(text) as { stdout: string; stderr: string; exit: number }
  } catch {
    return {
      output: `Error: expected JSON from Pyodide wrapper, got: ${JSON.stringify(text.slice(0, 400))}`,
      exitCode: 1,
    }
  }
  const out = parsed.stdout + (parsed.stderr ? parsed.stderr : "")
  return { output: out, exitCode: parsed.exit }
}
