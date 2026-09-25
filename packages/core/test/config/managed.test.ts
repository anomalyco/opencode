import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import { Config } from "@opencode/core/config"
import type { Entry } from "@opencode/schema/config"
import { ConfigManaged } from "@opencode/core/config/managed"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Credential } from "@opencode/core/credential"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Bus } from "@opencode/core/bus"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function testLayer(directory: string, managed: ConfigManaged.Paths, content?: string) {
  const global = path.join(directory, "global")
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(
      location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) }),
    ),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ managed, content })),
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  return Layer.mergeAll(built, Watcher.testLayer)
}

const withTmp = <A, E, R>(body: (tmp: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => body(tmp.path),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const write = (file: string, value: unknown) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value))
  })

const plist = (entries: Record<string, string>) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>PayloadType</key><string>ai.opencode.managed</string>
  <key>PayloadUUID</key><string>AAAA-BBBB-CCCC</string>
  <key>_manualProfile</key><true/>
${Object.entries(entries)
  .map(([key, value]) => `  <key>${key}</key><string>${value}</string>`)
  .join("\n")}
</dict></plist>`

const entries = Config.Service.use((config) => config.entries())

const model = (loaded: Entry[]) => {
  const selection = Config.latest(loaded, "model")
  return selection && `${selection.providerID}/${selection.model}`
}

describe("ConfigManaged", () => {
  test("strips MDM metadata keys from converted plists", () => {
    const parsed = ConfigManaged.parsePlist(
      JSON.stringify({
        PayloadDisplayName: "Managed",
        PayloadIdentifier: "com.example.opencode",
        PayloadType: "ai.opencode.managed",
        PayloadUUID: "AAAA-BBBB-CCCC",
        PayloadVersion: 1,
        _manualProfile: true,
        share: "disabled",
      }),
    )
    expect(parsed).toEqual({ share: "disabled" })
    expect(() => ConfigManaged.parsePlist("[]")).toThrow()
  })

  test("resolves the system-managed locations per platform", () => {
    expect(ConfigManaged.systemPaths("darwin", "alice")).toEqual({
      directory: "/Library/Application Support/opencode",
      preferences: [
        "/Library/Managed Preferences/alice/ai.opencode.managed.plist",
        "/Library/Managed Preferences/ai.opencode.managed.plist",
      ],
    })
    expect(ConfigManaged.systemPaths("linux")).toEqual({ directory: "/etc/opencode" })
    expect(ConfigManaged.systemPaths("win32").directory).toEndWith("opencode")
  })

  it.live("ranks managed directory files above user, project, and inline config", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const managed = path.join(tmp, "managed")
        yield* write(path.join(tmp, "global", "opencode.json"), { share: "auto", model: "global/model" })
        yield* write(path.join(tmp, "opencode.json"), { share: "auto", model: "project/model" })
        yield* write(path.join(managed, "opencode.json"), { share: "disabled" })
        yield* write(path.join(managed, "opencode.jsonc"), `{ /* jsonc wins */ "model": "managed/model" }`)

        const loaded = yield* entries.pipe(
          Effect.provide(testLayer(tmp, { directory: managed }, JSON.stringify({ share: "manual" }))),
        )
        const documents = loaded.filter((entry) => entry.type === "document")

        expect(documents.slice(-2).map((document) => String(document.path))).toEqual([
          path.join(managed, "opencode.json"),
          path.join(managed, "opencode.jsonc"),
        ])
        expect(Config.latest(loaded, "share")).toBe("disabled")
        expect(model(loaded)).toBe("managed/model")
        expect(loaded.some((entry) => entry.type === "directory" && entry.path === managed)).toBe(false)
      }),
    ),
  )

  it.live("exposes every managed candidate path", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const managed = path.join(tmp, "managed")
        const preference = path.join(tmp, "managed.plist")
        const config = yield* Config.Service.pipe(
          Effect.provide(testLayer(tmp, { directory: managed, preferences: [preference] })),
        )

        expect(config.managed?.map(String)).toEqual([
          path.join(managed, "opencode.json"),
          path.join(managed, "opencode.jsonc"),
          preference,
        ])
      }),
    ),
  )

  it.live("loads nothing extra when managed sources are absent", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        yield* write(path.join(tmp, "opencode.json"), { model: "project/model" })

        const loaded = yield* entries.pipe(
          Effect.provide(
            testLayer(tmp, { directory: path.join(tmp, "missing"), preferences: [path.join(tmp, "missing.plist")] }),
          ),
        )

        expect(model(loaded)).toBe("project/model")
        expect(loaded.filter((entry) => entry.type === "document")).toHaveLength(1)
      }),
    ),
  )

  it.live("migrates v1-shaped managed config into enforced v2 settings", () =>
    withTmp((tmp) =>
      Effect.gen(function* () {
        const managed = path.join(tmp, "managed")
        yield* write(path.join(managed, "opencode.json"), {
          share: "disabled",
          enabled_providers: ["openrouter", "anthropic"],
          model: "openrouter/auto",
          small_model: "openrouter/auto-cost",
          mcp: { docs: { type: "remote", url: "https://mcp.example.com/mcp" } },
        })

        const loaded = yield* entries.pipe(Effect.provide(testLayer(tmp, { directory: managed })))

        expect(Config.latest(loaded, "share")).toBe("disabled")
        expect(Config.latest(loaded, "experimental")?.policies).toEqual([
          { action: "provider.use", resource: "*", effect: "deny" },
          { action: "provider.use", resource: "openrouter", effect: "allow" },
          { action: "provider.use", resource: "anthropic", effect: "allow" },
        ])
        expect(Config.latest(loaded, "mcp")?.servers?.docs).toMatchObject({
          type: "remote",
          url: "https://mcp.example.com/mcp",
        })
        expect(Config.latest(loaded, "agents")?.title?.model).toBeDefined()
      }),
    ),
  )

  it.live("warns about malformed managed config and keeps other sources", () => {
    const output: Array<Record<string, unknown>> = []
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      if (!Array.isArray(entry.message) || entry.message[0] !== "configuration normalization diagnostic") return
      const details = entry.message[1]
      if (typeof details === "object" && details !== null) output.push(details as Record<string, unknown>)
    })
    return withTmp((tmp) =>
      Effect.gen(function* () {
        const managed = path.join(tmp, "managed")
        yield* write(path.join(tmp, "opencode.json"), { model: "project/model" })
        yield* write(path.join(managed, "opencode.json"), '{ "share": ')

        const loaded = yield* entries.pipe(Effect.provide(testLayer(tmp, { directory: managed })))

        expect(model(loaded)).toBe("project/model")
        expect(output.map((item) => `${item.source}:${item.kind}`)).toContain(
          `${path.join(managed, "opencode.json")}:invalid`,
        )
      }),
    ).pipe(Effect.provide(Logger.layer([logger])))
  })

  test.skipIf(process.platform !== "darwin")("ranks the first readable managed plist above the managed directory", () =>
    Effect.runPromise(
      withTmp((tmp) =>
        Effect.gen(function* () {
          const managed = path.join(tmp, "managed")
          const userPlist = path.join(tmp, "user.plist")
          const machinePlist = path.join(tmp, "machine.plist")
          yield* write(path.join(tmp, "opencode.json"), { share: "auto", model: "project/model" })
          yield* write(path.join(managed, "opencode.json"), { share: "manual", model: "managed/model" })
          yield* write(userPlist, plist({ share: "disabled" }))
          yield* write(machinePlist, plist({ model: "machine/model" }))

          const loaded = yield* entries.pipe(
            Effect.provide(testLayer(tmp, { directory: managed, preferences: [userPlist, machinePlist] })),
          )
          const last = loaded.filter((entry) => entry.type === "document").at(-1)

          expect(String(last?.path)).toBe(userPlist)
          expect(last?.info).not.toHaveProperty("PayloadUUID")
          expect(Config.latest(loaded, "share")).toBe("disabled")
          expect(model(loaded)).toBe("managed/model")
        }),
      ).pipe(Effect.scoped),
    ),
  )
})
