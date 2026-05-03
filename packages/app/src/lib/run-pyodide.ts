import type { PyodideInterface } from "pyodide"
import sdkSource from "../../../univer-sdk/python/veritly_univer_sdk.py?raw"
import {
  installVeritlyUniverSdkFromSource,
  loadPyodideWithIndex,
  PYODIDE_CDN_INDEX_URL,
  runCapturedPython,
} from "./pyodide-core"
import { browserUniverSdkWsUrl } from "./univer-sdk-ws-browser"

let py: PyodideInterface | undefined

async function runtime() {
  if (py) return py
  const next = await loadPyodideWithIndex(PYODIDE_CDN_INDEX_URL)
  if (typeof sdkSource !== "string" || sdkSource.length < 50) {
    throw new Error("veritly_univer_sdk.py did not bundle (?raw import empty). Pyodide cannot install the Univer SDK.")
  }
  await installVeritlyUniverSdkFromSource(next, {
    source: sdkSource,
    relayWsDefault: browserUniverSdkWsUrl(),
  })
  py = next
  return py
}

/** Runs user `code` in Pyodide (first load downloads the ~20MB runtime from the CDN). */
export async function runPyodide(code: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
  const rt = await runtime()
  return runCapturedPython(rt, code, timeoutMs)
}
