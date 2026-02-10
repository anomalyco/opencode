/**
 * Tests for the autoWake mechanism in TeamMessaging.
 *
 * autoWake is a private function called inside TeamMessaging.send() and
 * TeamMessaging.broadcast(). When a team message is injected into a
 * recipient's session, autoWake checks SessionStatus — if the session is
 * idle, it fires SessionPrompt.loop() so the LLM picks up the new message.
 *
 * In the test environment there is no LLM, so SessionPrompt.loop() will
 * fail. The important property autoWake guarantees is that the failure is
 * caught (logged, not thrown) so message delivery always succeeds.
 *
 * We verify:
 *  1. send() succeeds for idle recipients (auto-wake error is swallowed)
 *  2. send() succeeds for busy recipients (no wake attempted)
 *  3. broadcast() delivers to all non-shutdown members regardless of status
 *  4. Message format is correct: "[Team message from {name}]: {text}"
 *  5. Bus events (TeamEvent.Message / TeamEvent.Broadcast) are published
 *  6. Shutdown members are skipped during broadcast
 */
import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Team } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { TeamEvent } from "../../src/team/events"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function seedUserMessage(sessionID: string, text = "init") {
  const mid = Identifier.ascending("message")
  await Session.updateMessage({
    id: mid,
    sessionID,
    role: "user",
    agent: "general",
    model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: mid,
    sessionID,
    type: "text",
    text,
  })
  return mid
}

// ---------------------------------------------------------------------------
// send() – idle recipient
// ---------------------------------------------------------------------------

describe("autoWake: send to idle recipient", () => {
  test("send succeeds and message is injected even though auto-wake loop will fail (no LLM)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "wake-idle", leadSessionID: lead.id })
        await Team.addMember("wake-idle", {
          name: "worker",
          sessionID: member.id,
          agent: "general",
          status: "busy",
        })

        // Confirm member session is idle (default state — no prompt loop running)
        const before = SessionStatus.get(member.id)
        expect(before.type).toBe("idle")

        // send() should NOT throw even though autoWake fires and loop() fails
        await TeamMessaging.send({
          teamName: "wake-idle",
          from: "lead",
          to: "worker",
          text: "Please start task A",
        })

        // Verify the synthetic message was injected
        const msgs = await Session.messages({ sessionID: member.id })
        const received = msgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]")),
        )
        expect(received).toBeDefined()
        const part = received!.parts.find((p) => p.type === "text") as any
        expect(part.text).toBe("[Team message from lead]: Please start task A")

        await Team.setMemberStatus("wake-idle", "worker", "shutdown")
        await Team.cleanup("wake-idle")
      },
    })
  })

  test("message format is correct: [Team message from {name}]: {text}", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "fmt-team", leadSessionID: lead.id })
        await Team.addMember("fmt-team", {
          name: "reviewer",
          sessionID: member.id,
          agent: "general",
          status: "busy",
        })

        await TeamMessaging.send({
          teamName: "fmt-team",
          from: "reviewer",
          to: "lead",
          text: "Found 3 issues in auth module",
        })

        const msgs = await Session.messages({ sessionID: lead.id })
        const injected = msgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.startsWith("[Team message from reviewer]:")),
        )
        expect(injected).toBeDefined()

        const textPart = injected!.parts.find((p) => p.type === "text") as any
        expect(textPart.text).toBe("[Team message from reviewer]: Found 3 issues in auth module")
        expect(textPart.synthetic).toBe(true)

        await Team.setMemberStatus("fmt-team", "reviewer", "shutdown")
        await Team.cleanup("fmt-team")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// send() – busy recipient
// ---------------------------------------------------------------------------

