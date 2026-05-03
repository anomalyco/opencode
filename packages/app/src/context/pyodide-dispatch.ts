import { runPyodide } from "@/lib/run-pyodide"

export type PyodideSseProps = {
  sessionID: string
  messageID: string
  callID: string
  code: string
  timeout: number
  workdir?: string
}

/** Handles `session.pyodide.request` from the global SSE stream: run Pyodide, POST `/session/.../pyodide_result`. */
export async function dispatchPyodideRequest(input: { base: string; props: PyodideSseProps }) {
  const url = `${input.base.replace(/\/+$/, "")}/session/${encodeURIComponent(input.props.sessionID)}/pyodide_result`
  let ok = true
  let output = ""
  let exitCode = 0
  try {
    const r = await runPyodide(input.props.code, input.props.timeout)
    output = r.output
    exitCode = r.exitCode
  } catch (err) {
    ok = false
    output = err instanceof Error ? err.message : String(err)
    exitCode = 1
  }
  await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callID: input.props.callID, ok, output, exitCode }),
  })
}
