import path from "path"
import { describe, expect, test } from "bun:test"
import type { ConfigDiscovery } from "@opencode-ai/core/config/discovery"
import { ConfigWatch } from "@opencode-ai/core/config/watch"
import { AbsolutePath } from "@opencode-ai/core/schema"

const project = path.resolve("watch-plan-project")
const root = AbsolutePath.make(path.join(project, ".opencode"))
const sources: ConfigDiscovery.Sources = {
  direct: ["opencode.json", "opencode.jsonc"].map((name) => AbsolutePath.make(path.join(project, name))),
  project: [{ path: root, present: false }],
  claude: [AbsolutePath.make(path.join(project, ".claude"))],
  agents: [AbsolutePath.make(path.join(project, ".agents"))],
}

describe("ConfigWatch.plan", () => {
  test("groups missing candidates without watching ecosystem roots", () => {
    expect(Array.from(ConfigWatch.plan(sources).values())).toEqual([
      { path: project, type: "entries", names: [".opencode", "opencode.json", "opencode.jsonc"] },
    ])
  })

  test("adds a recursive watch for a discovered root without replacing its parent sentinel", () => {
    const missing = ConfigWatch.plan(sources)
    const present = ConfigWatch.plan({ ...sources, project: [{ path: root, present: true }] })
    expect(present.size).toBe(missing.size + 1)
    for (const [key, target] of missing) expect(present.get(key)).toEqual(target)
    expect(Array.from(present.values()).filter((target) => target.type === "directory")).toEqual([
      { path: root, type: "directory", ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"] },
    ])
    expect(ConfigWatch.plan(sources)).toEqual(missing)
  })

  test("deduplicates explicit sources already covered by another watch", () => {
    expect(ConfigWatch.plan({ ...sources, explicit: sources.direct[0] })).toEqual(ConfigWatch.plan(sources))
    const present = { ...sources, project: [{ path: root, present: true }] }
    expect(ConfigWatch.plan({ ...present, explicit: AbsolutePath.make(path.join(root, "custom.json")) })).toEqual(
      ConfigWatch.plan(present),
    )
  })

  test("watches an explicit source outside config roots by its exact name", () => {
    const directory = path.resolve("watch-plan-external")
    expect(
      Array.from(
        ConfigWatch.plan({ ...sources, explicit: AbsolutePath.make(path.join(directory, "custom.json")) }).values(),
      ),
    ).toContainEqual({ path: directory, type: "entries", names: ["custom.json"] })
  })
})
