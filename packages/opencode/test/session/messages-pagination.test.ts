import { describe, expect, test } from "bun:test"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const TEST_TIMEOUT_MS = 30_000

describe("session messages pagination", () => {
  test(
    "should paginate messages correctly",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const sessionID = session.id
          const messageCount = 10
          const messageIds: string[] = []

          // Create 10 messages
          for (let i = 0; i < messageCount; i++) {
            const msg = await Session.updateMessage({
              id: Identifier.ascending("message"),
              role: "user",
              sessionID,
              agent: "default",
              model: { providerID: "openai", modelID: "gpt-4" },
              // time is optional/handled by default, ULID handles ordering
              time: { created: Date.now() },
            })
            messageIds.push(msg.id)
            await Session.updatePart({
              id: Identifier.ascending("part"),
              messageID: msg.id,
              sessionID,
              type: "text",
              text: `Message ${i}`,
            })
          }

          // 1. Initial load (limit 3) -> should get last 3 (7, 8, 9)
          const page1 = await Session.messages({
            sessionID,
            limit: 3,
          })
          expect(page1.length).toBe(3)
          expect(page1[0].info.id).toBe(messageIds[7])
          expect(page1[2].info.id).toBe(messageIds[9])

          // 2. Load before page1[0] (limit 3) -> should get 4, 5, 6
          const page2 = await Session.messages({
            sessionID,
            limit: 3,
            before: page1[0].info.id,
          })
          expect(page2.length).toBe(3)
          expect(page2[0].info.id).toBe(messageIds[4])
          expect(page2[2].info.id).toBe(messageIds[6])

          // 3. Load before page2[0] (limit 3) -> should get 1, 2, 3
          const page3 = await Session.messages({
            sessionID,
            limit: 3,
            before: page2[0].info.id,
          })
          expect(page3.length).toBe(3)
          expect(page3[0].info.id).toBe(messageIds[1])
          expect(page3[2].info.id).toBe(messageIds[3])

          // 4. Load before page3[0] (limit 3) -> should get 0 (and only 1 message)
          const page4 = await Session.messages({
            sessionID,
            limit: 3,
            before: page3[0].info.id,
          })
          expect(page4.length).toBe(1)
          expect(page4[0].info.id).toBe(messageIds[0])

          // 5. Load before page4[0] -> should be empty
          const page5 = await Session.messages({
            sessionID,
            limit: 3,
            before: page4[0].info.id,
          })
          expect(page5.length).toBe(0)

          // 6. Test boundary: exact match (before message 9, should get 0..8)
          // Wait, 'before' filters out the cursor itself.
          // If IDs are [0..9]. before=ids[9].
          // Should get ids[0..8]. Length 9.
          const exact = await Session.messages({
            sessionID,
            limit: 10,
            before: messageIds[9],
          })
          expect(exact.length).toBe(9)
          expect(exact[8].info.id).toBe(messageIds[8])

          // 7. Test boundary: unknown cursor (lexicographically larger)
          const unknownFuture = "msg" + "z".repeat(26)
          const pageFuture = await Session.messages({
            sessionID,
            limit: 3,
            before: unknownFuture,
          })
          expect(pageFuture.length).toBe(3)
          expect(pageFuture[2].info.id).toBe(messageIds[9])

          // 8. Test boundary: unknown cursor (lexicographically smaller)
          const unknownPast = "msg" + "0".repeat(26)
          const pagePast = await Session.messages({
            sessionID,
            limit: 3,
            before: unknownPast,
          })
          expect(pagePast.length).toBe(0)

          // 9. Test concurrent load
          const [res1, res2] = await Promise.all([
            Session.messages({ sessionID, limit: 3, before: page1[0].info.id }),
            Session.messages({ sessionID, limit: 3, before: page1[0].info.id }),
          ])

          expect(res1[0].info.id).toBe(res2[0].info.id)
        },
      })
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "handles deleted message during pagination",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const sessionID = session.id
          const messageIds: string[] = []

          // Create 10 messages
          for (let i = 0; i < 10; i++) {
            const msg = await Session.updateMessage({
              id: Identifier.ascending("message"),
              role: "user",
              sessionID,
              agent: "default",
              model: { providerID: "openai", modelID: "gpt-4" },
              time: { created: Date.now() },
            })
            messageIds.push(msg.id)
          }

          // Get first page (messages 6-10)
          const page1 = await Session.messages({ sessionID, limit: 5 })
          expect(page1.length).toBe(5)
          expect(page1[4].info.id).toBe(messageIds[9]) // Last message is most recent

          // Delete message 3 (which would be in the next page, index 2)
          await Session.removeMessage({ sessionID, messageID: messageIds[2] })

          // Request next page with cursor from page1
          const page2 = await Session.messages({ sessionID, limit: 5, before: page1[0].info.id })

          // Verify remaining messages are returned without error
          // Should get 0, 1, 3, 4 (since 2 was deleted) = 4 messages
          // OR 0, 1, 3, 4 + one more if available? No, limit applies to ID list which is stale?
          // Storage.list is re-run, so index 2 is gone.
          // IDs: [0, 1, 3, 4, 5, 6, 7, 8, 9]
          // Cursor: before 5 (index 4 in new list)
          // binaryLowerBound(5) -> index 4
          // start = 3
          // loop: 3, 2, 1, 0 -> IDs[3]=4, IDs[2]=3, IDs[1]=1, IDs[0]=0
          expect(page2.length).toBe(4)
          expect(page2.map((m) => m.info.id)).toEqual([messageIds[0], messageIds[1], messageIds[3], messageIds[4]])
        },
      })
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "message IDs are lexicographically sorted (ULID invariant)",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const messageIds: string[] = []

          for (let i = 0; i < 5; i++) {
            const msg = await Session.updateMessage({
              id: Identifier.ascending("message"),
              role: "user",
              sessionID: session.id,
              agent: "default",
              model: { providerID: "openai", modelID: "gpt-4" },
              time: { created: Date.now() },
            })
            messageIds.push(msg.id)
          }

          // Verify IDs are lexicographically sorted (ULID invariant for binary search)
          for (let i = 1; i < messageIds.length; i++) {
            expect(messageIds[i] > messageIds[i - 1]).toBe(true)
          }
        },
      })
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "after cursor returns messages after cursor (ascending)",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const sessionID = session.id
          const messageIds: string[] = []

          for (let i = 0; i < 10; i++) {
            const msg = await Session.updateMessage({
              id: Identifier.ascending("message"),
              role: "user",
              sessionID,
              agent: "default",
              model: { providerID: "openai", modelID: "gpt-4" },
              time: { created: Date.now() },
            })
            messageIds.push(msg.id)
          }

          // after=msg[2] should return msg[3], msg[4], msg[5] (limit 3)
          const page1 = await Session.messages({
            sessionID,
            limit: 3,
            after: messageIds[2],
          })
          expect(page1.length).toBe(3)
          expect(page1[0].info.id).toBe(messageIds[3])
          expect(page1[1].info.id).toBe(messageIds[4])
          expect(page1[2].info.id).toBe(messageIds[5])

          // after=msg[8] should return msg[9] only
          const page2 = await Session.messages({
            sessionID,
            limit: 3,
            after: messageIds[8],
          })
          expect(page2.length).toBe(1)
          expect(page2[0].info.id).toBe(messageIds[9])

          // after=msg[9] (last) should return empty
          const page3 = await Session.messages({
            sessionID,
            limit: 3,
            after: messageIds[9],
          })
          expect(page3.length).toBe(0)
        },
      })
    },
    TEST_TIMEOUT_MS,
  )

  test(
    "cannot specify both before and after cursors",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const sessionID = session.id

          const msg = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID,
            agent: "default",
            model: { providerID: "openai", modelID: "gpt-4" },
            time: { created: Date.now() },
          })

          await expect(
            Session.messages({
              sessionID,
              limit: 3,
              before: msg.id,
              after: msg.id,
            }),
          ).rejects.toThrow("Cannot specify both")
        },
      })
    },
    TEST_TIMEOUT_MS,
  )
})
