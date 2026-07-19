import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode, type LocationGetOutput, type ModelRef, type SessionInfo } from "@opencode-ai/client/promise"
import { resolveSessionTarget, SessionTargetMutationError } from "../src/session-target"

function location(directory: string, workspaceID?: string): LocationGetOutput {
  return { directory, workspaceID, project: { id: "project", directory } }
}

function session(id: string, directory: string, workspaceID?: string, model?: ModelRef): SessionInfo {
  return {
    id,
    projectID: "project",
    title: id,
    location: { directory, workspaceID },
    model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
}

const prepare = async (input: { model: ModelRef | undefined; agent: string | undefined }) => ({
  model: input.model,
  agent: input.agent,
})

afterEach(() => mock.restore())

describe("session target resolver", () => {
  test("adopts an explicit Session location and model", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const selected = session("ses_resume", "/session", "work_1", { providerID: "openai", id: "gpt-5" })
    spyOn(client.session, "get").mockResolvedValue(selected)
    spyOn(client.location, "get").mockResolvedValue(location("/session", "work_1"))

    const target = await resolveSessionTarget({ client, session: selected.id, prepare })
    expect(target).toMatchObject({
      session: { id: "ses_resume" },
      location: { directory: "/session", workspaceID: "work_1" },
      model: { providerID: "openai", id: "gpt-5" },
      resume: true,
    })
  })

  test("paginates to continue the exact implicit workspace", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/project"))
    const explicit = Array.from({ length: 50 }, (_, index) => session(`ses_${index}`, "/project", `work_${index}`))
    const list = spyOn(client.session, "list")
      .mockResolvedValueOnce({ data: explicit, cursor: { next: "page_2" } })
      .mockResolvedValueOnce({ data: [session("ses_implicit", "/project")], cursor: {} })

    const target = await resolveSessionTarget({ client, location: { directory: "/project" }, continue: true, prepare })
    expect(list).toHaveBeenCalledTimes(2)
    expect(target.session.id).toBe("ses_implicit")
  })

  test("prepares a fresh Session at the server Location before creation", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    const order: string[] = []
    spyOn(client.location, "get").mockResolvedValue(location("/server", "work_1"))
    const create = spyOn(client.session, "create").mockImplementation(async (input) => {
      order.push("create")
      expect(input).toMatchObject({ agent: "prepared", location: { directory: "/server", workspaceID: "work_1" } })
      return session("ses_fresh", "/server", "work_1")
    })

    await resolveSessionTarget({
      client,
      agent: "requested",
      prepare: async (input) => {
        order.push("prepare")
        expect(input.location.workspaceID).toBe("work_1")
        return { model: input.model, agent: "prepared" }
      },
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["prepare", "create"])
  })

  test("does not retry an ambiguous Session creation", async () => {
    const client = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/project"))
    spyOn(client.session, "create").mockRejectedValue(new Error("connection closed after create"))
    await expect(resolveSessionTarget({ client, prepare })).rejects.toBeInstanceOf(SessionTargetMutationError)
  })
})
