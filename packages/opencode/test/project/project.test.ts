import { describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { Project } from "../../src/project/project"
import { ProjectID } from "../../src/project/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function all() {
  return Project.list()
}

describe("Project.createSimple", () => {
  test("creates a project with a virtual directory handle", async () => {
    const { project, directory } = await Project.createSimple({
      name: "Simple Project",
      tenantUserId: "user_test",
    })

    expect(directory).toBe(`/projects/${project.id}`)
    const saved = await Project.get(project.id)
    expect(saved?.name).toBe("Simple Project")
  })
})

describe("Project.createForDirectory", () => {
  test("creates a project for an explicit directory", async () => {
    await using tmp = await tmpdir({ git: true })

    const { project } = await Project.createForDirectory({
      workspace: tmp.path,
      name: "Directory Project",
      tenantUserId: "user_test",
    })

    const saved = await Project.get(project.id)
    expect(saved?.name).toBe("Directory Project")
  })
})

describe("Project.list", () => {
  test("lists created projects", async () => {
    const created = await Project.createSimple({
      name: "Listed Project",
      tenantUserId: "user_test",
    })

    const projects = await all()
    expect(projects.some((item) => item.id === created.project.id)).toBe(true)
  })
})

describe("Project.update", () => {
  test("should update name", async () => {
    const { project } = await Project.createSimple({
      name: "Original Name",
      tenantUserId: "user_test",
    })

    const updated = await Project.update({
      projectID: project.id,
      name: "New Project Name",
    })

    expect(updated.name).toBe("New Project Name")

    const fromDb = await Project.get(project.id)
    expect(fromDb?.name).toBe("New Project Name")
  })

  test("should update icon url", async () => {
    const { project } = await Project.createSimple({
      name: "Icon Url Project",
      tenantUserId: "user_test",
    })

    const updated = await Project.update({
      projectID: project.id,
      icon: { url: "https://example.com/icon.png" },
    })

    expect(updated.icon?.url).toBe("https://example.com/icon.png")

    const fromDb = await Project.get(project.id)
    expect(fromDb?.icon?.url).toBe("https://example.com/icon.png")
  })

  test("should update icon color", async () => {
    const { project } = await Project.createSimple({
      name: "Icon Color Project",
      tenantUserId: "user_test",
    })

    const updated = await Project.update({
      projectID: project.id,
      icon: { color: "#ff0000" },
    })

    expect(updated.icon?.color).toBe("#ff0000")

    const fromDb = await Project.get(project.id)
    expect(fromDb?.icon?.color).toBe("#ff0000")
  })

  test("should update commands", async () => {
    const { project } = await Project.createSimple({
      name: "Command Project",
      tenantUserId: "user_test",
    })

    const updated = await Project.update({
      projectID: project.id,
      commands: { start: "npm run dev" },
    })

    expect(updated.commands?.start).toBe("npm run dev")

    const fromDb = await Project.get(project.id)
    expect(fromDb?.commands?.start).toBe("npm run dev")
  })

  test("should throw error when project not found", async () => {
    await expect(
      Project.update({
        projectID: ProjectID.make("nonexistent-project-id"),
        name: "Should Fail",
      }),
    ).rejects.toThrow("Project not found: nonexistent-project-id")
  })

  test("should emit GlobalBus event on update", async () => {
    const { project } = await Project.createSimple({
      name: "Bus Project",
      tenantUserId: "user_test",
    })

    let payload: unknown = null

    const listener = (data: unknown) => {
      payload = data
    }

    GlobalBus.on("event", listener)
    await Project.update({
      projectID: project.id,
      name: "Updated Name",
    })
    GlobalBus.off("event", listener)

    expect(payload).toMatchObject({
      payload: {
        type: "project.updated",
        properties: {
          name: "Updated Name",
        },
      },
    })
  })

  test("should update multiple fields at once", async () => {
    const { project } = await Project.createSimple({
      name: "Multi Project",
      tenantUserId: "user_test",
    })

    const updated = await Project.update({
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
