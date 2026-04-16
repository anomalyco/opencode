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

  export type Socket = {
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

  export const Update = z
    .object({
      sessionID: Session.zod,
      info: Info.optional(),
      tabs: Tabs.optional(),
    })
    .meta({ ref: "BrowserUpdate" })

  export type Update = z.infer<typeof Update>

  export const Event = {
    Updated: BusEvent.define("browser.updated", Update),
  }

  type Cell = {
    info?: Info
    tabs?: Tabs
  }

  type Slot = {
    refs: number
    poll?: ReturnType<typeof setTimeout>
    tabs?: string
    timer?: ReturnType<typeof setTimeout>
  }

  type State = {
    bin?: string
    installed?: boolean
    cache: Map<SessionID, Cell>
    queue: Map<SessionID, Promise<void>>
    live: Map<SessionID, Slot>
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
  const Idle = 30_000
  const Poll = 1_200

  const profile = (sessionID: SessionID) => path.join(profiles, sessionID)
  const snap = (data: Tabs) => JSON.stringify(data.tabs)
  const makeInfo = (sessionID: SessionID, data: z.infer<typeof Status>) =>
    ({
      sessionID,
      profile: profile(sessionID),
      enabled: data.enabled,
      ...(data.port ? { port: data.port } : {}),
      ...(data.connected !== undefined ? { connected: data.connected } : {}),
      ...(data.screencasting !== undefined ? { screencasting: data.screencasting } : {}),
    }) satisfies Info

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

  function unwrap(raw: unknown, err: string) {
    const env = Envelope.safeParse(raw)
    if (!env.success) return raw
    if (env.data.success === false) throw new Error(env.data.error || err)
    return env.data.data
  }

  function statusPayload(raw: unknown) {
    const data = unwrap(raw, "agent-browser status failed")
    const top = Status.safeParse(data)
    if (top.success) return top.data

    const stream = Stream.safeParse(data)
    if (stream.success) return stream.data.stream

    throw ParseError
  }

  function tabPayload(raw: unknown) {
    const data = unwrap(raw, "agent-browser tab list failed")
    const top = RawTabs.safeParse(data)
    if (top.success) return top.data

    throw ParseError
  }

  function focusPayload(raw: unknown) {
    const data = unwrap(raw, "agent-browser tab select failed")
    const top = RawTab.safeParse(data)
    if (top.success) return top.data

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

  const enableArgs = (port?: number) => ["stream", "enable", "--json", ...(port ? ["--port", String(port)] : [])]
  const tabArgs = (index: number) => ["tab", String(Math.max(0, Math.floor(index))), "--json"]
  const viewportArgs = (input: { width: number; height: number; scale?: number }) => [
    "set",
    "viewport",
    String(Math.max(1, Math.floor(input.width))),
    String(Math.max(1, Math.floor(input.height))),
    ...(input.scale ? [String(input.scale)] : []),
  ]
  const pack = (sessionID: SessionID, data: z.infer<typeof RawTabs>) =>
    ({
      sessionID,
      tabs: data.tabs.map((tab) => ({
        active: tab.active === true,
        index: tab.index,
        title: tab.title ?? "",
        url: tab.url ?? "",
        ...(tab.type ? { type: tab.type } : {}),
      })),
    }) satisfies Tabs
  const mark = (data: Tabs, next: z.infer<typeof RawTab>) => {
    let seen = false
    const tabs = data.tabs.map((tab) => {
      if (tab.index !== next.index) {
        if (!tab.active) return tab
        return { ...tab, active: false }
      }
      seen = true
      return {
        active: true,
        index: next.index,
        title: next.title ?? tab.title,
        url: next.url ?? tab.url,
        ...(next.type ? { type: next.type } : tab.type ? { type: tab.type } : {}),
      }
    })
    if (seen) return { sessionID: data.sessionID, tabs } satisfies Tabs

    return {
      sessionID: data.sessionID,
      tabs: [
        ...tabs,
        {
          active: true,
          index: next.index,
          title: next.title ?? "",
          url: next.url ?? "",
          ...(next.type ? { type: next.type } : {}),
        },
      ],
    } satisfies Tabs
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make<State>(
        Effect.fn("Browser.state")(function* () {
          yield* Effect.promise(() => fs.mkdir(profiles, { recursive: true }))
          return { cache: new Map(), queue: new Map(), live: new Map() }
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
        const dir = path.join(process.env.HOME ?? "", ".agent-browser", "browsers")
        const hit = yield* Effect.promise(() => fs.readdir(dir).then((list) => list.length > 0).catch(() => false))
        if (hit) {
          s.installed = true
          return
        }
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
        try {
          yield* Effect.promise(() => prev)
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
        const s = yield* InstanceState.get(state)
        const hit = s.cache.get(sessionID)?.info
        if (hit) return hit
        const json = yield* call(sessionID, ["stream", "status", "--json"])
        const info = makeInfo(sessionID, statusPayload(parse(json)))
        const cell = s.cache.get(sessionID) ?? {}
        cell.info = info
        s.cache.set(sessionID, cell)
        return info
      })

      const freshInfo = Effect.fn("Browser.freshInfo")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const json = yield* call(sessionID, ["stream", "status", "--json"])
        const info = makeInfo(sessionID, statusPayload(parse(json)))
        const cell = s.cache.get(sessionID) ?? {}
        cell.info = info
        s.cache.set(sessionID, cell)
        return info
      })

      const freshTabs = Effect.fn("Browser.freshTabs")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const json = yield* call(sessionID, ["tab", "list", "--json"])
        const data = pack(sessionID, tabPayload(parse(json)))
        const cell = s.cache.get(sessionID) ?? {}
        cell.tabs = data
        s.cache.set(sessionID, cell)
        return data
      })

      const dropInfo = Effect.fn("Browser.dropInfo")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const cell = s.cache.get(sessionID)
        if (!cell) return
        delete cell.info
        if (!cell.tabs) s.cache.delete(sessionID)
      })

      const dropTabs = Effect.fn("Browser.dropTabs")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const cell = s.cache.get(sessionID)
        if (!cell) return
        delete cell.tabs
        if (!cell.info) s.cache.delete(sessionID)
      })

      const emit = Effect.fn("Browser.emit")(function* (input: Update) {
        const s = yield* InstanceState.get(state)
        const cell = s.cache.get(input.sessionID) ?? {}
        if (input.info) cell.info = input.info
        if (input.tabs) cell.tabs = input.tabs
        if (input.info || input.tabs) s.cache.set(input.sessionID, cell)
        if (input.tabs) {
          const slot = s.live.get(input.sessionID)
          if (slot) slot.tabs = snap(input.tabs)
        }
        yield* Effect.promise(() => Bus.publish(Event.Updated, input)).pipe(Effect.orDie)
      })

      const stateInfo = Effect.fn("Browser.stateInfo")(function* (sessionID: SessionID) {
        const info = yield* status(sessionID)
        yield* emit({ sessionID, info })
        return info
      })

      const clear = Effect.fn("Browser.clear")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const slot = s.live.get(sessionID)
        if (!slot) return
        if (slot.timer) {
          clearTimeout(slot.timer)
          slot.timer = undefined
        }
        if (slot.poll) {
          clearTimeout(slot.poll)
          slot.poll = undefined
        }
      })

      const keep = Effect.fn("Browser.keep")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const slot = s.live.get(sessionID) ?? { refs: 0 }
        if (slot.timer) {
          clearTimeout(slot.timer)
          slot.timer = undefined
        }
        slot.refs += 1
        s.live.set(sessionID, slot)
      })

      const idle = InstanceState.bind((sessionID: SessionID, timer: ReturnType<typeof setTimeout>) => {
        void Effect.runPromise(InstanceState.get(state))
          .then((s) => {
            const slot = s.live.get(sessionID)
            if (!slot || slot.timer !== timer || slot.refs > 0) return
            slot.timer = undefined
            s.live.delete(sessionID)
            return Effect.runPromise(disable(sessionID))
          })
          .catch((err) => {
            log.error("browser idle disable failed", {
              sessionID,
              error: err instanceof Error ? err.message : String(err),
            })
          })
      })

      const drop = Effect.fn("Browser.drop")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const slot = s.live.get(sessionID)
        if (!slot) return
        slot.refs = Math.max(0, slot.refs - 1)
        if (slot.refs > 0) return
        if (slot.timer) clearTimeout(slot.timer)
        const timer = setTimeout(() => idle(sessionID, timer), Idle)
        slot.timer = timer
        s.live.set(sessionID, slot)
      })

      const enable = Effect.fn("Browser.enable")(function* (input: { sessionID: SessionID; port?: number }) {
        const args = enableArgs(input.port)
        let json = ""
        let fail: unknown
        json = yield* call(input.sessionID, args).pipe(
          Effect.catch((err) => {
            fail = err
            return Effect.succeed("")
          }),
        )
        if (fail) {
          if (!locked(fail)) throw fail
          log.info("browser profile lock detected, retrying", { sessionID: input.sessionID })
          const info = yield* freshInfo(input.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!info?.enabled || !info.port) {
            yield* call(input.sessionID, ["close"]).pipe(Effect.catch(() => Effect.succeed("")))
            json = yield* call(input.sessionID, args)
          } else {
            yield* emit({ sessionID: input.sessionID, info })
            return info
          }
        }
        try {
          const info = makeInfo(input.sessionID, statusPayload(parse(json)))
          yield* emit({ sessionID: input.sessionID, info })
          return info
        } catch {
          const info = yield* freshInfo(input.sessionID)
          yield* emit({ sessionID: input.sessionID, info })
          return info
        }
      })

      const disable = Effect.fn("Browser.disable")(function* (sessionID: SessionID) {
        yield* clear(sessionID)
        const s = yield* InstanceState.get(state)
        const slot = s.live.get(sessionID)
        if (slot) {
          slot.refs = 0
          s.live.delete(sessionID)
        }
        yield* call(sessionID, ["stream", "disable"])
        const info = {
          sessionID,
          profile: profile(sessionID),
          enabled: false,
          connected: false,
          screencasting: false,
        } satisfies Info
        yield* emit({ sessionID, info })
        return info
      })

      const tabs = Effect.fn("Browser.tabs")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const hit = s.cache.get(sessionID)?.tabs
        if (hit) return hit
        return yield* freshTabs(sessionID)
      })

      const tick = InstanceState.bind((sessionID: SessionID, poll: ReturnType<typeof setTimeout>) => {
        void Effect.runPromise(
          Effect.gen(function* () {
            const s = yield* InstanceState.get(state)
            const slot = s.live.get(sessionID)
            if (!slot || slot.poll !== poll) return
            slot.poll = undefined

            const data = yield* freshTabs(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const next = s.live.get(sessionID)
            if (!next) return

            if (data) {
              const text = snap(data)
              if (next.tabs !== text) yield* emit({ sessionID, tabs: data })
            }

            if (next.poll) return
            const again = setTimeout(() => tick(sessionID, again), Poll)
            next.poll = again
          }),
        ).catch((err) => {
          log.error("browser tab watcher failed", {
            sessionID,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      })

      const watch = Effect.fn("Browser.watch")(function* (sessionID: SessionID) {
        const s = yield* InstanceState.get(state)
        const slot = s.live.get(sessionID)
        if (!slot || slot.poll) return
        const poll = setTimeout(() => tick(sessionID, poll), Poll)
        slot.poll = poll
      })

      const focus = Effect.fn("Browser.focus")(function* (sessionID: SessionID, index: number) {
        const next = Math.max(0, Math.floor(index))
        const json = yield* call(sessionID, tabArgs(next))
        return focusPayload(parse(json))
      })

      const resize = Effect.fn("Browser.resize")(function* (input: {
        sessionID: SessionID
        width: number
        height: number
        scale?: number
      }) {
        yield* call(input.sessionID, viewportArgs(input))
      })

      const select = Effect.fn("Browser.select")(function* (input: {
        sessionID: SessionID
        index: number
        width?: number
        height?: number
        scale?: number
      }) {
        const next = yield* focus(input.sessionID, input.index)
        const width = input.width
        const height = input.height
        if (width && height) {
          const size = {
            sessionID: input.sessionID,
            width,
            height,
            ...(input.scale ? { scale: input.scale } : {}),
          }
          yield* resize(size)
        }
        const hit = yield* tabs(input.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const data = hit ? mark(hit, next) : yield* freshTabs(input.sessionID)
        yield* emit({ sessionID: input.sessionID, tabs: data })
        return data
      })

      const viewport = Effect.fn("Browser.viewport")(function* (input: {
        sessionID: SessionID
        width: number
        height: number
        scale?: number
      }) {
        yield* resize(input)
        return yield* stateInfo(input.sessionID)
      })

      const open = Effect.fn("Browser.open")(function* (input: { sessionID: SessionID; url: string }) {
        yield* call(input.sessionID, ["open", input.url])
        const data = yield* freshTabs(input.sessionID)
        const info = yield* status(input.sessionID).pipe(
          Effect.catch(() =>
            Effect.succeed({
              sessionID: input.sessionID,
              profile: profile(input.sessionID),
              enabled: true,
            } satisfies Info),
          ),
        )
        yield* emit({ sessionID: input.sessionID, info, tabs: data })
        return info
      })

      const close = Effect.fn("Browser.close")(function* (sessionID: SessionID) {
        yield* call(sessionID, ["close"])
        yield* dropTabs(sessionID)
        yield* dropInfo(sessionID)
        const data = yield* freshTabs(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const info = yield* freshInfo(sessionID).pipe(
          Effect.catch(() =>
            Effect.succeed({
              sessionID,
              profile: profile(sessionID),
              enabled: false,
            } satisfies Info),
          ),
        )
        yield* emit({ sessionID, info, ...(data ? { tabs: data } : {}) })
        return info
      })

      const remove = Effect.fn("Browser.remove")(function* (sessionID: SessionID) {
        yield* clear(sessionID)
        const s = yield* InstanceState.get(state)
        s.cache.delete(sessionID)
        s.live.delete(sessionID)
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
          yield* keep(sessionID)
          yield* watch(sessionID)
          let closed = false

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
            void Effect.runPromise(
              Effect.gen(function* () {
                const hit = yield* status(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!hit) return
                yield* emit({
                  sessionID,
                  info: {
                    ...hit,
                    connected: false,
                    screencasting: false,
                  },
                })
              }),
            )
            if (ws.readyState === 1) ws.close(1011, "browser stream error")
            end()
          })

          conn.addEventListener("close", () => {
            void Effect.runPromise(
              Effect.gen(function* () {
                const hit = yield* status(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!hit) return
                yield* emit({
                  sessionID,
                  info: {
                    ...hit,
                    connected: false,
                    screencasting: false,
                  },
                })
              }),
            )
            if (ws.readyState === 1) ws.close(1000, "browser stream ended")
          })

          log.info("browser stream connected", { sessionID, port: info.port })

          return {
            onMessage: (_message: string | ArrayBuffer) => {
              // v1 observer mode: do not forward input to browser runtime
            },
            onClose: () => {
              if (closed) return
              closed = true
              log.info("browser stream disconnected", { sessionID, port: info.port })
              void Effect.runPromise(drop(sessionID))
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
