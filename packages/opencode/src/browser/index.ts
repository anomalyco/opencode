import fs from "fs/promises"
import path from "path"
import z from "zod"
import semver from "semver"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { type SessionID, SessionID as Session } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Process } from "@/util/process"
import { Effect, Layer, ServiceMap } from "effect"

export namespace Browser {
  const log = Log.create({ service: "browser" })

  const root = path.join(Global.Path.state, "browser")
  const profiles = path.join(root, "profiles")

  type Socket = {
    readyState: number
    send: (data: string | Uint8Array | ArrayBuffer) => void
    close: (code?: number, reason?: string) => void
  }

  const Status = z.object({
    enabled: z.boolean(),
    port: z.number().int().optional().nullable(),
    connected: z.boolean().optional(),
    screencasting: z.boolean().optional(),
  })
  const RawTab = z.object({
    active: z.boolean().optional().nullable(),
    index: z.number().int().nonnegative(),
    title: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
  })
  const RawTabs = z.object({
    tabs: z.array(RawTab),
  })
  const Envelope = z.object({
    success: z.boolean().optional(),
    data: z.unknown().optional(),
    error: z.string().optional().nullable(),
  })
  const Stream = z.object({
    stream: Status,
  })

  export const Info = z
    .object({
      sessionID: Session.zod,
      profile: z.string(),
      enabled: z.boolean(),
      port: z.number().int().optional(),
      connected: z.boolean().optional(),
      screencasting: z.boolean().optional(),
    })
    .meta({ ref: "Browser" })

  export type Info = z.infer<typeof Info>

  export const Tab = z
    .object({
      active: z.boolean(),
      index: z.number().int().nonnegative(),
      title: z.string(),
      type: z.string().optional(),
      url: z.string(),
    })
    .meta({ ref: "BrowserTab" })

  export type Tab = z.infer<typeof Tab>

  export const Tabs = z
    .object({
      sessionID: Session.zod,
      tabs: z.array(Tab),
    })
    .meta({ ref: "BrowserTabs" })

  export type Tabs = z.infer<typeof Tabs>

  export const Event = {
    Updated: BusEvent.define("browser.updated", z.object({ info: Info })),
  }

  type State = {
    bin?: string
    installed?: boolean
    queue: Map<SessionID, Promise<void>>
  }

  export interface Interface {
    readonly env: (sessionID: SessionID) => Effect.Effect<Record<string, string>>
    readonly status: (sessionID: SessionID) => Effect.Effect<Info>
    readonly enable: (input: { sessionID: SessionID; port?: number }) => Effect.Effect<Info>
    readonly disable: (sessionID: SessionID) => Effect.Effect<Info>
    readonly tabs: (sessionID: SessionID) => Effect.Effect<Tabs>
    readonly select: (input: {
      sessionID: SessionID
      index: number
      width?: number
      height?: number
      scale?: number
    }) => Effect.Effect<Tabs>
    readonly viewport: (input: { sessionID: SessionID; width: number; height: number; scale?: number }) => Effect.Effect<Info>
    readonly open: (input: { sessionID: SessionID; url: string }) => Effect.Effect<Info>
    readonly close: (sessionID: SessionID) => Effect.Effect<Info>
    readonly remove: (sessionID: SessionID) => Effect.Effect<void>
    readonly connect: (
      sessionID: SessionID,
      ws: Socket,
    ) => Effect.Effect<{ onMessage: (message: string | ArrayBuffer) => void; onClose: () => void }>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Browser") {}

  const ParseError = new Error("Failed to parse agent-browser JSON response")
  const Min = "0.25.3"

  const profile = (sessionID: SessionID) => path.join(profiles, sessionID)

  function parse(raw: string) {
    const text = raw.trim()
    if (!text) throw ParseError

    try {
      return JSON.parse(text)
    } catch {
      const first = text.indexOf("{")
      const last = text.lastIndexOf("}")
      if (first === -1 || last === -1 || last <= first) throw ParseError
      return JSON.parse(text.slice(first, last + 1))
    }
  }

