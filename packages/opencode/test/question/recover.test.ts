import { afterEach, expect, test } from "bun:test"
import { Question } from "../../src/question"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"

const list = () => AppRuntime.runPromise(Question.Service.use((svc) => svc.list()))
const reply = (input: { requestID: Question.Request["id"]; answers: ReadonlyArray<Question.Answer> }) =>
  AppRuntime.runPromise(Question.Service.use((svc) => svc.reply(input)))
const reject = (requestID: Question.Request["id"]) =>
  AppRuntime.runPromise(Question.Service.use((svc) => svc.reject(requestID)))

afterEach(async () => {
  await resetDatabase()
})

function seed(input: { sessionID: SessionID; dir: string }) {
  const now = Date.now()
  const messageID = MessageID.ascending()

  Database.use((db) => {
    db.insert(SessionTable)
      .values({
        id: input.sessionID,
        project_id: Instance.project.id,
        slug: "test",
        directory: input.dir,
        title: "test session",
        version: "2",
        time_created: now,
        time_updated: now,
      })
      .run()

    db.insert(MessageTable)
      .values({
        id: messageID,
        session_id: input.sessionID,
        time_created: now,
        time_updated: now,
        data: {
          role: "assistant" as const,
          time: { created: now },
          parentID: "msg_fake",
          modelID: "test-model",
          providerID: "test-provider",
          mode: "default",
          agent: "coder",
          path: { cwd: input.dir, root: input.dir },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        } as typeof MessageTable.$inferInsert.data,
      })
      .run()
  })

  return messageID
}

function add(input: { sessionID: SessionID; messageID: MessageID }) {
  const partID = PartID.ascending()
  const now = Date.now()
  const questions = [
    {
      question: "Pick something?",
      header: "Choice",
      options: [
        { label: "A", description: "Option A" },
        { label: "B", description: "Option B" },
      ],
    },
  ]

  Database.use((db) => {
    db.insert(PartTable)
      .values({
        id: partID,
        message_id: input.messageID,
        session_id: input.sessionID,
        time_created: now,
        time_updated: now,
        data: {
          type: "tool",
          callID: `call_${partID}`,
          tool: "question",
          state: {
            status: "running" as const,
            input: { questions },
            time: { start: now },
          },
        } as typeof PartTable.$inferInsert.data,
      })
      .run()
  })

  return partID
}

test("recover - lists running question parts", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = SessionID.descending()
      const messageID = seed({ sessionID, dir: tmp.path })
      add({ sessionID, messageID })

      const pending = await list()
      expect(pending.length).toBe(1)
    },
  })
})

test("recover - reply updates DB part to completed", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = SessionID.descending()
      const messageID = seed({ sessionID, dir: tmp.path })
      const partID = add({ sessionID, messageID })

      const pending = await list()
      expect(pending.length).toBe(1)

      await reply({
        requestID: pending[0].id,
        answers: [["A"]],
      })

      const row = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, partID)).get())
      const data = row!.data as MessageV2.ToolPart
      expect(data.state.status).toBe("completed")
      if (data.state.status === "completed") {
        expect(data.state.output).toContain("A")
        expect(data.state.metadata.answers).toEqual([["A"]])
      }

      expect((await list()).length).toBe(0)
    },
  })
})

test("recover - reject updates DB part to error", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const sessionID = SessionID.descending()
      const messageID = seed({ sessionID, dir: tmp.path })
      const partID = add({ sessionID, messageID })

      const pending = await list()
      expect(pending.length).toBe(1)

      await reject(pending[0].id)

      const row = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, partID)).get())
      const data = row!.data as MessageV2.ToolPart
      expect(data.state.status).toBe("error")
      if (data.state.status === "error") {
        expect(data.state.error).toBe("The user dismissed this question")
      }

      expect((await list()).length).toBe(0)
    },
  })
})
