export * as PendingTools from "./pending.js"

import type { CallToolResult } from "@modelcontextprotocol/server"
import type { ToolResult } from "./result.js"

interface Call {
  readonly name: string
  readonly result: PromiseWithResolvers<ToolResult.Result>
}

export interface Interface {
  readonly expect: (id: string, name: string) => void
  readonly before: (id: string, name: string) => void
  readonly call: (name: string) => Promise<CallToolResult>
  readonly resolve: (id: string, result: ToolResult.Result) => void
  readonly after: (id: string) => ToolResult.Result["replacement"]
  readonly clear: () => void
}

export function make(): Interface {
  const calls = new Map<string, Call>()
  const replacements = new Map<string, ToolResult.Result["replacement"]>()
  let next: string | undefined

  function expect(id: string, name: string) {
    const saved = calls.get(id)
    const call = saved ?? { name, result: Promise.withResolvers<ToolResult.Result>() }
    if (!saved) calls.set(id, call)
    if (call.name !== name) throw new Error(`Mismatched Claude tool call ${id}`)
    return call
  }

  return {
    expect,
    before(id: string, name: string) {
      expect(id, name)
      next = id
    },
    async call(name: string) {
      const id = next
      next = undefined
      if (!id) throw new Error("Claude invoked an OpenCode tool without its PreToolUse ID")
      const call = expect(id, name)
      const result = await call.result.promise
      if (result.replacement) replacements.set(id, result.replacement)
      calls.delete(id)
      return result.mcp
    },
    resolve(id: string, result: ToolResult.Result) {
      const call = calls.get(id)
      if (!call) throw new Error(`No waiting Claude tool call ${id}`)
      call.result.resolve(result)
    },
    after(id: string) {
      const replacement = replacements.get(id)
      replacements.delete(id)
      return replacement
    },
    // Call only after interrupt-and-drain; resolving these handlers earlier can start another model call.
    clear() {
      for (const call of calls.values()) {
        call.result.resolve({
          mcp: { isError: true, content: [{ type: "text", text: "Cancelled by user." }] },
          replacement: undefined,
        })
      }
      calls.clear()
      replacements.clear()
      next = undefined
    },
  }
}