  function statusPayload(raw: unknown) {
    const top = Status.safeParse(raw)
    if (top.success) return top.data

    const env = Envelope.safeParse(raw)
    if (env.success) {
      if (env.data.success === false) {
        throw new Error(env.data.error || "agent-browser status failed")
      }

      const nested = Status.safeParse(env.data.data)
      if (nested.success) return nested.data

      const wrapped = Stream.safeParse(env.data.data)
      if (wrapped.success) return wrapped.data.stream
    }

    const stream = Stream.safeParse(raw)
    if (stream.success) return stream.data.stream

    throw ParseError
  }

  function tabPayload(raw: unknown) {
    const top = RawTabs.safeParse(raw)
    if (top.success) return top.data

    const env = Envelope.safeParse(raw)
    if (env.success) {
      if (env.data.success === false) {
        throw new Error(env.data.error || "agent-browser tab list failed")
      }

      const nested = RawTabs.safeParse(env.data.data)
      if (nested.success) return nested.data
    }

    throw ParseError
  }

  function detail(out: { code: number; stdout: Buffer; stderr: Buffer }) {
    const err = out.stderr.toString().trim()
    if (err) return err
    const text = out.stdout.toString().trim()
    if (text) return text
    return `agent-browser exited with code ${out.code}`
  }

