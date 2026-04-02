import { test, expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { Sandbox } from "../../src/tool/sandbox"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Build a Sandbox service with an in-memory config stub, run an effect
function run<A>(cfg: Partial<Config.Info>, fn: (s: Sandbox.Interface) => Effect.Effect<A>) {
  const stub = Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () => Effect.succeed(cfg as Config.Info),
      getGlobal: () => Effect.succeed(cfg as Config.Info),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed(cfg as Config.Info),
      invalidate: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
    }),
  )
  const layer = Sandbox.layer.pipe(Layer.provide(stub))
  return Effect.runPromise(Effect.provide(Sandbox.Service.use(fn), layer))
}

describe("Sandbox", () => {
  describe("isAvailable()", () => {
    test("returns a boolean", () => {
      expect(typeof Sandbox.isAvailable()).toBe("boolean")
    })
  })

  describe("isEnabled()", () => {
    test("returns false when config has no sandbox field", async () => {
      const result = await run({}, (s) => s.isEnabled())
      expect(result).toBe(false)
    })

    test("returns false when sandbox.enabled is false", async () => {
      const result = await run({ sandbox: { enabled: false } }, (s) => s.isEnabled())
      expect(result).toBe(false)
    })

    test.skipIf(!Sandbox.isAvailable())("returns true when sandbox.enabled=true and bwrap present", async () => {
      const result = await run({ sandbox: { enabled: true } }, (s) => s.isEnabled())
      expect(result).toBe(true)
    })
  })

  describe("wrap()", () => {
    test("returns cmd unchanged when sandbox is disabled", async () => {
      const result = await run({ sandbox: { enabled: false } }, (s) => s.wrap("echo hello", "/tmp"))
      expect(result).toBe("echo hello")
    })

    test("returns cmd unchanged when no sandbox config", async () => {
      const result = await run({}, (s) => s.wrap("ls -la", "/tmp"))
      expect(result).toBe("ls -la")
    })

    test.skipIf(!Sandbox.isAvailable())("wraps command with bwrap args when enabled", async () => {
      const result = await run({ sandbox: { enabled: true, network: true } }, (s) =>
        s.wrap("echo hello", "/tmp/project"),
      )
      expect(result).toContain("bwrap")
      expect(result).toContain("--unshare-pid")
      expect(result).toContain("--chdir")
      expect(result).toContain("/tmp/project")
      expect(result).toContain("echo hello")
    })

    test.skipIf(!Sandbox.isAvailable())("includes --unshare-net when network=false", async () => {
      const result = await run({ sandbox: { enabled: true, network: false } }, (s) => s.wrap("echo hello", "/tmp"))
      expect(result).toContain("--unshare-net")
    })

    test.skipIf(!Sandbox.isAvailable())("does NOT include --unshare-net when network=true", async () => {
      const result = await run({ sandbox: { enabled: true, network: true } }, (s) => s.wrap("echo hello", "/tmp"))
      expect(result).not.toContain("--unshare-net")
    })

    test.skipIf(!Sandbox.isAvailable())("includes custom read-only paths", async () => {
      const result = await run({ sandbox: { enabled: true, read: ["/custom/path"] } }, (s) => s.wrap("ls", "/tmp"))
      expect(result).toContain("--ro-bind-try")
      expect(result).toContain("/custom/path")
    })

    test.skipIf(!Sandbox.isAvailable())("includes custom writable paths plus cwd and /tmp", async () => {
      const result = await run({ sandbox: { enabled: true, write: ["/my/data"] } }, (s) => s.wrap("ls", "/project"))
      expect(result).toContain("--bind-try")
      expect(result).toContain("/my/data")
      expect(result).toContain("/project")
      expect(result).toContain("/tmp")
    })
  })

  describe("config schema", () => {
    test("config parses sandbox field correctly", async () => {
      await using tmp = await tmpdir({
        git: true,
        config: {
          sandbox: {
            enabled: false,
            network: true,
            read: ["/usr"],
            write: ["/tmp"],
          },
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const raw = await Bun.file(tmp.path + "/opencode.json").json()
          expect(raw.sandbox).toBeDefined()
          expect(raw.sandbox.enabled).toBe(false)
          expect(raw.sandbox.network).toBe(true)
        },
      })
    })
  })
})
