import { describe, expect } from "bun:test"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { define } from "@opencode-ai/plugin/promise/plugin"
import type { RpcEventPayload } from "@opencode-ai/plugin/promise/rpc"
import { Rpc } from "@opencode-ai/plugin/rpc"
import { Effect, Logger } from "effect"
import { z } from "zod"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("Promise plugin RPC", () => {
  it.live("adapts calls, schema transforms, failures, and registration disposal", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const service = Rpc.define({
        id: "promise-rpc-calls",
        methods: {
          standard: { input: z.string().transform(Number), output: z.number().transform(String) },
          ping: { input: z.undefined(), output: z.null() },
          errorShapedOutput: {
            input: z.undefined(),
            output: z.object({ type: z.string(), message: z.string(), data: z.object({ value: z.number() }) }),
          },
          returned: {
            input: z.undefined(),
            output: z.null(),
            errors: { rejected: z.object({ attempts: z.string().transform(Number) }) },
          },
          thrown: {
            input: z.undefined(),
            output: z.null(),
            errors: { rejected: z.object({ attempts: z.string().transform(Number) }) },
          },
          defect: { input: z.undefined(), output: z.null() },
        },
        events: {},
      })
      const adapted = PluginPromise.fromPromise(
        define({
          id: "promise-rpc-calls-plugin",
          setup: async (ctx) => {
            const registration = await ctx.rpc.register(service, {
              standard: async (input) => {
                expect(input).toBe(42)
                return input + 1
              },
              ping: async () => null,
              errorShapedOutput: async () => ({ type: "ordinary", message: "Success", data: { value: 1 } }),
              returned: async (_input, context) =>
                context.error("rejected", "returned failure", { attempts: "1" }),
              thrown: async (_input, context) => {
                throw context.error("rejected", "thrown failure", { attempts: "2" })
              },
              defect: async () => {
                throw new Error("handler defect")
              },
            })
            const client = ctx.rpc(service)
            expect(await client.standard("42")).toBe("43")
            expect(await client.ping()).toBeNull()
            expect(await client.errorShapedOutput()).toEqual({
              type: "ordinary",
              message: "Success",
              data: { value: 1 },
            })
            await expect(client.returned()).rejects.toEqual({
              type: "rejected",
              message: "returned failure",
              data: { attempts: 1 },
            })
            await expect(client.thrown()).rejects.toEqual({
              type: "rejected",
              message: "thrown failure",
              data: { attempts: 2 },
            })
            await expect(client.defect()).rejects.toThrow("handler defect")
            await registration.dispose()
            await registration.dispose()
            await expect(client.ping()).rejects.toBeDefined()
          },
        }),
      )

      yield* plugins.activate([{ ...adapted, revision: "1" }])
      expect(yield* plugins.list()).toMatchObject([{ id: adapted.id, state: { status: "active" } }])
    }),
  )

  it.live("cancels only the selected call and passes its AbortSignal to Promise handlers", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const service = Rpc.define({
        id: "promise-rpc-cancel",
        methods: { wait: { input: z.string(), output: z.string() } },
        events: {},
      })
      const adapted = PluginPromise.fromPromise(
        define({
          id: "promise-rpc-cancel-plugin",
          setup: async (ctx) => {
            const started = Promise.withResolvers<void>()
            const cancelled = Promise.withResolvers<void>()
            const signals = new Map<string, AbortSignal>()
            await ctx.rpc.register(service, {
              wait: async (input, call) => {
                signals.set(input, call.signal)
                if (input === "complete") return input
                started.resolve()
                await new Promise<void>((resolve) => {
                  call.signal.addEventListener(
                    "abort",
                    () => {
                      cancelled.resolve()
                      resolve()
                    },
                    { once: true },
                  )
                })
                return input
              },
            })
            const client = ctx.rpc(service)
            const controller = new AbortController()
            const pending = client.wait("cancel", { signal: controller.signal })
            const rejected = pending.then(
              () => false,
              () => true,
            )
            await started.promise
            expect(await client.wait("complete")).toBe("complete")
            controller.abort()
            expect(await rejected).toBe(true)
            await cancelled.promise
            expect(signals.get("cancel")?.aborted).toBe(true)
            expect(signals.get("complete")?.aborted).toBe(false)
            expect(await client.wait("complete")).toBe("complete")
          },
        }),
      )

      yield* plugins.activate([{ ...adapted, revision: "1" }])
      expect(yield* plugins.list()).toMatchObject([{ id: adapted.id, state: { status: "active" } }])
    }),
  )

  it.live("awaits async callbacks and logs failures without stopping other plugin listeners", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const service = Rpc.define({
        id: "promise-rpc-async-listeners",
        methods: {},
        events: { updated: { schema: z.object({ value: z.number() }) } },
      })
      const error = new Error("Expected async plugin callback failure")
      const reported = Promise.withResolvers<void>()
      const logger = Logger.make((entry) => {
        if (Array.isArray(entry.message) && entry.message.includes(error)) reported.resolve()
      })
      const adapted = PluginPromise.fromPromise(
        define({
          id: "promise-rpc-async-listeners-plugin",
          setup: async (ctx) => {
            const registration = await ctx.rpc.register(service, {})
            const client = ctx.rpc(service)
            const started = Promise.withResolvers<void>()
            const release = Promise.withResolvers<void>()
            const second = Promise.withResolvers<void>()
            const third = Promise.withResolvers<void>()
            const failed: number[] = []
            const healthy: number[] = []
            client.events.on("updated", async (event) => {
              failed.push(event.data.value)
              started.resolve()
              await release.promise
              throw error
            })
            client.events.on("updated", (event) => {
              healthy.push(event.data.value)
              if (event.data.value === 2) second.resolve()
              if (event.data.value === 3) third.resolve()
            })
            await registration.events.emit("updated", { value: 1 })
            await started.promise
            await registration.events.emit("updated", { value: 2 })
            await second.promise
            expect(failed).toEqual([1])
            release.resolve()
            await reported.promise
            await registration.events.emit("updated", { value: 3 })
            await third.promise
            expect(failed).toEqual([1])
            expect(healthy).toEqual([1, 2, 3])
          },
        }),
      )
      yield* plugins
        .activate([{ ...adapted, revision: "1" }])
        .pipe(Effect.provideService(Logger.CurrentLoggers, new Set([logger])))
      expect(yield* plugins.list()).toMatchObject([{ id: adapted.id, state: { status: "active" } }])
      yield* plugins.activate([])
    }),
  )

  it.live("isolates event listeners and closes pending and idle iterators on plugin unload", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const service = Rpc.define({
        id: "promise-rpc-events",
        methods: {},
        events: {
          counted: { schema: z.object({ count: z.number() }).transform(({ count }) => ({ text: String(count) })) },
        },
      })
      const subscriptions = Promise.withResolvers<{
        pending: Promise<IteratorResult<RpcEventPayload<typeof service, "counted">>>
        idle: AsyncIterator<RpcEventPayload<typeof service, "counted">>
        nativeIdle: AsyncIterator<unknown>
      }>()
      const adapted = PluginPromise.fromPromise(
        define({
          id: "promise-rpc-events-plugin",
          setup: async (ctx) => {
            const registration = await ctx.rpc.register(service, {})
            const client = ctx.rpc(service)
            const first: string[] = []
            const second: string[] = []
            const firstSeen = Promise.withResolvers<void>()
            const secondSeen = Promise.withResolvers<void>()
            const nextSeen = Promise.withResolvers<void>()
            const unsubscribe = client.events.on("counted", (event) => {
              first.push(event.data.text)
              firstSeen.resolve()
            })
            client.events.on("counted", (event) => {
              second.push(event.data.text)
              if (event.data.text === "1") secondSeen.resolve()
              if (event.data.text === "2") nextSeen.resolve()
            })
            const controller = new AbortController()
            const iterator = client.events.subscribe("counted", { signal: controller.signal })[Symbol.asyncIterator]()
            const next = iterator.next()
            const idle = client.events.subscribe("counted")[Symbol.asyncIterator]()
            const idleNext = idle.next()
            const nativeController = new AbortController()
            const native = ctx.event.subscribe({ signal: nativeController.signal })[Symbol.asyncIterator]()
            const nativeNext = native.next()
            const nativeIdle = ctx.event.subscribe()[Symbol.asyncIterator]()
            const nativeIdleNext = nativeIdle.next()
            await registration.events.emit("counted", { count: 1 })
            await Promise.all([firstSeen.promise, secondSeen.promise])
            const event = (await next).value
            expect(event.type).toBe("rpc.promise-rpc-events.counted")
            expect(event.data).toEqual({ text: "1" })
            expect(typeof event.location.directory).toBe("string")
            expect((await idleNext).value.data).toEqual({ text: "1" })
            expect((await nativeNext).value.type).toBe("rpc.promise-rpc-events.counted")
            expect((await nativeIdleNext).value.type).toBe("rpc.promise-rpc-events.counted")
            nativeController.abort()
            expect((await native.next()).done).toBe(true)
            unsubscribe()
            unsubscribe()
            controller.abort()
            expect((await iterator.next()).done).toBe(true)
            await registration.events.emit("counted", { count: 2 })
            await nextSeen.promise
            expect(first).toEqual(["1"])
            expect(second).toEqual(["1", "2"])
            const aborted = client.events.subscribe("counted", { signal: controller.signal })[Symbol.asyncIterator]()
            expect((await aborted.next()).done).toBe(true)
            subscriptions.resolve({
              pending: client.events.subscribe("counted")[Symbol.asyncIterator]().next(),
              idle,
              nativeIdle,
            })
          },
        }),
      )

      yield* plugins.activate([{ ...adapted, revision: "1" }])
      expect(yield* plugins.list()).toMatchObject([{ id: adapted.id, state: { status: "active" } }])
      const active = yield* Effect.promise(() => subscriptions.promise)
      yield* plugins.activate([])
      expect((yield* Effect.promise(() => active.pending)).done).toBe(true)
      expect((yield* Effect.promise(() => active.idle.next())).done).toBe(true)
      expect((yield* Effect.promise(() => active.nativeIdle.next())).done).toBe(true)
    }),
  )
})
