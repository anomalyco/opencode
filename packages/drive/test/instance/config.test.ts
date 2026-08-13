import { afterEach, describe, expect, test } from "vitest"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import { initializeInstance, prepareInstanceProject } from "../../src/instance/instance.js"

const artifacts: string[] = []

afterEach(async () => {
  await Promise.all(artifacts.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("instance configuration", () => {
  test("initializes the simulation provider with the current OpenCode provider shape", async () => {
    const root = await initializeInstance()
    artifacts.push(root)

    expect(Bun.JSONC.parse(await Bun.file(join(root, "files", ".opencode", "opencode.jsonc")).text())).toMatchObject({
      model: "simulation/gpt-sim-model",
      providers: {
        simulation: {
          package: "@opencode-ai/ai/providers/openai/chat",
          settings: { apiKey: "sim-key" },
        },
      },
    })
  })

  test("merges JSONC fixtures, replaces arrays, applies setup last, and commits normalized files", async () => {
    const root = await initializeInstance()
    artifacts.push(root)
    await Effect.runPromise(
      prepareInstanceProject({
        artifacts: root,
        project: {
          git: true,
          files: {
            ".opencode/opencode.jsonc": `{
            // fixture values are the merge base
            "nested": { "fixture": true, "winner": "fixture" },
            "items": ["fixture"],
          }`,
            ".opencode/tui.jsonc": `{
            "theme": { "fixture": true },
            "items": ["fixture"],
          }`,
          },
        },
        config: {
          nested: { declared: true, winner: "declared" },
          items: ["declared"],
        },
        tui: {
          theme: { declared: true },
          items: ["declared"],
        },
        setup({ config, tuiConfig }) {
          return Effect.sync(() => {
            config.nested = {
              ...(config.nested as Record<string, boolean | string>),
              winner: "setup",
            }
            tuiConfig.items = ["setup"]
          })
        },
      }),
    )

    const files = join(root, "files")
    const configText = await Bun.file(join(files, ".opencode", "opencode.jsonc")).text()
    const tuiText = await Bun.file(join(files, ".opencode", "tui.jsonc")).text()
    expect(JSON.parse(configText)).toEqual({
      nested: { fixture: true, declared: true, winner: "setup" },
      items: ["declared"],
    })
    expect(JSON.parse(tuiText)).toEqual({
      theme: { fixture: true, declared: true },
      items: ["setup"],
    })
    expect(configText).not.toContain("//")
    expect(await git(files, ["status", "--porcelain"])).toBe("")
    expect(await git(files, ["show", "HEAD:.opencode/tui.jsonc"])).toBe(tuiText)
  })

  test("rejects invalid JSONC configuration", async () => {
    const root = await initializeInstance()
    artifacts.push(root)
    await expect(
      Effect.runPromise(
        prepareInstanceProject({
          artifacts: root,
          project: {
            files: { ".opencode/tui.jsonc": "{ invalid" },
          },
        }),
      ),
    ).rejects.toThrow("invalid .opencode/tui.jsonc")
  })

  test("does not let setup mutate declarative configuration inputs", async () => {
    const root = await initializeInstance()
    artifacts.push(root)
    const config = { nested: { value: "declared" }, items: ["declared"] }
    const tui = { keybinds: { app_exit: "ctrl+q" } }

    await Effect.runPromise(
      prepareInstanceProject({
        artifacts: root,
        config,
        tui,
        setup({ config, tuiConfig }) {
          return Effect.sync(() => {
            const nested = config.nested as Record<string, string>
            const items = config.items as Array<string>
            const keybinds = tuiConfig.keybinds as Record<string, string>
            nested.value = "setup"
            items.push("setup")
            keybinds.app_exit = "ctrl+x"
          })
        },
      }),
    )

    expect(config).toEqual({
      nested: { value: "declared" },
      items: ["declared"],
    })
    expect(tui).toEqual({ keybinds: { app_exit: "ctrl+q" } })
  })

  test("interrupts setup with project preparation", async () => {
    const root = await initializeInstance()
    artifacts.push(root)
    const started = Promise.withResolvers<void>()
    let finalized = false
    const controller = new AbortController()
    const prepared = Effect.runPromise(
      prepareInstanceProject({
        artifacts: root,
        setup: () =>
          Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                finalized = true
              }),
            ),
          ),
      }),
      { signal: controller.signal },
    )

    await started.promise
    controller.abort()
    await expect(prepared).rejects.toThrow()
    expect(finalized).toBe(true)
  })
})

async function git(cwd: string, args: ReadonlyArray<string>) {
  return Bun.$`git ${args}`.cwd(cwd).text()
}