  function locked(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes("SingletonLock") || msg.includes("ProcessSingleton")
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Browser.state")(function* () {
          yield* Effect.promise(() => fs.mkdir(profiles, { recursive: true }))
          return { queue: new Map() }
        }),
      )

      const bin = Effect.fn("Browser.bin")(function* () {
        const s = yield* InstanceState.get(state)
        if (s.bin) return s.bin

        const check = Effect.fn("Browser.check")(function* (cmd: string) {
          const out = yield* Effect.promise(() => Process.run([cmd, "--version"], { nothrow: true }))
          if (out.code !== 0) return

          const raw = out.stdout.toString().trim()
          const value = semver.coerce(raw)?.version
          if (!value) return
          if (semver.lt(value, Min)) return
          return cmd
        })

        const env = process.env.OPENCODE_AGENT_BROWSER_BIN
        if (env) {
          const out = yield* check(env)
          if (!out) throw new Error(`OPENCODE_AGENT_BROWSER_BIN is set but invalid or older than ${Min}: ${env}`)
          s.bin = out
          return out
        }

        const local = yield* Effect.promise(() => Npm.which("agent-browser")).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (local) {
          const out = yield* check(local)
          if (out) {
            s.bin = out
            return out
          }
        }

        const global = yield* check("agent-browser")
        if (global) {
          s.bin = global
          return global
        }

        throw new Error(
          [
            `agent-browser >= ${Min} was not found.`,
            "Install it with `npm install -g agent-browser@latest playwright`.",
            "Then run `agent-browser install`.",
          ].join("\n"),
        )
      })

      const install = Effect.fn("Browser.install")(function* () {
        const s = yield* InstanceState.get(state)
        if (s.installed) return
        const cmd = yield* bin()
        const out = yield* Effect.promise(() => Process.run([cmd, "install"], { nothrow: true }))
        if (out.code !== 0) {
          throw new Error(
            [
              "agent-browser install failed.",
              "Run `agent-browser install` manually to install browser dependencies.",
              detail(out),
            ].join("\n"),
          )
        }
        s.installed = true
      })

      const raw = (sessionID: SessionID) => ({
        AGENT_BROWSER_SESSION: sessionID,
        AGENT_BROWSER_PROFILE: profile(sessionID),
      })

      const vars = Effect.fn("Browser.vars")(function* (sessionID: SessionID) {
        const dir = profile(sessionID)
        yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
        return raw(sessionID)
      })

      const call = Effect.fn("Browser.call")(function* (sessionID: SessionID, args: string[]) {
        const s = yield* InstanceState.get(state)
        const prev = s.queue.get(sessionID) ?? Promise.resolve()
        let release = () => {}
        const hold = new Promise<void>((ok) => {
          release = ok
        })
        const slot = prev.then(() => hold)
        s.queue.set(sessionID, slot)
        yield* Effect.promise(() => prev)
        try {
          yield* install()
          const cmd = yield* bin()
          const env = {
            ...process.env,
            ...(yield* vars(sessionID)),
          }
          const out = yield* Effect.promise(() => Process.run([cmd, ...args], { nothrow: true, env }))
          if (out.code !== 0) throw new Error(detail(out))
          return out.stdout.toString()
        } finally {
          release()
          if (s.queue.get(sessionID) === slot) s.queue.delete(sessionID)
        }
      })

      const status = Effect.fn("Browser.status")(function* (sessionID: SessionID) {
        const json = yield* call(sessionID, ["stream", "status", "--json"])
        const data = statusPayload(parse(json))

        return {
          sessionID,
          profile: profile(sessionID),
          enabled: data.enabled,
          ...(data.port ? { port: data.port } : {}),
          ...(data.connected !== undefined ? { connected: data.connected } : {}),
          ...(data.screencasting !== undefined ? { screencasting: data.screencasting } : {}),
        } satisfies Info
      })

      const publish = Effect.fn("Browser.publish")(function* (sessionID: SessionID) {
        const info = yield* status(sessionID)
        yield* Effect.promise(() => Bus.publish(Event.Updated, { info }))
        return info
      })

      const enable = Effect.fn("Browser.enable")(function* (input: { sessionID: SessionID; port?: number }) {
        const args = ["stream", "enable", ...(input.port ? ["--port", String(input.port)] : [])]
        let fail: unknown
        yield* call(input.sessionID, args).pipe(
          Effect.catch((err) => {
            fail = err
            return Effect.succeed("")
          }),
        )
        if (fail) {
          if (!locked(fail)) throw fail
          log.info("browser profile lock detected, retrying", { sessionID: input.sessionID })
          const info = yield* status(input.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info?.enabled || !info.port) {
            yield* call(input.sessionID, ["close"]).pipe(Effect.catch(() => Effect.succeed("")))
            yield* call(input.sessionID, args)
          }
        }
        return yield* publish(input.sessionID)
      })

      const disable = Effect.fn("Browser.disable")(function* (sessionID: SessionID) {
        yield* call(sessionID, ["stream", "disable"])
        return yield* publish(sessionID)
      })

      const tabs = Effect.fn("Browser.tabs")(function* (sessionID: SessionID) {
        const json = yield* call(sessionID, ["tab", "list", "--json"])
        const data = tabPayload(parse(json))
        return {
          sessionID,
          tabs: data.tabs.map((tab) => ({
            active: tab.active === true,
            index: tab.index,
            title: tab.title ?? "",
            url: tab.url ?? "",
            ...(tab.type ? { type: tab.type } : {}),
          })),
        } satisfies Tabs
      })

      const live = Effect.fn("Browser.live")(function* (sessionID: SessionID, index: number) {
        const data = yield* tabs(sessionID)
        return data.tabs.some((tab) => tab.index === index && tab.active)
      })

      const wait = Effect.fn("Browser.wait")(function* (sessionID: SessionID, index: number) {
        const end = Date.now() + 1000
        while (true) {
          const on = yield* live(sessionID, index).pipe(Effect.catch(() => Effect.succeed(false)))
          if (on) return true
          if (Date.now() >= end) return false
          yield* Effect.sleep("80 millis")
        }
      })

      const select = Effect.fn("Browser.select")(function* (input: {
        sessionID: SessionID
        index: number
        width?: number
        height?: number
        scale?: number
      }) {
        const index = Math.max(0, Math.floor(input.index))
        const tab = String(index)
        yield* call(input.sessionID, ["tab", tab, "--json"])
        const on = yield* wait(input.sessionID, index)
        if (!on) {
          yield* call(input.sessionID, ["tab", tab, "--json"]).pipe(Effect.catch(() => Effect.succeed("")))
          yield* wait(input.sessionID, index).pipe(Effect.catch(() => Effect.succeed(false)))
        }
        if (input.width && input.height) {
          const args = [
            "set",
            "viewport",
            String(Math.max(1, Math.floor(input.width))),
            String(Math.max(1, Math.floor(input.height))),
            ...(input.scale ? [String(input.scale)] : []),
          ]
          yield* call(input.sessionID, args)
          const check = yield* wait(input.sessionID, index)
          if (!check) {
            yield* call(input.sessionID, ["tab", tab, "--json"]).pipe(Effect.catch(() => Effect.succeed("")))
            yield* call(input.sessionID, args).pipe(Effect.catch(() => Effect.succeed("")))
          }
        }
        return yield* tabs(input.sessionID)
      })

      const viewport = Effect.fn("Browser.viewport")(function* (input: {
        sessionID: SessionID
        width: number
        height: number
        scale?: number
      }) {
        const args = [
          "set",
          "viewport",
          String(Math.max(1, Math.floor(input.width))),
          String(Math.max(1, Math.floor(input.height))),
          ...(input.scale ? [String(input.scale)] : []),
        ]
        yield* call(input.sessionID, args)
        return yield* publish(input.sessionID)
      })

      const open = Effect.fn("Browser.open")(function* (input: { sessionID: SessionID; url: string }) {
        yield* call(input.sessionID, ["open", input.url])
        return yield* publish(input.sessionID)
      })

      const close = Effect.fn("Browser.close")(function* (sessionID: SessionID) {
        yield* call(sessionID, ["close"])
        return yield* publish(sessionID)
      })

      const remove = Effect.fn("Browser.remove")(function* (sessionID: SessionID) {
        const cmd = yield* bin()
        const env = { ...process.env, ...raw(sessionID) }
        yield* Effect.promise(() =>
          Promise.all([
            Process.run([cmd, "stream", "disable"], { nothrow: true, env }),
            Process.run([cmd, "close"], { nothrow: true, env }),
          ]),
        )
        yield* Effect.promise(() => fs.rm(profile(sessionID), { recursive: true, force: true }))
      })

      const connect: Interface["connect"] = (sessionID: SessionID, ws: Socket) =>
        Effect.gen(function* () {
          const first = yield* status(sessionID).pipe(Effect.catch(() => enable({ sessionID })))
          const info = first.enabled ? first : yield* enable({ sessionID })
          if (!info.port) throw new Error("agent-browser stream is enabled but no port is available")

          const conn = new WebSocket(`ws://127.0.0.1:${info.port}`)

          const send = (data: unknown) => {
            if (ws.readyState !== 1) return
            if (typeof data === "string") {
              ws.send(data)
              return
            }
            if (data instanceof ArrayBuffer) {
              ws.send(data)
              return
            }
            if (data instanceof Uint8Array) ws.send(data)
          }

          const end = () => {
            if (conn.readyState === WebSocket.CLOSED || conn.readyState === WebSocket.CLOSING) return
            conn.close()
          }

          conn.addEventListener("message", (event) => {
            send(event.data)
          })

          conn.addEventListener("error", () => {
            if (ws.readyState === 1) ws.close(1011, "browser stream error")
            end()
          })

          conn.addEventListener("close", () => {
            if (ws.readyState === 1) ws.close(1000, "browser stream ended")
          })

          log.info("browser stream connected", { sessionID, port: info.port })

          return {
            onMessage: (_message: string | ArrayBuffer) => {
              // v1 observer mode: do not forward input to browser runtime
            },
            onClose: () => {
              log.info("browser stream disconnected", { sessionID, port: info.port })
              end()
            },
          }
        }).pipe(Effect.orDie)

      return Service.of({ env: vars, status, enable, disable, tabs, select, viewport, open, close, remove, connect })
    }),
  )

  const { runPromise } = makeRuntime(Service, layer)

  export async function env(sessionID: SessionID) {
    return runPromise((svc) => svc.env(sessionID))
  }

  export async function status(sessionID: SessionID) {
    return runPromise((svc) => svc.status(sessionID))
  }

  export async function enable(input: { sessionID: SessionID; port?: number }) {
    return runPromise((svc) => svc.enable(input))
  }

  export async function disable(sessionID: SessionID) {
    return runPromise((svc) => svc.disable(sessionID))
  }

  export async function tabs(sessionID: SessionID) {
    return runPromise((svc) => svc.tabs(sessionID))
  }

  export async function select(input: {
    sessionID: SessionID
    index: number
    width?: number
    height?: number
    scale?: number
  }) {
    return runPromise((svc) => svc.select(input))
  }

  export async function open(input: { sessionID: SessionID; url: string }) {
    return runPromise((svc) => svc.open(input))
  }

  export async function viewport(input: { sessionID: SessionID; width: number; height: number; scale?: number }) {
    return runPromise((svc) => svc.viewport(input))
  }

  export async function close(sessionID: SessionID) {
    return runPromise((svc) => svc.close(sessionID))
  }

  export async function remove(sessionID: SessionID) {
    return runPromise((svc) => svc.remove(sessionID))
  }

  export async function connect(sessionID: SessionID, ws: Socket) {
    return runPromise((svc) => svc.connect(sessionID, ws))
  }
}
