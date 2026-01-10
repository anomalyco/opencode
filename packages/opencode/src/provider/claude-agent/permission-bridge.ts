import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { PermissionNext } from "@/permission/next"
import { Log } from "@/util/log"

const log = Log.create({ service: "claude-agent.permission-bridge" })

export namespace PermissionBridge {
  export interface PendingRequest {
    requestID: string
    toolName: string
    toolInput: unknown
    patterns: string[]
    resolve: (reply: "once" | "always" | "reject") => void
    reject: (error: Error) => void
  }

  export function create(sessionID: string) {
    const pending: Map<string, PendingRequest> = new Map()
    let isListening = false

    function startListening() {
      if (isListening) return
      isListening = true

      Bus.subscribe(PermissionNext.Event.Replied, ({ properties }) => {
        const request = pending.get(properties.requestID)
        if (!request) return

        log.debug("permission reply received", {
          requestID: properties.requestID,
          reply: properties.reply,
          toolName: request.toolName,
        })

        request.resolve(properties.reply)
        pending.delete(properties.requestID)
      })
    }

    startListening()

    async function ask(
      toolName: string,
      toolInput: unknown,
      signal: AbortSignal,
    ): Promise<"once" | "always" | "reject"> {
      const patterns = extractPatterns(toolName, toolInput)
      const requestID = Identifier.ascending("permission")

      log.debug("asking permission", {
        requestID,
        toolName,
        patterns,
        sessionID,
      })

      const responsePromise = new Promise<"once" | "always" | "reject">((resolve, reject) => {
        const pendingRequest: PendingRequest = {
          requestID,
          toolName,
          toolInput,
          patterns,
          resolve,
          reject,
        }
        pending.set(requestID, pendingRequest)

        signal.addEventListener("abort", () => {
          pending.delete(requestID)
          reject(new Error("Permission request aborted"))
        })
      })

      await PermissionNext.ask({
        permission: toolName,
        patterns,
        metadata: toolInput as Record<string, unknown>,
        always: patterns,
        sessionID,
        ruleset: [],
      })

      try {
        const result = await responsePromise
        log.debug("permission resolved", {
          requestID,
          result,
          toolName,
        })
        return result
      } finally {
        pending.delete(requestID)
      }
    }

    return {
      ask,
    }
  }

  function extractPatterns(toolName: string, toolInput: unknown): string[] {
    if (!toolInput || typeof toolInput !== "object") return ["*"]

    const input = toolInput as Record<string, unknown>

    switch (toolName) {
      case "Read":
      case "Write":
      case "Edit": {
        const filePath = typeof input.file_path === "string" ? input.file_path : undefined
        return filePath ? [filePath] : ["*"]
      }

      case "Bash": {
        const command = typeof input.command === "string" ? input.command : undefined
        return command ? [command] : ["bash *"]
      }

      case "WebFetch": {
        const url = typeof input.url === "string" ? input.url : undefined
        return url ? [url] : ["webfetch *"]
      }

      case "WebSearch": {
        const query = typeof input.query === "string" ? input.query : undefined
        return query ? [query] : ["websearch *"]
      }

      case "Glob":
      case "Grep": {
        const patterns: string[] = []
        const pattern = typeof input.pattern === "string" ? input.pattern : undefined
        const path = typeof input.path === "string" ? input.path : undefined
        if (path) patterns.push(path)
        if (pattern) patterns.push(pattern)
        return patterns.length > 0 ? patterns : ["*"]
      }

      default:
        return ["*"]
    }
  }
}