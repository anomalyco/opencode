import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { Effect, Layer, ServiceMap, Stream } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace Hook {
  const log = Log.create({ service: "hook" })

  // ─── Events published by Hook itself ───────────────────────────────────────

  export const Event = {
    Ran: BusEvent.define(
      "hook.ran",
      z.object({
        event: z.string(),
        command: z.string(),
        directive: z.enum(["continue", "block", "approve"]).optional(),
      }),
    ),
  }

  // ─── Hook config schema ─────────────────────────────────────────────────────

  export const HookDef = z.object({
    event: z.string().describe("Bus event type (e.g. 'session.start', 'tool.pre', 'tool.post')"),
    pattern: z.string().optional().describe("Optional tool/event name pattern filter"),
    command: z.string().describe("Shell command to execute"),
    timeout: z.number().int().min(100).optional().describe("Timeout in milliseconds (default: 10000)"),
  })
  export type HookDef = z.infer<typeof HookDef>

  export type Directive = { directive: "continue" | "block" | "approve"; reason?: string }

  /** Pattern matching: supports plain equality and `Tool(prefix:*)` syntax */
  export function matchesPattern(hook: HookDef, toolName?: string): boolean {
    if (!hook.pattern) return true
    if (!toolName) return false
    const fancy = hook.pattern.match(/^(\w+)\((.+)\*\)$/)
    if (fancy) {
      // Fancy syntax: ToolName(prefix:*) — match if tool name matches (input prefix is advisory)
      const [, name] = fancy
      return toolName.toLowerCase() === name.toLowerCase()
    }
    return toolName.toLowerCase() === hook.pattern.toLowerCase()
  }

  /** Execute a hook command, return the parsed directive (default: continue) */
  export async function run(hook: HookDef, env: Record<string, string> = {}): Promise<Directive> {
    const timeout = hook.timeout ?? 10_000
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const proc = Bun.spawn(["sh", "-c", hook.command], {
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
        signal: ctrl.signal,
      })
      const out = await new Response(proc.stdout).text().catch(() => "")
      await proc.exited.catch(() => undefined)
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out.trim()) as Partial<Directive>
        if (parsed.directive === "block" || parsed.directive === "approve") return parsed as Directive
      } catch {
        // not JSON — treat as continue
      }
      return { directive: "continue" }
    } catch (err) {
      clearTimeout(timer)
      if (ctrl.signal.aborted) log.warn("hook timed out", { command: hook.command, timeout })
      else log.warn("hook failed", { command: hook.command, err })
      return { directive: "continue" }
    }
  }

  // ─── Effect service ─────────────────────────────────────────────────────────

  export interface Interface {
    readonly hooks: () => Effect.Effect<HookDef[]>
    readonly fire: (input: {
      event: string
      toolName?: string
      env?: Record<string, string>
    }) => Effect.Effect<Directive>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Hook") {}

  export const layer: Layer.Layer<Service, never, Bus.Service | Config.Service | Session.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service

      const hooks = Effect.fn("Hook.hooks")(function* () {
        const cfg = yield* config.get()
        const base = cfg.hooks ?? []
        // 18.3: merge hooks contributed by plugin manifests
        const pluginHooks = (cfg.plugin_manifests ?? [])
          .filter((m) => m.enabled !== false)
          .flatMap((m) => m.hooks ?? [])
        return [...base, ...pluginHooks]
      })

      const fire = Effect.fn("Hook.fire")(function* (input: {
        event: string
        toolName?: string
        env?: Record<string, string>
      }) {
        const all = yield* hooks()
        const matching = all.filter((h) => h.event === input.event && matchesPattern(h, input.toolName))
        let final: Directive = { directive: "continue" }
        for (const hook of matching) {
          const result = yield* Effect.promise(() => run(hook, input.env ?? {}))
          yield* bus.publish(Event.Ran, { event: input.event, command: hook.command, directive: result.directive })
          if (result.directive === "block") {
            log.info("hook blocked", { event: input.event, command: hook.command })
            return result
          }
          if (result.directive === "approve") final = result
        }
        return final
      })

      // ── Bus subscriptions for hookable lifecycle events ───────────────────
      // Uses subscribeAll to handle SyncEvent-based events that are routed through Bus.
      yield* Effect.forkScoped(
        bus.subscribeAll().pipe(
          Stream.runForEach((evt) =>
            Effect.gen(function* () {
              const sid = (evt.properties as { sessionID?: string }).sessionID ?? ""
              if (evt.type === "session.created")
                yield* fire({ event: "session.start", env: { SESSION_ID: sid } }).pipe(Effect.ignore)
              else if (evt.type === "session.deleted")
                yield* fire({ event: "session.end", env: { SESSION_ID: sid } }).pipe(Effect.ignore)
              else if (evt.type === "session.compacted")
                yield* fire({ event: "session.post_compact", env: { SESSION_ID: sid } }).pipe(Effect.ignore)
            }).pipe(Effect.catchCause(() => Effect.void)),
          ),
        ),
      )

      return Service.of({ hooks, fire })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer)),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function fire(input: { event: string; toolName?: string; env?: Record<string, string> }) {
    return runPromise((svc) => svc.fire(input))
  }
}
