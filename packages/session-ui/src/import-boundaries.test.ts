import { describe, expect, test } from "bun:test"

const forbidden = /["']@opencode-ai\/(?:core|sdk|server)(?:\/[^"']*)?["']/
const oldSession = /(?:SessionV1|session-v1|legacy-message|legacy-message-values)/

describe("Session UI package boundaries", () => {
  test("does not import server runtime packages", async () => {
    const files = new Bun.Glob("**/*.{ts,tsx}")
    const violations: string[] = []

    for await (const path of files.scan({ cwd: import.meta.dir, absolute: true })) {
      if (path === import.meta.path) continue
      if (forbidden.test(await Bun.file(path).text())) violations.push(path.slice(import.meta.dir.length + 1))
    }

    expect(violations).toEqual([])
  })

  test("does not declare server runtime dependencies", async () => {
    const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json()
    const dependencies = pkg.dependencies as Record<string, string>

    expect(dependencies["@opencode-ai/core"]).toBeUndefined()
    expect(dependencies["@opencode-ai/sdk"]).toBeUndefined()
    expect(dependencies["@opencode-ai/server"]).toBeUndefined()
  })

  test("does not contain old Session message boundaries", async () => {
    const files = new Bun.Glob("**/*.{ts,tsx}")
    const violations: string[] = []

    for await (const path of files.scan({ cwd: import.meta.dir, absolute: true })) {
      if (path === import.meta.path) continue
      if (oldSession.test(await Bun.file(path).text())) violations.push(path.slice(import.meta.dir.length + 1))
    }

    expect(violations).toEqual([])
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
