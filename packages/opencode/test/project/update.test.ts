import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { GlobalBus } from "../../src/bus/global"
import { loadProject } from "./setup"

describe("Project.update", () => {
  test("should update name", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const updated = await p.update({
      projectID: project.id,
      name: "New Project Name",
    })

    expect(updated.name).toBe("New Project Name")
    expect(p.get(project.id)?.name).toBe("New Project Name")
  })

  test("should update icon url", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const updated = await p.update({
      projectID: project.id,
      icon: { url: "https://example.com/icon.png" },
    })

    expect(updated.icon?.url).toBe("https://example.com/icon.png")
    expect(p.get(project.id)?.icon?.url).toBe("https://example.com/icon.png")
  })

  test("should update icon color", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const updated = await p.update({
      projectID: project.id,
      icon: { color: "#ff0000" },
    })

    expect(updated.icon?.color).toBe("#ff0000")
    expect(p.get(project.id)?.icon?.color).toBe("#ff0000")
  })

  test("should update commands", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const updated = await p.update({
      projectID: project.id,
      commands: { start: "npm run dev" },
    })

    expect(updated.commands?.start).toBe("npm run dev")
    expect(p.get(project.id)?.commands?.start).toBe("npm run dev")
  })

  test("should throw error when project not found", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    void tmp.path

    await expect(
      p.update({
        projectID: "nonexistent-project-id",
        name: "Should Fail",
      }),
    ).rejects.toThrow("Project not found: nonexistent-project-id")
  })

  test("should emit GlobalBus event on update", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    let fired = false
    let payload: any = null

    GlobalBus.on("event", (data) => {
      fired = true
      payload = data
    })

    await p.update({
      projectID: project.id,
      name: "Updated Name",
    })

    expect(fired).toBe(true)
    expect(payload.payload.type).toBe("project.updated")
    expect(payload.payload.properties.name).toBe("Updated Name")
  })

  test("should update multiple fields at once", async () => {
    const p = await loadProject()
    await using tmp = await tmpdir({ git: true })
    const { project } = await p.fromDirectory(tmp.path)

    const updated = await p.update({
      projectID: project.id,
      name: "Multi Update",
      icon: { url: "https://example.com/favicon.ico", color: "#00ff00" },
      commands: { start: "make start" },
    })

    expect(updated.name).toBe("Multi Update")
    expect(updated.icon?.url).toBe("https://example.com/favicon.ico")
    expect(updated.icon?.color).toBe("#00ff00")
    expect(updated.commands?.start).toBe("make start")
  })
})
