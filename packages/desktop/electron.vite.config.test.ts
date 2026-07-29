import { expect, test } from "bun:test"
import config from "./electron.vite.config"

test("bundles the Node browser client into Electron main", () => {
  expect(config.main?.build?.externalizeDeps).toEqual({
    include: [`@lydell/node-pty-${process.platform}-${process.arch}`, "bufferutil", "utf-8-validate"],
    exclude: ["@opencode-ai/client"],
  })
})

test("keeps the bundled Node client out of packaged production dependencies", async () => {
  const pkg = await Bun.file("package.json").json()
  expect(pkg.dependencies["@opencode-ai/client"]).toBeUndefined()
  expect(pkg.devDependencies["@opencode-ai/client"]).toBe("workspace:*")
})
