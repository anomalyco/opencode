import type { Hooks, Plugin } from "@opencode-ai/plugin"

export default (async ({ directory }) => createTradeHandoffBridgeHooks(directory)) satisfies Plugin

export function createTradeHandoffBridgeHooks(
  directory: string,
  options?: { startService?: (directory: string) => { kill(signal?: number | string): void; exited: Promise<number>; exitCode: number | null } },
): Hooks {
  let child: { kill(signal?: number | string): void; exited: Promise<number>; exitCode: number | null } | undefined
  let starting: Promise<boolean> | undefined
  let lastWarning = "trade memory handoff unavailable"

  const ensureService = () => {
    if (starting) return starting
    starting = Promise.resolve()
      .then(async () => {
        if (await isHealthy()) return true
        if (!isAutostartEnabled()) return false
        if (!child || child.exitCode !== null) child = (options?.startService ?? startService)(directory)
        await Bun.sleep(1200)
        return isHealthy()
      })
      .catch(() => false)
      .finally(() => {
        starting = undefined
      })
    return starting
  }

  const injectWarning = (target: string[]) => {
    if (!target.includes(lastWarning)) target.push(lastWarning)
  }

  const hooks: Hooks = {
    dispose: async () => {
      child?.kill()
      if (child) await child.exited
    },
    config: async () => {
      await ensureService()
    },
    event: async (input) => {
      const event = readModelSwitchedEvent(input.event)
      if (!event) return
      if (!event.sessionID) return
      if (!(await ensureService())) return
      await postJson("/handoff/model-switched", {
        session_id: event.sessionID,
        provider_id: event.model?.providerID,
        model_id: event.model?.modelID,
      }).catch(() => undefined)
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      if (!(await ensureService())) {
        injectWarning(output.system)
        return
      }
      const result = await postJson("/handoff/context", {
        session_id: input.sessionID,
        model_id: input.model.id,
      }).catch(() => undefined)
      const block = typeof result?.block === "string" ? result.block.trim() : ""
      if (block) {
        output.system.push(block)
        return
      }
      injectWarning(output.system)
    },
    "experimental.session.compacting": async (input, output) => {
      if (!(await ensureService())) {
        output.context.push(lastWarning)
        return
      }
      const result = await postJson("/handoff/context", {
        session_id: input.sessionID,
      }).catch(() => undefined)
      const block = typeof result?.block === "string" ? result.block.trim() : ""
      if (block) {
        output.context.push(block)
        return
      }
      output.context.push(lastWarning)
    },
  }

  return hooks

  async function isHealthy() {
    try {
      const response = await fetch(new URL("/health", serviceUrl()), { signal: AbortSignal.timeout(timeoutMs()) })
      return response.ok
    } catch {
      return false
    }
  }

  async function postJson(pathname: string, body: Record<string, unknown>) {
    const response = await fetch(new URL(pathname, serviceUrl()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    })
    if (!response.ok) throw new Error(`service request failed: ${response.status}`)
    return response.json()
  }
}

function startService(directory: string) {
  const command = parseServiceCommand(process.env.OPENCODE_TRADE_MEMORY_SERVICE_COMMAND)
  const proc = Bun.spawn(command ?? ["bun", ".opencode/mcp/trade-memory-server.ts", "--http"], {
    cwd: directory,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
  })
  return proc
}

export function parseServiceCommand(input: string | undefined) {
  const value = input?.trim()
  if (!value) return undefined
  return value.split(/\s+/).filter(Boolean)
}

function readModelSwitchedEvent(input: object): { sessionID?: string; model?: { providerID?: string; modelID?: string } } | undefined {
  const type = Reflect.get(input, "type")
  if (type !== "session.next.model.switched") return undefined
  const properties = Reflect.get(input, "properties")
  if (!properties || typeof properties !== "object") return undefined
  const model = Reflect.get(properties, "model")
  return {
    sessionID: typeof Reflect.get(properties, "sessionID") === "string" ? String(Reflect.get(properties, "sessionID")) : undefined,
    model:
      model && typeof model === "object"
        ? {
            providerID: typeof Reflect.get(model, "providerID") === "string" ? String(Reflect.get(model, "providerID")) : undefined,
            modelID: typeof Reflect.get(model, "modelID") === "string" ? String(Reflect.get(model, "modelID")) : undefined,
          }
        : undefined,
  }
}

function serviceUrl() {
  return process.env.OPENCODE_TRADE_MEMORY_SERVICE_URL ?? "http://127.0.0.1:19787"
}

function timeoutMs() {
  return Number(process.env.OPENCODE_TRADE_MEMORY_SERVICE_TIMEOUT_MS ?? 3000)
}

function isAutostartEnabled() {
  return process.env.OPENCODE_TRADE_MEMORY_SERVICE_AUTOSTART !== "false"
}
