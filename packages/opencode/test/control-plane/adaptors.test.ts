import { describe, expect, test } from "bun:test"
import { getAdaptor, registerAdaptor } from "../../src/control-plane/adaptors"
import { ProjectID } from "../../src/project/schema"
import type { WorkspaceInfo } from "../../src/control-plane/types"

function info(projectID: WorkspaceInfo["projectID"], type: string): WorkspaceInfo {
  return {
    id: "workspace-test" as WorkspaceInfo["id"],
    type,
    name: "workspace-test",
    branch: null,
    directory: null,
    extra: null,
    projectID,
  }
}

function adaptor(dir: string) {
  return {
    name: dir,
    description: dir,
    configure(input: WorkspaceInfo) {
      return input
    },
    async create() {},
    async remove() {},
    target() {
      return {
        type: "local" as const,
        directory: dir,
      }
    },
  }
}

describe("control-plane/adaptors", () => {
  test("isolates custom adaptors by project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const one = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    const two = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdaptor(one, type, adaptor("/one"))
    registerAdaptor(two, type, adaptor("/two"))

    expect(await (await getAdaptor(one, type)).target(info(one, type))).toEqual({
      type: "local",
      directory: "/one",
    })
    expect(await (await getAdaptor(two, type)).target(info(two, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })

  test("latest install wins within a project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdaptor(id, type, adaptor("/one"))

    expect(await (await getAdaptor(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/one",
    })

    registerAdaptor(id, type, adaptor("/two"))

    expect(await (await getAdaptor(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })
})
