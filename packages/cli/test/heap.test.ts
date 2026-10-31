import { expect, test } from "bun:test"

test.each(["freebsd", "win32", "linux", "darwin"])("heap listener lifecycle on %s", async (platform) => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
        import { Global } from "@opencode/util/global"
        import { Effect } from "effect"
        import { Heap } from ${JSON.stringify(new URL("../src/heap.ts", import.meta.url).href)}
        import assert from "node:assert/strict"

        Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} })
        const before = process.listenerCount("SIGUSR1")
        await Effect.runPromise(
          Effect.scoped(Effect.gen(function* () {
            yield* Heap.listen
            assert.equal(process.listenerCount("SIGUSR1") - before, ${platform === "freebsd" || platform === "win32" ? 0 : 1})
          })).pipe(Effect.provideService(Global.Service, Global.make())),
        )
        assert.equal(process.listenerCount("SIGUSR1"), before)
      `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const stderr = await new Response(child.stderr).text()
  expect(await child.exited, stderr).toBe(0)
})
