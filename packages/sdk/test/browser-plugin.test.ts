import { expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Tool } from "@opencode-ai/core/tool"
import plugin from "@opencode-ai/plugin-browser"
import { Browser } from "@opencode-ai/plugin-browser/rpc"
import { Agent, Rpc } from "@opencode-ai/plugin/effect"
import type { Info } from "@opencode-ai/schema/tool"
import { AbsolutePath, OpenCode, SessionMessage } from "@opencode-ai/sdk/effect"
import { Effect, Fiber, Queue, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"

const tab: Browser.Tab = {
  id: Browser.TabID.make(`tab_${crypto.randomUUID()}`),
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 7,
}
const state: Browser.State = { tabs: [tab], focusedTabID: tab.id }
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

const fixture = Effect.gen(function* () {
  const directory = yield* tmpdirScoped("opencode-browser-")
  const config = path.join(directory.path, "config")
  yield* Effect.promise(() => mkdir(config))
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
  const opencode = yield* OpenCode.create({
    database: { path: ":memory:" },
    config: {
      directory: config,
      project: false,
      content: JSON.stringify({
        plugins: ["-opencode.browser"],
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
  })
  const captured = Promise.withResolvers<readonly Info[]>()
  yield* opencode.plugin({ ...plugin, id: "browser-test" })
  yield* opencode.plugin({
    id: "browser-test-observer",
    effect: (ctx) =>
      ctx.tool
        .transform((draft) => {
          if (ctx.location.directory !== location.directory) return
          const tools = draft
            .list()
            .filter((tool) => tool.options?.namespace === "browser" || tool.options?.namespace?.startsWith("browser."))
          if (tools.length) captured.resolve(tools)
        })
        .pipe(Effect.orDie),
  })
  yield* opencode.plugin.list({ location })
  const tools = yield* Effect.promise(() => captured.promise)
  const session = yield* opencode.sessions.create({ location })
  const rpc = opencode.rpc(Browser.Definition)
  const events = yield* Queue.unbounded<Rpc.EventPayload<typeof Browser.Definition, "control">>()
  yield* rpc.events.subscribe("control").pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* opencode.events.subscribe().pipe(
    Stream.filter((event) => event.type === "server.connected"),
    Stream.runHead,
    Effect.timeout("5 seconds"),
  )
  const next = Queue.take(events).pipe(Effect.timeout("5 seconds"))
  const context = {
    sessionID: session.id,
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.create(),
    id: Tool.CallID.make(crypto.randomUUID()),
    progress: () => Effect.void,
  }
  const execute = (action: Browser.Action) => {
    const tool = tools.find((tool) => `${tool.options?.namespace}.${tool.name}` === `browser.${action.type}`)
    if (!tool) throw new Error(`Missing browser tool ${action.type}`)
    return tool.execute(action, context)
  }
  return {
    opencode,
    location,
    rpc,
    tools,
    next,
    execute,
    context,
    attach: Effect.fn(function* (connectionID: string) {
      const input = { sessionID: session.id, connectionID }
      const lifetime = yield* rpc.attach({ ...input, version: 2 }, { location }).pipe(Effect.forkScoped)
      expect((yield* next).data).toEqual({ type: "attached", connectionID, version: 2 })
      return { input, lifetime }
    }),
    command: Effect.fn(function* (action: Browser.Action) {
      const pending = yield* execute(action).pipe(Effect.forkScoped)
      const event = yield* next.pipe(
        Effect.raceFirst(Fiber.join(pending).pipe(Effect.andThen(Effect.die("Completed without a command")))),
      )
      if (event.data.type !== "command") throw new Error(`Expected command: ${event.data.type}`)
      expect(Object.keys(event.data).sort()).toEqual(["connectionID", "requestID", "type"])
      const input = { sessionID: session.id, connectionID: event.data.connectionID, requestID: event.data.requestID }
      const command = yield* rpc.command(input, { location })
      return { input, command, pending }
    }),
  }
})

test(
  "browser RPC preserves ownership, cancellation, replacement and unload without broadcasting commands",
  () =>
    Effect.gen(function* () {
      const host = yield* fixture
      const options = { location: host.location }
      expect(yield* host.execute({ type: "tabs.list" }).pipe(Effect.flip)).toMatchObject({
        message: expect.stringContaining("No desktop browser"),
      })
      const old = yield* host.attach("old")
      const attached = yield* host.attach("current")
      yield* Fiber.join(old.lifetime)
      expect(yield* host.rpc.state({ ...old.input, state }, options).pipe(Effect.flip)).toMatchObject({
        type: "unavailable",
      })
      yield* host.rpc.state({ ...attached.input, state }, options)
      const call = yield* host.command({ type: "evaluate", tabID: tab.id, script: "'private argument'" })
      expect(call.command.action).toEqual({ type: "evaluate", tabID: tab.id, script: "'private argument'" })
      expect(call.command.generation).toBe(tab.generation)
      expect(
        yield* host.rpc.command({ ...call.input, connectionID: "wrong" }, options).pipe(Effect.flip),
      ).toMatchObject({ type: "unavailable" })
      yield* Fiber.interrupt(call.pending)
      expect((yield* host.next).data).toMatchObject({ type: "cancel", requestID: call.input.requestID })
      expect(yield* host.rpc.command(call.input, options).pipe(Effect.flip)).toMatchObject({ type: "unavailable" })
      yield* host.rpc.result({ ...call.input, outcome: { type: "failure", code: "late", message: "late" } }, options)
      const pending = yield* host.command({ type: "tabs.list" })
      yield* host.opencode.plugin({ id: "browser-test", effect: () => Effect.void })
      yield* host.opencode.plugin.list(options)
      expect(yield* Fiber.join(pending.pending).pipe(Effect.flip)).toMatchObject({
        message: expect.stringContaining("connection closed"),
      })
      yield* Fiber.join(attached.lifetime)
    }).pipe(Effect.scoped, Effect.runPromise),
  15_000,
)

test(
  "the complete browser catalog executes through Code Mode with validated structured results",
  () =>
    Effect.gen(function* () {
      const host = yield* fixture
      yield* Effect.gen(function* () {
        const tools = yield* Tool.Service
        yield* tools.transform((editor) => host.tools.forEach((tool) => editor.add(tool)))
        const snapshot = yield* tools.snapshot()
        expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
        expect(host.tools).toHaveLength(Browser.Operations.length)
        const attached = yield* host.attach("catalog")
        yield* host.rpc.state({ ...attached.input, state }, { location: host.location })
        const run = (code: string) =>
          snapshot.execute({
            ...host.context,
            call: { type: "tool-call", id: crypto.randomUUID(), name: "execute", input: { code } },
          })
        const search = yield* run('return search({ query: "browser.network.get" })')
        expect(search.output).toMatchObject({ output: expect.stringContaining("tabID") })
        const pending = yield* run(`const result = await tools.browser.tabs.list({}); return result.tabs[0].id`).pipe(
          Effect.forkScoped,
        )
        const event = (yield* host.next).data
        if (event.type !== "command") throw new Error("Expected command")
        yield* host.rpc.result(
          {
            ...attached.input,
            requestID: event.requestID,
            outcome: { type: "success", result: { value: state, files: [] } },
          },
          { location: host.location },
        )
        expect((yield* Fiber.join(pending)).output).toMatchObject({ output: tab.id })
        const invalid = yield* host.command({ type: "tabs.list" })
        yield* host.rpc.result(
          {
            ...invalid.input,
            outcome: { type: "success", result: { value: { notTheExpectedResult: true }, files: [] } },
          },
          { location: host.location },
        )
        expect(yield* Fiber.join(invalid.pending).pipe(Effect.flip)).toMatchObject({
          message: expect.stringContaining("Check that the desktop and server plugin use compatible versions"),
        })
        const missing = yield* run('return await tools.browser.click({ref:"e1"})')
        expect(missing.metadata).toMatchObject({ error: true })
        expect(missing.output).toMatchObject({ output: expect.stringContaining("tabID") })
        const unknown = yield* run(
          `return await tools.browser.snapshot({tabID:${JSON.stringify(Browser.TabID.make(`tab_${crypto.randomUUID()}`))}})`,
        )
        expect(unknown.output).toMatchObject({ error: true, output: expect.stringContaining("browser.tabs.list({})") })
        const absent = yield* run(
          `return await tools.browser.files.upload({tabID:${JSON.stringify(tab.id)},ref:"e1",paths:["missing.txt"]})`,
        )
        const fileError = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.Boolean, output: Schema.String }))(
          absent.output,
        )
        expect(fileError.error).toBe(true)
        expect(fileError.output).toContain("Upload paths are on the server, not the desktop")
        expect(fileError.output).toContain("ENOENT")
        const large = path.join(host.location.directory, "large.bin")
        yield* Effect.promise(() => Bun.write(large, new Uint8Array(Browser.MAX_FILE_BYTES + 1)))
        const oversized = yield* run(
          `return await tools.browser.files.upload({tabID:${JSON.stringify(tab.id)},ref:"e1",paths:[${JSON.stringify(large)}]})`,
        )
        expect(oversized.output).toMatchObject({
          error: true,
          output: expect.stringContaining("Select a smaller file"),
        })
        yield* Fiber.interrupt(attached.lifetime)
        const disconnected = yield* run("return await tools.browser.tabs.list({})")
        expect(disconnected.output).toMatchObject({
          error: true,
          output: expect.stringContaining("Open this session in the desktop app"),
        })
      }).pipe(
        Effect.provide(AppNodeBuilder.build(Tool.node, [Location.node.replace(Location.boundNode(host.location))])),
      )
    }).pipe(Effect.scoped, Effect.runPromise),
  15_000,
)

test(
  "timeout errors explain unknown outcomes instead of encouraging duplicate actions",
  () =>
    Effect.gen(function* () {
      const host = yield* fixture
      const attached = yield* host.attach("timeout")
      yield* host.rpc.state({ ...attached.input, state }, { location: host.location })
      yield* Effect.gen(function* () {
        const pending = yield* host.command({ type: "evaluate", tabID: tab.id, script: "new Promise(() => {})" })
        yield* TestClock.adjust("61 seconds")
        const failure = yield* Fiber.join(pending.pending).pipe(Effect.flip)
        expect(failure.message).toContain("browser.evaluate did not finish within 60 seconds")
        expect(failure.message).toContain("outcome is unknown")
        expect(failure.message).toContain("Do not blindly repeat")
        expect(failure.message).toContain("browser.files.list({tabID})")
      }).pipe(Effect.provide(TestClock.layer()))
    }).pipe(Effect.scoped, Effect.runPromise),
  15_000,
)

test(
  "browser file transfers copy bytes between disjoint client and server filesystems",
  () =>
    Effect.gen(function* () {
      const host = yield* fixture
      const client = yield* tmpdirScoped("opencode-desktop-files-")
      const attached = yield* host.attach("files")
      const options = { location: host.location }
      yield* host.rpc.state({ ...attached.input, state }, options)
      const serverPath = path.join(host.location.directory, "upload.txt")
      yield* Effect.promise(() => Bun.write(serverPath, "server-only contents"))
      const upload = yield* host.command({
        type: "files.upload",
        tabID: tab.id,
        ref: Browser.Ref.make("e1"),
        paths: [serverPath],
      })
      expect(upload.command.action).toMatchObject({ paths: ["upload.txt"] })
      expect(new TextDecoder().decode(upload.command.files[0].data)).toBe("server-only contents")
      const clientPath = path.join(client.path, upload.command.files[0].name)
      yield* Effect.promise(() => Bun.write(clientPath, upload.command.files[0].data))
      expect(yield* Effect.promise(() => Bun.file(clientPath).text())).toBe("server-only contents")
      yield* host.rpc.result(
        { ...upload.input, outcome: { type: "success", result: { value: tab, files: [] } } },
        options,
      )
      yield* Fiber.join(upload.pending)

      const capture = yield* host.command({ type: "screenshot", tabID: tab.id })
      const id = Browser.FileID.make(`file_${crypto.randomUUID()}`)
      yield* host.rpc.result(
        {
          ...capture.input,
          outcome: {
            type: "success",
            result: { value: { tab }, files: [{ id, name: "screenshot.png", mime: "image/png", data: png }] },
          },
        },
        options,
      )
      const result = yield* Fiber.join(capture.pending)
      const saved = Schema.decodeUnknownSync(Schema.Struct({ files: Schema.Array(Browser.FileInfo) }))(result.output)
        .files[0]
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => rm(path.dirname(path.dirname(saved.path)), { recursive: true, force: true })),
      )
      expect(saved.path).not.toStartWith(client.path)
      expect(path.basename(saved.path)).toBe("screenshot.png")
      expect(Buffer.from(yield* Effect.promise(() => readFile(saved.path))).toString("base64")).toBe(png)
      expect(result.content).toContainEqual({
        type: "file",
        uri: `data:image/png;base64,${png}`,
        name: "screenshot.png",
        mime: "image/png",
      })
      expect(JSON.stringify(result.output)).not.toContain(png)
    }).pipe(Effect.scoped, Effect.runPromise),
  15_000,
)
