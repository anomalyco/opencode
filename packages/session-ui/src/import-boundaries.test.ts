import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

const forbidden = /["']@opencode-ai\/(?:core|sdk|server)(?:\/[^"']*)?["']/
const oldSession = /(?:SessionV1|session-v1|legacy-message|legacy-message-values)/

describe("Session UI package boundaries", () => {
  test("does not import server runtime packages", async () => {
    expect(await findViolations(forbidden)).toEqual([])
  })

  test("does not declare server runtime dependencies", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json()
    const dependencies = pkg.dependencies as Record<string, string>

    expect(dependencies["@opencode-ai/core"]).toBeUndefined()
    expect(dependencies["@opencode-ai/sdk"]).toBeUndefined()
    expect(dependencies["@opencode-ai/server"]).toBeUndefined()
  })

  test("does not contain old Session message boundaries", async () => {
    expect(await findViolations(oldSession)).toEqual([])
  })

  test("exports the current Session document surface", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json()
    const exports = pkg.exports as Record<string, string>

    expect(exports["./actions"]).toBe("./src/actions.ts")
    expect(exports["./document"]).toBe("./src/document.ts")
    expect(exports["./message"]).toBe("./src/message/current-message.tsx")
    expect(exports["./message-part"]).toBe("./src/components/message-part.tsx")
    expect(exports["./timeline"]).toBe("./src/timeline/session-timeline.tsx")
    expect(exports["./timeline/projection"]).toBe("./src/timeline/projection.ts")
  })
})

async function findViolations(pattern: RegExp) {
  const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: import.meta.dir, absolute: true }))
  const matches = await Effect.runPromise(
    Effect.forEach(
      files.filter((path) => path !== import.meta.path),
      (path) =>
        Effect.promise(async () =>
          pattern.test(await Bun.file(path).text()) ? path.slice(import.meta.dir.length + 1) : undefined,
        ),
      { concurrency: 8 },
    ),
  )
  return matches.filter((path) => path !== undefined)
}
