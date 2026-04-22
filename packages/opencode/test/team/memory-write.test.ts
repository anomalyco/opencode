import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import * as TeamMemory from "../../src/team/memory"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("team memory write", () => {
  test("explicit id updates replace content instead of appending", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const first = await TeamMemory.write({
          area: TeamMemory.TeamMemory.Area.enum.lessons,
          class: TeamMemory.TeamMemory.Class.enum.knowledge,
          kind: TeamMemory.TeamMemory.Kind.enum.lesson,
          domain: TeamMemory.TeamMemory.Domain.enum.general,
          title: "Memory overwrite regression",
          content: "first version",
          tags: [],
          sessionID: SessionID.make("ses_test_memory"),
          actor: "ayaz",
        })

        const second = await TeamMemory.write({
          id: first.id,
          area: TeamMemory.TeamMemory.Area.enum.lessons,
          class: TeamMemory.TeamMemory.Class.enum.knowledge,
          kind: TeamMemory.TeamMemory.Kind.enum.lesson,
          domain: TeamMemory.TeamMemory.Domain.enum.general,
          title: "Memory overwrite regression",
          content: "second version",
          tags: [],
          sessionID: SessionID.make("ses_test_memory"),
          actor: "ayaz",
        })

        expect(second.content).toBe("second version")
        expect((await TeamMemory.get({ id: first.id }))?.content).toBe("second version")
      },
    })
  })
})
