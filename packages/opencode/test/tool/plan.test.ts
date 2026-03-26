import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { PlanExitTool } from "../../src/tool/plan"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Provider } from "../../src/provider/provider"
import { Question } from "../../src/question"

const ctx = {
  sessionID: "session_test",
  messageID: "message_test",
  callID: "call_test",
  agent: "plan",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.plan", () => {
  const all = [] as { mockRestore: () => void }[]

  beforeEach(() => {
    all.length = 0
  })

  afterEach(() => {
    for (const item of all) item.mockRestore()
  })

  test("plan_exit auto-switches to build and writes json artifact", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const file = path.join(dir, ".opencode", "plans", "123-demo.md")
        await fs.mkdir(path.dirname(file), { recursive: true })
        await Bun.write(
          file,
          [
            "# Improve API plan",
            "",
            "## Scope",
            "- API routes only",
            "",
            "## Constraints",
            "- Keep backward compatibility",
            "",
            "## Steps",
            "1. Add route",
            "2. Add tests",
            "",
            "## Acceptance",
            "- tests pass",
            "",
            "## Confirmed Understanding",
            "- User approved the summarized intent",
          ].join("\n"),
        )
        return file
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = tmp.extra as string
        all.push(spyOn(Session, "get").mockResolvedValue({} as any))
        all.push(spyOn(Session, "plan").mockReturnValue(file))
        all.push(spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "openai", modelID: "gpt-5" } as any))
        all.push(spyOn(MessageV2, "stream").mockReturnValue((async function* () {})() as any))

        const updateMessage = spyOn(Session, "updateMessage").mockResolvedValue(undefined as any)
        const updatePart = spyOn(Session, "updatePart").mockResolvedValue(undefined as any)
        const ask = spyOn(Question, "ask").mockResolvedValue([])
        all.push(updateMessage)
        all.push(updatePart)
        all.push(ask)

        const tool = await PlanExitTool.init()
        const result = await tool.execute({}, ctx)

        expect(ask).not.toHaveBeenCalled()
        expect(result.output).toContain("automatically")
        expect(updateMessage).toHaveBeenCalled()
        expect(updatePart).toHaveBeenCalled()
        expect((updateMessage.mock.calls[0]?.[0] as any)?.agent).toBe("build")

        const jsonPath = file.replace(/\.md$/, ".json")
        const saved = await Bun.file(jsonPath).json()
        expect(saved.objective).toBe("Improve API plan")
        expect(saved.steps.length).toBeGreaterThan(0)
        expect(saved.metadata.style).toBe("interrogative")
        expect(saved.metadata.interaction_style).toBe("codex-like")
        expect(saved.metadata.confirmed).toBe(true)
      },
    })
  })

  test("plan_exit rejects when confirmation section is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const file = path.join(dir, ".opencode", "plans", "456-demo.md")
        await fs.mkdir(path.dirname(file), { recursive: true })
        await Bun.write(
          file,
          [
            "# Improve API plan",
            "",
            "## Scope",
            "- API routes only",
            "",
            "## Constraints",
            "- Keep backward compatibility",
            "",
            "## Steps",
            "1. Add route",
            "",
            "## Acceptance",
            "- tests pass",
          ].join("\n"),
        )
        return file
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = tmp.extra as string
        all.push(spyOn(Session, "get").mockResolvedValue({} as any))
        all.push(spyOn(Session, "plan").mockReturnValue(file))
        all.push(spyOn(Provider, "defaultModel").mockResolvedValue({ providerID: "openai", modelID: "gpt-5" } as any))
        all.push(spyOn(MessageV2, "stream").mockReturnValue((async function* () {})() as any))
        all.push(spyOn(Session, "updateMessage").mockResolvedValue(undefined as any))
        all.push(spyOn(Session, "updatePart").mockResolvedValue(undefined as any))
        all.push(spyOn(Question, "ask").mockResolvedValue([]))

        const tool = await PlanExitTool.init()
        await expect(tool.execute({}, ctx)).rejects.toThrow("Plan is not ready for finalize.")
      },
    })
  })
})
