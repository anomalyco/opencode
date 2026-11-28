import { test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test("a TUI plugin from the server's inventory receives its options", async () => {
  await using plugin = await copyPlugin("options-echo")
  await using setup = await createAppFixture({
    fetch: (url) =>
      url.pathname === "/api/plugin"
        ? json({
            location: { directory, project: { id: "proj_test", directory, canonical: directory } },
            data: [
              {
                id: "fixture.options-echo",
                source: { type: "local", path: plugin.directory },
                features: { server: true, tui: true },
                state: { status: "active" },
                options: { region: "eu" },
              },
            ],
          })
        : undefined,
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes('Options {"region":"eu"}'))
})
