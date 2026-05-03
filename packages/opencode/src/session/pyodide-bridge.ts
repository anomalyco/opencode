import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Session } from "./index"
import type { MessageID, SessionID } from "./schema"

const log = Log.create({ service: "pyodide-bridge" })

type Row = {
  settle: (v: { output: string; exitCode: number }) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Row>()

function rowKey(sessionID: string, callID: string) {
  return `${sessionID}\t${callID}`
}

/** Server waits for the SPA to run Pyodide and POST `/session/.../pyodide_result`. */
export namespace PyodideBridge {
  export async function run(input: {
    sessionID: SessionID
    messageID: MessageID
    callID: string
    code: string
    timeout: number
    workdir?: string
  }) {
    const k = rowKey(input.sessionID, input.callID)
    if (pending.has(k)) throw new Error("duplicate pyodide request for the same tool call")

    const result = await new Promise<{ output: string; exitCode: number }>((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(k)) return
        pending.delete(k)
        resolve({ output: "Error: Timed out waiting for the browser to run Pyodide.", exitCode: 124 })
      }, input.timeout)
      pending.set(k, {
        settle: (v) => {
          clearTimeout(timer)
          pending.delete(k)
          resolve(v)
        },
        timer,
      })
      void Bus.publish(Session.Event.PyodideRequest, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        callID: input.callID,
        code: input.code,
        timeout: input.timeout,
        ...(input.workdir !== undefined ? { workdir: input.workdir } : {}),
      })
    })
    return result
  }

  export function submit(input: {
    sessionID: string
    callID: string
    ok: boolean
    output?: string
    exitCode?: number
  }) {
    const k = rowKey(input.sessionID, input.callID)
    const row = pending.get(k)
    if (!row) {
      log.warn("pyodide result for unknown call", { sessionID: input.sessionID, callID: input.callID })
      return false
    }
    clearTimeout(row.timer)
    pending.delete(k)
    if (!input.ok) {
      row.settle({ output: input.output ?? "Error: Pyodide run failed in the browser.", exitCode: input.exitCode ?? 1 })
      return true
    }
    row.settle({ output: input.output ?? "", exitCode: input.exitCode ?? 0 })
    return true
  }
}