describe("autoWake: send to busy recipient", () => {
  test("send succeeds and message is injected when recipient is busy (no wake attempted)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "wake-busy", leadSessionID: lead.id })
        await Team.addMember("wake-busy", {
          name: "worker",
          sessionID: member.id,
          agent: "general",
          status: "busy",
        })

        // Simulate a busy session (prompt loop already running)
        SessionStatus.set(member.id, { type: "busy" })
        expect(SessionStatus.get(member.id).type).toBe("busy")

        // send() should succeed — autoWake skips because status !== "idle"
        await TeamMessaging.send({
          teamName: "wake-busy",
          from: "lead",
          to: "worker",
          text: "Update on requirements",
        })

        // Message was still injected
        const msgs = await Session.messages({ sessionID: member.id })
        const received = msgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]")),
        )
        expect(received).toBeDefined()

        // Status should still be busy (autoWake did nothing)
        expect(SessionStatus.get(member.id).type).toBe("busy")

        // Reset status for cleanup
        SessionStatus.set(member.id, { type: "idle" })
        await Team.setMemberStatus("wake-busy", "worker", "shutdown")
        await Team.cleanup("wake-busy")
      },
    })
  })

  test("send succeeds when recipient is in retry state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "wake-retry", leadSessionID: lead.id })
        await Team.addMember("wake-retry", {
          name: "worker",
          sessionID: member.id,
          agent: "general",
          status: "busy",
        })

        // Set retry state — autoWake should skip (type !== "idle")
        SessionStatus.set(member.id, { type: "retry", attempt: 1, message: "rate limited", next: Date.now() + 5000 })
        expect(SessionStatus.get(member.id).type).toBe("retry")

        await TeamMessaging.send({
          teamName: "wake-retry",
          from: "lead",
          to: "worker",
          text: "Just checking in",
        })

        // Message still injected
        const msgs = await Session.messages({ sessionID: member.id })
        const received = msgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("Just checking in")))
        expect(received).toBeDefined()

        // Status unchanged
        expect(SessionStatus.get(member.id).type).toBe("retry")

        SessionStatus.set(member.id, { type: "idle" })
        await Team.setMemberStatus("wake-retry", "worker", "shutdown")
        await Team.cleanup("wake-retry")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// broadcast() – autoWake across multiple members
// ---------------------------------------------------------------------------

