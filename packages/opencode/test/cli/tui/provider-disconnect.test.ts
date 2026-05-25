import { expect, test } from "bun:test"
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")

test("registers provider disconnect slash command", async () => {
  const app = await Bun.file(path.join(root, "src/cli/cmd/tui/app.tsx")).text()

  expect(app).toContain('name: "provider.disconnect"')
  expect(app).toContain('slashName: "disconnect"')
})

test("provider disconnect dialog removes auth and refreshes sync", async () => {
  const dialog = await Bun.file(path.join(root, "src/cli/cmd/tui/component/dialog-provider-disconnect.tsx")).text()

  expect(dialog).toContain("sdk.client.auth.remove")
  expect(dialog).toContain("sdk.client.instance.dispose")
  expect(dialog).toContain("sync.bootstrap")
})

test("provider disconnect dialog handles non-api and managed providers", async () => {
  const dialog = await Bun.file(path.join(root, "src/cli/cmd/tui/component/dialog-provider-disconnect.tsx")).text()

  expect(dialog).toContain("disabled_providers")
  expect(dialog).toContain("sdk.client.config")
  expect(dialog).toContain(".update")
  expect(dialog).toContain("isConsoleManagedProvider")
  expect(dialog).toContain("Managed by")
})

test("provider disconnect dialog guards empty and duplicate submissions", async () => {
  const dialog = await Bun.file(path.join(root, "src/cli/cmd/tui/component/dialog-provider-disconnect.tsx")).text()

  expect(dialog).toContain("No connected providers")
  expect(dialog).toContain("setPending")
  expect(dialog).toContain("Disconnecting")
})
