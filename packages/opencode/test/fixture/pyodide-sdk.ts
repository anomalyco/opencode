import { Bus } from "../../src/bus"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { PyodideBridge } from "../../src/session/pyodide-bridge"

export type PyodideSdkMap = (code: string) => { output: string; exitCode: number }

/** Fake browser: answers `session.pyodide.request` with mapped stdout (same contract as the SPA). */
export async function withPyodideSdk<T>(input: {
  workspace: string
  map?: PyodideSdkMap
  fn: () => Promise<T>
}): Promise<T> {
  const map =
    input.map ??
    ((code: string) => {
      if (code.includes("print('test')")) return { output: "test\n", exitCode: 0 }
      if (code.includes("print('hello')")) return { output: "hello\n", exitCode: 0 }
      if (code.includes("print('foo')") && code.includes("print('bar')")) return { output: "foo\nbar\n", exitCode: 0 }
      const m = code.match(/for i in range\((\d+)\)/)
      if (m) {
        const n = Number(m[1])
        return { output: Array.from({ length: n }, (_, i) => String(i + 1)).join("\n") + "\n", exitCode: 0 }
      }
      const bytes = code.match(/print\('a' \* (\d+)\)/)
      if (bytes) return { output: "a".repeat(Number(bytes[1])) + "\n", exitCode: 0 }
      return { output: "", exitCode: 0 }
    })
  return Instance.provide({
    workspace: input.workspace,
    fn: async () => {
      const unsub = Bus.subscribe(Session.Event.PyodideRequest, (ev) => {
        queueMicrotask(() => {
          const r = map(ev.properties.code)
          PyodideBridge.submit({
            sessionID: ev.properties.sessionID,
            callID: ev.properties.callID,
            ok: true,
            output: r.output,
            exitCode: r.exitCode,
          })
        })
      })
      try {
        return await input.fn()
      } finally {
        unsub()
      }
    },
  })
}
