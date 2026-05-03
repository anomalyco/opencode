import { runClientPython } from "@/lib/run-client-python"

export type ClientPythonProps = {
  sessionID: string
  messageID: string
  callID: string
  code: string
  timeout: number
  workdir?: string
}

/** Handles `session.client_python.request` from the global SSE stream: run Pyodide, POST `/session/.../client_python_result`. */
export async function dispatchClientPython(input: { base: string; props: ClientPythonProps }) {
  const url = `${input.base.replace(/\/+$/, "")}/session/${encodeURIComponent(input.props.sessionID)}/client_python_result`
  let ok = true
  let output = ""
  let exitCode = 0
  try {
    const r = await runClientPython(input.props.code, input.props.timeout)
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
