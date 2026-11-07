import path from "path"
import { describe, expect, test } from "bun:test"
import type { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ConfigWatch } from "@opencode/core/config/watch"
import { AbsolutePath } from "@opencode/core/schema"
import { FSUtil } from "@opencode/util/fs-util"

const project = path.resolve("watch-plan-project")
const root = AbsolutePath.make(path.join(project, ".opencode"))
const sources: ConfigDiscovery.Sources = {
  direct: ["opencode.json", "opencode.jsonc"].map((name) => AbsolutePath.make(path.join(project, name))),
  targets: [],
  project: [{ path: root, present: false }],
  claude: [AbsolutePath.make(path.join(project, ".claude"))],
  agents: [AbsolutePath.make(path.join(project, ".agents"))],
}

describe("ConfigWatch.plan", () => {
  test("groups missing candidates and keeps parent watches when roots appear", () => {
    const missing = ConfigWatch.plan(sources)
    expect(Array.from(missing.values())).toEqual([
      { path: project, type: "entries", names: [".agents", ".claude", ".opencode", "opencode.json", "opencode.jsonc"] },
    ])
    const system = AbsolutePath.make(path.join(project, "system-opencode"))
    const present = ConfigWatch.plan({
      ...sources,
      system: { path: system, present: true },
      project: [{ path: root, present: true }],
    })
    expect(Array.from(present.values())).toEqual([
      { path: system, type: "directory", ignore: FSUtil.ignoreGlobs },
      { path: root, type: "directory", ignore: FSUtil.ignoreGlobs },
      {
        path: project,
        type: "entries",
        names: [".agents", ".claude", ".opencode", "opencode.json", "opencode.jsonc", "system-opencode"],
      },
    ])
  })

  test("adds exact watches for explicit files only when not already covered", () => {
    expect(ConfigWatch.plan({ ...sources, explicit: sources.direct[0] })).toEqual(ConfigWatch.plan(sources))
    const present = { ...sources, project: [{ path: root, present: true }] }
    expect(ConfigWatch.plan({ ...present, explicit: AbsolutePath.make(path.join(root, "custom.json")) })).toEqual(
      ConfigWatch.plan(present),
    )
    const directory = path.resolve("watch-plan-external")
    expect(
      Array.from(
        ConfigWatch.plan({ ...sources, explicit: AbsolutePath.make(path.join(directory, "custom.json")) }).values(),
      ),
    ).toContainEqual({ path: directory, type: "entries", names: ["custom.json"] })
  })

  test("watches resolved targets outside config roots", () => {
    const dotfiles = path.resolve("watch-plan-dotfiles")
    const plan = ConfigWatch.plan({
      ...sources,
      project: [{ path: root, present: true }],
      targets: [AbsolutePath.make(path.join(dotfiles, "opencode.json"))],
    })
    expect(Array.from(plan.values())).toContainEqual({
      path: dotfiles,
      type: "entries",
      names: ["opencode.json"],
    })
  })

  test("does not duplicate targets already covered by a watched root", () => {
    const plan = ConfigWatch.plan({
      ...sources,
      project: [{ path: root, present: true }],
      targets: [AbsolutePath.make(path.join(root, "opencode.json"))],
    })
    expect(Array.from(plan.values()).filter((entry) => entry.path === root)).toEqual([
      { path: root, type: "directory", ignore: FSUtil.ignoreGlobs },
    ])
  })
})