describe("autoWake: broadcast", () => {
  test("broadcast delivers to all active members regardless of idle/busy status", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const idle1 = await Session.create({ parentID: lead.id })
        const idle2 = await Session.create({ parentID: lead.id })
        const busy1 = await Session.create({ parentID: lead.id })

        await seedUserMessage(lead.id)
        await seedUserMessage(idle1.id)
        await seedUserMessage(idle2.id)
        await seedUserMessage(busy1.id)

        await Team.create({ name: "bcast-wake", leadSessionID: lead.id })
        await Team.addMember("bcast-wake", { name: "idle-a", sessionID: idle1.id, agent: "general", status: "busy" })
        await Team.addMember("bcast-wake", { name: "idle-b", sessionID: idle2.id, agent: "general", status: "busy" })
        await Team.addMember("bcast-wake", { name: "busy-c", sessionID: busy1.id, agent: "general", status: "busy" })

        // idle-a and idle-b are idle (default), busy-c is busy
        SessionStatus.set(busy1.id, { type: "busy" })

        // Broadcast from lead to all members
        await TeamMessaging.broadcast({
          teamName: "bcast-wake",
          from: "lead",
          text: "New priority: focus on auth module",
        })

        // All three members should have received the message
        for (const [name, sid] of [
          ["idle-a", idle1.id],
          ["idle-b", idle2.id],
          ["busy-c", busy1.id],
        ] as const) {
          const msgs = await Session.messages({ sessionID: sid })
          const received = msgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("New priority")))
          expect(received).toBeDefined()
        }

        // busy-c should still be busy
        expect(SessionStatus.get(busy1.id).type).toBe("busy")

        // Cleanup
        SessionStatus.set(busy1.id, { type: "idle" })
        for (const name of ["idle-a", "idle-b", "busy-c"]) {
          await Team.setMemberStatus("bcast-wake", name, "shutdown")
        }
        await Team.cleanup("bcast-wake")
      },
    })
  })

  test("broadcast skips shutdown members", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const active = await Session.create({ parentID: lead.id })
        const shutdown = await Session.create({ parentID: lead.id })

        await seedUserMessage(lead.id)
        await seedUserMessage(active.id)
        await seedUserMessage(shutdown.id)

        await Team.create({ name: "bcast-skip", leadSessionID: lead.id })
        await Team.addMember("bcast-skip", { name: "alive", sessionID: active.id, agent: "general", status: "busy" })
        await Team.addMember("bcast-skip", {
          name: "dead",
          sessionID: shutdown.id,
          agent: "general",
          status: "shutdown",
        })

        await TeamMessaging.broadcast({
          teamName: "bcast-skip",
          from: "lead",
          text: "Are you there?",
        })

        // Active member gets the message
        const activeMsgs = await Session.messages({ sessionID: active.id })
        const received = activeMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("Are you there?")),
        )
        expect(received).toBeDefined()

        // Shutdown member does NOT get the message
        const shutdownMsgs = await Session.messages({ sessionID: shutdown.id })
        const skipped = shutdownMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("Are you there?")),
        )
        expect(skipped).toBeUndefined()

        await Team.setMemberStatus("bcast-skip", "alive", "shutdown")
        await Team.cleanup("bcast-skip")
      },
    })
  })

  test("broadcast from member excludes sender but includes lead", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const memberA = await Session.create({ parentID: lead.id })
        const memberB = await Session.create({ parentID: lead.id })

        await seedUserMessage(lead.id)
        await seedUserMessage(memberA.id)
        await seedUserMessage(memberB.id)

        await Team.create({ name: "bcast-sender", leadSessionID: lead.id })
        await Team.addMember("bcast-sender", {
          name: "alice",
          sessionID: memberA.id,
          agent: "general",
          status: "busy",
        })
        await Team.addMember("bcast-sender", { name: "bob", sessionID: memberB.id, agent: "general", status: "busy" })

        // alice broadcasts
        await TeamMessaging.broadcast({
          teamName: "bcast-sender",
          from: "alice",
          text: "I found something important",
        })

        // Lead should receive it
        const leadMsgs = await Session.messages({ sessionID: lead.id })
        const leadReceived = leadMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("I found something important")),
        )
        expect(leadReceived).toBeDefined()

        // bob should receive it
        const bobMsgs = await Session.messages({ sessionID: memberB.id })
        const bobReceived = bobMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("I found something important")),
        )
        expect(bobReceived).toBeDefined()

        // alice (sender) should NOT receive it
        const aliceMsgs = await Session.messages({ sessionID: memberA.id })
        const aliceReceived = aliceMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("I found something important")),
        )
        expect(aliceReceived).toBeUndefined()

        for (const name of ["alice", "bob"]) {
          await Team.setMemberStatus("bcast-sender", name, "shutdown")
        }
        await Team.cleanup("bcast-sender")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Bus events
// ---------------------------------------------------------------------------

describe("autoWake: bus events are published", () => {
  test("send publishes TeamEvent.Message", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "event-send", leadSessionID: lead.id })
        await Team.addMember("event-send", { name: "worker", sessionID: member.id, agent: "general", status: "busy" })

        const events: any[] = []
        const unsub = Bus.subscribe(TeamEvent.Message, (event) => {
          events.push(event.properties)
        })

        await TeamMessaging.send({
          teamName: "event-send",
          from: "lead",
          to: "worker",
          text: "Do the thing",
        })

        unsub()

        expect(events).toHaveLength(1)
        expect(events[0].teamName).toBe("event-send")
        expect(events[0].from).toBe("lead")
        expect(events[0].to).toBe("worker")
        expect(events[0].text).toBe("Do the thing")

        await Team.setMemberStatus("event-send", "worker", "shutdown")
        await Team.cleanup("event-send")
      },
    })
  })

  test("broadcast publishes TeamEvent.Broadcast", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "event-bcast", leadSessionID: lead.id })
        await Team.addMember("event-bcast", {
          name: "worker",
          sessionID: member.id,
          agent: "general",
          status: "busy",
        })

        const events: any[] = []
        const unsub = Bus.subscribe(TeamEvent.Broadcast, (event) => {
          events.push(event.properties)
        })

        await TeamMessaging.broadcast({
          teamName: "event-bcast",
          from: "lead",
          text: "All hands update",
        })

        unsub()

        expect(events).toHaveLength(1)
        expect(events[0].teamName).toBe("event-bcast")
        expect(events[0].from).toBe("lead")
        expect(events[0].text).toBe("All hands update")

        await Team.setMemberStatus("event-bcast", "worker", "shutdown")
        await Team.cleanup("event-bcast")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Error resilience
// ---------------------------------------------------------------------------

describe("autoWake: error resilience", () => {
  test("send to idle recipient does not throw even though loop() fails internally", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "resilient", leadSessionID: lead.id })
        await Team.addMember("resilient", { name: "worker", sessionID: member.id, agent: "general", status: "busy" })

        // Member session is idle → autoWake will try SessionPrompt.loop()
        // which will fail (no LLM/agent config in test). The error must be caught.
        expect(SessionStatus.get(member.id).type).toBe("idle")

        // This must NOT throw
        await TeamMessaging.send({
          teamName: "resilient",
          from: "lead",
          to: "worker",
          text: "This should not fail",
        })

        // The message was still delivered
        const msgs = await Session.messages({ sessionID: member.id })
        const received = msgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("This should not fail")),
        )
        expect(received).toBeDefined()

        await Team.setMemberStatus("resilient", "worker", "shutdown")
        await Team.cleanup("resilient")
      },
    })
  })

  test("broadcast with mix of idle and busy members does not throw", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const s1 = await Session.create({ parentID: lead.id })
        const s2 = await Session.create({ parentID: lead.id })

        await seedUserMessage(lead.id)
        await seedUserMessage(s1.id)
        await seedUserMessage(s2.id)

        await Team.create({ name: "resilient-bcast", leadSessionID: lead.id })
        await Team.addMember("resilient-bcast", {
          name: "idle-one",
          sessionID: s1.id,
          agent: "general",
          status: "busy",
        })
        await Team.addMember("resilient-bcast", {
          name: "busy-one",
          sessionID: s2.id,
          agent: "general",
          status: "busy",
        })

        SessionStatus.set(s2.id, { type: "busy" })

        // Must NOT throw despite idle member triggering a failing loop()
        await TeamMessaging.broadcast({
          teamName: "resilient-bcast",
          from: "lead",
          text: "Broadcast that must not fail",
        })

        // Both members got the message
        for (const sid of [s1.id, s2.id]) {
          const msgs = await Session.messages({ sessionID: sid })
          const received = msgs.find((m) =>
            m.parts.some((p) => p.type === "text" && p.text.includes("Broadcast that must not fail")),
          )
          expect(received).toBeDefined()
        }

        SessionStatus.set(s2.id, { type: "idle" })
        for (const name of ["idle-one", "busy-one"]) {
          await Team.setMemberStatus("resilient-bcast", name, "shutdown")
        }
        await Team.cleanup("resilient-bcast")
      },
    })
  })

  test("multiple rapid sends to idle session all succeed", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const member = await Session.create({ parentID: lead.id })
        await seedUserMessage(lead.id)
        await seedUserMessage(member.id)

        await Team.create({ name: "rapid-wake", leadSessionID: lead.id })
        await Team.addMember("rapid-wake", { name: "worker", sessionID: member.id, agent: "general", status: "busy" })

        // Fire multiple sends rapidly — all should succeed
        await Promise.all([
          TeamMessaging.send({ teamName: "rapid-wake", from: "lead", to: "worker", text: "msg-1" }),
          TeamMessaging.send({ teamName: "rapid-wake", from: "lead", to: "worker", text: "msg-2" }),
          TeamMessaging.send({ teamName: "rapid-wake", from: "lead", to: "worker", text: "msg-3" }),
        ])

        const msgs = await Session.messages({ sessionID: member.id })
        const teamMsgs = msgs.filter((m) =>
          m.parts.some((p) => p.type === "text" && p.text.startsWith("[Team message from lead]:")),
        )
        expect(teamMsgs).toHaveLength(3)

        await Team.setMemberStatus("rapid-wake", "worker", "shutdown")
        await Team.cleanup("rapid-wake")
      },
    })
  })
})
