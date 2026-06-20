#!/usr/bin/env bun
/**
 * Comprehensive integration test for Agent Teams — uses REAL Anthropic API
 * via Claude Max auth plugin.
 *
 * This script runs OUTSIDE of `bun test` to avoid the isolating preload.ts
 * that strips API keys and redirects XDG dirs. It uses your real
 * ~/.config/opencode/opencode.json with the Claude CLI auth plugin.
 *
 * Usage:
 *   cd /tmp/opencode/packages/opencode
 *   bun run test/team/team-integration.ts
 *
 * Requirements:
 *   - Claude Max subscription with working auth (opencode-anthropic-auth plugin)
 *   - OPENCODE_EXPERIMENTAL_AGENT_TEAMS=1 (set below)
 *
 * Costs ~5-8 small LLM calls worth of tokens.
 */

import path from "path"
import os from "os"
import fs from "fs/promises"
import { $ } from "bun"

// ---------- Environment setup ----------
process.env["OPENCODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
process.env["OPENCODE_MODELS_PATH"] = path.join(import.meta.dir, "../tool/fixtures/models-api.json")

// ---------- Imports (after env setup) ----------
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Team, TeamTasks, type TeamTask } from "../../src/team"
import { TeamMessaging } from "../../src/team/messaging"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"
import { Plugin } from "../../src/plugin"
import { Bus } from "../../src/bus"
import { TeamEvent } from "../../src/team/events"
import {
  TeamCreateTool,
  TeamSpawnTool,
  TeamMessageTool,
  TeamBroadcastTool,
  TeamTasksTool,
  TeamClaimTool,
  TeamShutdownTool,
  TeamCleanupTool,
} from "../../src/tool/team"

Log.init({ print: true, dev: true, level: "INFO" })

// ---------- Test framework ----------
let passed = 0
let failed = 0
const errors: string[] = []
const startTime = Date.now()

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed++
    errors.push(message)
    console.error(`  FAIL: ${message}`)
  } else {
    passed++
    console.log(`  PASS: ${message}`)
  }
}

async function assertThrows(fn: () => Promise<any>, substring: string, message: string) {
  try {
    await fn()
    failed++
    errors.push(`${message} — expected throw but did not`)
    console.error(`  FAIL: ${message} — expected throw`)
  } catch (err: any) {
    if (err.message?.includes(substring)) {
      passed++
      console.log(`  PASS: ${message}`)
    } else {
      failed++
      errors.push(`${message} — wrong error: "${err.message}" (expected to contain "${substring}")`)
      console.error(`  FAIL: ${message} — wrong error: ${err.message}`)
    }
  }
}

function mockCtx(sessionID: string, messages: MessageV2.WithParts[] = []) {
  return {
    sessionID,
    messageID: Identifier.ascending("message"),
    agent: "general",
    abort: new AbortController().signal,
    messages,
    metadata: () => {},
    ask: async () => {},
  } as any
}

async function createTmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), "opencode-integ-" + Math.random().toString(36).slice(2))
  await fs.mkdir(dir, { recursive: true })
  await $`git init`.cwd(dir).quiet()
  await $`git commit --allow-empty -m "root"`.cwd(dir).quiet()
  return await fs.realpath(dir)
}

/** Create a user message in a session (needed for messaging to resolve model info) */
async function seedUserMessage(sessionID: string, text: string = "init") {
  const mid = Identifier.ascending("message")
  await Session.updateMessage({
    id: mid,
    sessionID,
    role: "user",
    agent: "general",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
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

/** Wait for a condition with timeout */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 60000,
  intervalMs: number = 250,
  description: string = "condition",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  console.error(`  TIMEOUT waiting for: ${description}`)
  return false
}

// ---------- Test sections ----------

async function testTeamCreation(leadSession: Session.Info) {
  console.log("\n========== 1. Team Creation ==========")

  const createTool = await TeamCreateTool.init()
  const result = await createTool.execute(
    {
      name: "full-team",
      tasks: [
        { id: "t1", content: "Research auth patterns", priority: "high" },
        { id: "t2", content: "Implement auth module", priority: "high", depends_on: ["t1"] },
        { id: "t3", content: "Write auth tests", priority: "medium", depends_on: ["t2"] },
        { id: "t4", content: "Review security", priority: "high", depends_on: ["t1"] },
        { id: "t5", content: "Integration testing", priority: "low", depends_on: ["t2", "t4"] },
      ],
    },
    mockCtx(leadSession.id),
  )
  assert(result.metadata.teamName === "full-team", "Team created successfully")

  const team = await Team.get("full-team")
  assert(team !== undefined, "Team persisted to disk")
  assert(team!.leadSessionID === leadSession.id, "Lead session ID correct")
  assert(team!.members.length === 0, "No members initially")

  const tasks = await TeamTasks.list("full-team")
  assert(tasks.length === 5, "5 tasks created")
  assert(tasks.find((t) => t.id === "t1")!.status === "pending", "t1 pending (no deps)")
  assert(tasks.find((t) => t.id === "t2")!.status === "blocked", "t2 blocked by t1")
  assert(tasks.find((t) => t.id === "t3")!.status === "blocked", "t3 blocked by t2")
  assert(tasks.find((t) => t.id === "t4")!.status === "blocked", "t4 blocked by t1")
  assert(tasks.find((t) => t.id === "t5")!.status === "blocked", "t5 blocked by t2 and t4")
}

async function testConstraintEnforcement(leadSession: Session.Info) {
  console.log("\n========== 2. Constraint Enforcement ==========")

  const createTool = await TeamCreateTool.init()
  const spawnTool = await TeamSpawnTool.init()
  const shutdownTool = await TeamShutdownTool.init()

  // One team per lead
  const dupResult = await createTool.execute(
    { name: "dup-team" },
    mockCtx(leadSession.id),
  )
  assert(dupResult.title === "Error", "Duplicate team creation rejected")
  assert(dupResult.output.includes("already leading"), "Correct error: already leading")

  // Add a member to test no-nesting
  const memberSession = await Session.create({ parentID: leadSession.id })
  await seedUserMessage(memberSession.id)
  await Team.addMember("full-team", {
    name: "constraint-test-member",
    sessionID: memberSession.id,
    agent: "general",
    status: "busy",
  })

  // Member cannot create team
  const memberCreateResult = await createTool.execute(
    { name: "nested-team" },
    mockCtx(memberSession.id),
  )
  assert(memberCreateResult.title === "Error", "Member team creation rejected")
  assert(memberCreateResult.output.includes("Teammates cannot create"), "Correct no-nesting error")

  // Member cannot spawn
  const memberSpawnResult = await spawnTool.execute(
    { name: "nested-spawn", prompt: "do something" },
    mockCtx(memberSession.id),
  )
  assert(memberSpawnResult.title === "Error", "Member spawn rejected")
  assert(memberSpawnResult.output.includes("Teammates cannot spawn"), "Correct spawn error")

  // Non-lead cannot shutdown
  const memberShutdownResult = await shutdownTool.execute(
    { name: "someone" },
    mockCtx(memberSession.id),
  )
  assert(memberShutdownResult.title === "Error", "Member shutdown rejected")
  assert(memberShutdownResult.output.includes("Only the team lead"), "Correct shutdown error")

  // Session not in any team
  const orphanSession = await Session.create({})
  const orphanClaimTool = await TeamClaimTool.init()
  const orphanResult = await orphanClaimTool.execute(
    { task_id: "t1" },
    mockCtx(orphanSession.id),
  )
  assert(orphanResult.title === "Error", "Orphan session claim rejected")
  assert(orphanResult.output.includes("not part of any team"), "Correct orphan error")

  // Spawn with unknown agent
  const badAgentResult = await spawnTool.execute(
    { name: "bad-agent", agent: "nonexistent-agent-xyz", prompt: "test" },
    mockCtx(leadSession.id),
  )
  assert(badAgentResult.title === "Error", "Unknown agent rejected")
  assert(badAgentResult.output.includes("not found"), "Correct unknown agent error")

  // Cleanup: remove the constraint test member
  await Team.setMemberStatus("full-team", "constraint-test-member", "shutdown")
  await Team.removeMember("full-team", "constraint-test-member")
}

async function testTeamSpawnWithRealLoop(leadSession: Session.Info) {
  console.log("\n========== 3. TeamSpawnTool with Real LLM Loop ==========")

  // Seed lead session with user message so spawn can resolve model
  await seedUserMessage(leadSession.id)

  const spawnTool = await TeamSpawnTool.init()

  // Get lead's messages to pass to ctx (TeamSpawnTool reads ctx.messages for model resolution)
  const leadMsgs = await Session.messages({ sessionID: leadSession.id })

  // Spawn researcher — this calls SessionPrompt.loop() in background against REAL Anthropic
  console.log("  Spawning researcher teammate (real LLM call)...")
  const spawnResult = await spawnTool.execute(
    {
      name: "researcher",
      agent: "general",
      prompt: "Respond with exactly: RESEARCH COMPLETE. Do not use any tools. Just reply with that text.",
      claim_task: "t1",
    },
    mockCtx(leadSession.id, leadMsgs),
  )
  assert(spawnResult.title.includes("Spawned"), "Researcher spawned")
  assert(spawnResult.metadata.memberName === "researcher", "Correct member name in metadata")
  assert(typeof spawnResult.metadata.sessionID === "string", "Session ID returned")

  const researcherSessionID = spawnResult.metadata.sessionID as string

  // Verify member registered
  const team = await Team.get("full-team")
  const researcherMember = team!.members.find((m) => m.name === "researcher")
  assert(researcherMember !== undefined, "Researcher registered as member")
  assert(researcherMember!.agent === "general", "Researcher agent is general")
  assert(researcherMember!.status === "busy", "Researcher initially active")
  assert(researcherMember!.prompt !== undefined, "Researcher prompt stored")

  // Verify task was auto-claimed
  let tasks = await TeamTasks.list("full-team")
  const t1 = tasks.find((t) => t.id === "t1")!
  assert(t1.status === "in_progress", "t1 auto-claimed to in_progress")
  assert(t1.assignee === "researcher", "t1 assigned to researcher")

  // Wait for the researcher's loop to finish (real LLM call)
  console.log("  Waiting for researcher loop to complete...")
  const loopDone = await waitFor(async () => {
    const t = await Team.get("full-team")
    const member = t?.members.find((m) => m.name === "researcher")
    return member?.status === "ready"
  }, 90000, 500, "researcher to go idle")
  assert(loopDone, "Researcher loop finished and status set to idle")

  // Verify researcher produced an assistant message
  const researcherMsgs = await Session.messages({ sessionID: researcherSessionID })
  const assistantMsg = researcherMsgs.find((m) => m.info.role === "assistant")
  assert(assistantMsg !== undefined, "Researcher produced assistant message")
  const textPart = assistantMsg?.parts.find((p) => p.type === "text") as any
  assert(textPart !== undefined, "Assistant has text part")
  console.log(`  Researcher LLM response: "${textPart?.text?.slice(0, 120)}"`)

  // Verify idle notification was sent to lead
  const leadMsgsAfter = await Session.messages({ sessionID: leadSession.id })
  const idleNotification = leadMsgsAfter.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from researcher]") && p.text.includes("finished")),
  )
  assert(idleNotification !== undefined, "Lead received idle notification from researcher")

  return researcherSessionID
}

async function testMultipleTeammatesConcurrent(leadSession: Session.Info) {
  console.log("\n========== 4. Multiple Teammates Running Concurrently ==========")

  const spawnTool = await TeamSpawnTool.init()
  const leadMsgs = await Session.messages({ sessionID: leadSession.id })

  // Spawn two more teammates concurrently
  console.log("  Spawning reviewer and implementer concurrently (real LLM calls)...")
  const [spawnReviewer, spawnImplementer] = await Promise.all([
    spawnTool.execute(
      {
        name: "reviewer",
        agent: "general",
        prompt: "Respond with exactly: REVIEW COMPLETE. Do not use any tools.",
      },
      mockCtx(leadSession.id, leadMsgs),
    ),
    spawnTool.execute(
      {
        name: "implementer",
        agent: "general",
        prompt: "Respond with exactly: IMPLEMENTATION COMPLETE. Do not use any tools.",
      },
      mockCtx(leadSession.id, leadMsgs),
    ),
  ])

  assert(spawnReviewer.title.includes("Spawned"), "Reviewer spawned")
  assert(spawnImplementer.title.includes("Spawned"), "Implementer spawned")

  const reviewerSessionID = spawnReviewer.metadata.sessionID as string
  const implementerSessionID = spawnImplementer.metadata.sessionID as string

  // Verify both registered
  const team = await Team.get("full-team")
  assert(team!.members.filter((m) => m.status === "busy" || m.status === "ready").length >= 2, "Multiple active/idle members")

  // Wait for both to go idle
  console.log("  Waiting for both teammates to finish...")
  const bothDone = await waitFor(async () => {
    const t = await Team.get("full-team")
    const reviewer = t?.members.find((m) => m.name === "reviewer")
    const implementer = t?.members.find((m) => m.name === "implementer")
    return reviewer?.status === "ready" && implementer?.status === "ready"
  }, 90000, 500, "reviewer and implementer to go idle")
  assert(bothDone, "Both teammates finished concurrently")

  // Verify both produced responses
  for (const [name, sid] of [
    ["reviewer", reviewerSessionID],
    ["implementer", implementerSessionID],
  ] as const) {
    const msgs = await Session.messages({ sessionID: sid })
    const assistant = msgs.find((m) => m.info.role === "assistant")
    assert(assistant !== undefined, `${name} produced assistant message`)
    const text = assistant?.parts.find((p) => p.type === "text") as any
    console.log(`  ${name} LLM response: "${text?.text?.slice(0, 120)}"`)
  }

  // Verify idle notifications from both
  const allLeadMsgs = await Session.messages({ sessionID: leadSession.id })
  const reviewerNotif = allLeadMsgs.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from reviewer]") && p.text.includes("finished")),
  )
  const implementerNotif = allLeadMsgs.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from implementer]") && p.text.includes("finished")),
  )
  assert(reviewerNotif !== undefined, "Lead received idle notification from reviewer")
  assert(implementerNotif !== undefined, "Lead received idle notification from implementer")

  return { reviewerSessionID, implementerSessionID }
}

async function testMessaging(leadSession: Session.Info, teammateSessionIDs: Record<string, string>) {
  console.log("\n========== 5. Inter-Session Messaging ==========")

  const messageTool = await TeamMessageTool.init()
  const broadcastTool = await TeamBroadcastTool.init()

  // Lead messages a specific teammate
  const msgResult = await messageTool.execute(
    { to: "researcher", text: "Can you elaborate on your findings?" },
    mockCtx(leadSession.id),
  )
  assert(msgResult.title.includes("Message sent"), "Lead -> researcher message sent")

  // Verify researcher received it
  const researcherMsgs = await Session.messages({ sessionID: teammateSessionIDs.researcher })
  const fromLead = researcherMsgs.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]")),
  )
  assert(fromLead !== undefined, "Researcher received message from lead")

  // Teammate messages another teammate
  await TeamMessaging.send({
    teamName: "full-team",
    from: "reviewer",
    to: "implementer",
    text: "Check the error handling in auth.ts line 42",
  })

  const implMsgs = await Session.messages({ sessionID: teammateSessionIDs.implementer })
  const fromReviewer = implMsgs.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from reviewer]")),
  )
  assert(fromReviewer !== undefined, "Implementer received message from reviewer")
  assert(
    fromReviewer!.parts.some((p) => p.type === "text" && p.text.includes("error handling")),
    "Message content preserved correctly",
  )

  // Teammate messages lead
  await TeamMessaging.send({
    teamName: "full-team",
    from: "implementer",
    to: "lead",
    text: "I need clarification on the token refresh strategy",
  })

  const leadMsgs = await Session.messages({ sessionID: leadSession.id })
  const fromImplementer = leadMsgs.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from implementer]") && p.text.includes("token refresh")),
  )
  assert(fromImplementer !== undefined, "Lead received message from implementer")

  // Messaging to non-existent teammate
  try {
    await TeamMessaging.send({
      teamName: "full-team",
      from: "lead",
      to: "ghost",
      text: "hello",
    })
    failed++
    errors.push("Messaging non-existent teammate should throw")
    console.error("  FAIL: Messaging non-existent teammate should throw")
  } catch (err: any) {
    assert(err.message.includes("not found"), "Messaging non-existent teammate throws")
  }

  // Messaging to non-existent team
  try {
    await TeamMessaging.send({
      teamName: "nonexistent-team",
      from: "lead",
      to: "someone",
      text: "hello",
    })
    failed++
    errors.push("Messaging non-existent team should throw")
    console.error("  FAIL: Messaging non-existent team should throw")
  } catch (err: any) {
    assert(err.message.includes("not found"), "Messaging non-existent team throws")
  }
}

async function testBroadcast(leadSession: Session.Info, teammateSessionIDs: Record<string, string>) {
  console.log("\n========== 6. Broadcast ==========")

  // Lead broadcasts to all teammates
  const broadcastTool = await TeamBroadcastTool.init()
  const bcastResult = await broadcastTool.execute(
    { text: "IMPORTANT: New deadline - wrap up by EOD" },
    mockCtx(leadSession.id),
  )
  assert(bcastResult.title === "Broadcast sent", "Broadcast tool returned success")

  // All teammates should receive it
  for (const [name, sid] of Object.entries(teammateSessionIDs)) {
    const msgs = await Session.messages({ sessionID: sid })
    const bcast = msgs.find((m) =>
      m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from lead]") && p.text.includes("New deadline")),
    )
    assert(bcast !== undefined, `${name} received broadcast from lead`)
  }

  // Lead should NOT receive their own broadcast
  const leadMsgs = await Session.messages({ sessionID: leadSession.id })
  const selfBcast = leadMsgs.find((m) =>
    m.parts.some((p) => p.type === "text" && p.text.includes("New deadline") && p.text.includes("[Team message from lead]")),
  )
  assert(selfBcast === undefined, "Lead did NOT receive own broadcast")

  // Teammate broadcasts to all others
  await TeamMessaging.broadcast({
    teamName: "full-team",
    from: "researcher",
    text: "FYI: auth spec updated in docs/auth.md",
  })

  // Other teammates and lead should receive, but not researcher
  const leadBcast = await Session.messages({ sessionID: leadSession.id }).then((msgs) =>
    msgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("auth spec updated"))),
  )
  assert(leadBcast !== undefined, "Lead received teammate broadcast")

  const reviewerBcast = await Session.messages({ sessionID: teammateSessionIDs.reviewer }).then((msgs) =>
    msgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("auth spec updated"))),
  )
  assert(reviewerBcast !== undefined, "Reviewer received teammate broadcast")

  // Researcher should NOT receive own broadcast
  const selfBcast2 = await Session.messages({ sessionID: teammateSessionIDs.researcher }).then((msgs) =>
    msgs.filter((m) => m.parts.some((p) => p.type === "text" && p.text.includes("[Team message from researcher]") && p.text.includes("auth spec updated"))),
  )
  assert(selfBcast2.length === 0, "Researcher did NOT receive own broadcast")

  // Broadcast skips shutdown members
  await Team.setMemberStatus("full-team", "reviewer", "shutdown")
  await TeamMessaging.broadcast({
    teamName: "full-team",
    from: "lead",
    text: "POST-SHUTDOWN broadcast test marker",
  })
  // Implementer (not shutdown) should receive; reviewer (shutdown) should not
  const implPostShutdown = await Session.messages({ sessionID: teammateSessionIDs.implementer }).then((msgs) =>
    msgs.find((m) => m.parts.some((p) => p.type === "text" && p.text.includes("POST-SHUTDOWN broadcast test marker"))),
  )
  assert(implPostShutdown !== undefined, "Non-shutdown teammate received post-shutdown broadcast")

  // Messaging to shutdown teammate should throw
  await assertThrows(
    () => TeamMessaging.send({ teamName: "full-team", from: "lead", to: "reviewer", text: "hello" }),
    "shut down",
    "Messaging shutdown teammate throws",
  )

  // Restore reviewer status for later tests
  await Team.setMemberStatus("full-team", "reviewer", "ready")
}

async function testTaskCoordination(leadSession: Session.Info) {
  console.log("\n========== 7. Task Coordination ==========")

  const tasksTool = await TeamTasksTool.init()
  const claimTool = await TeamClaimTool.init()

  // List tasks via tool
  const listResult = await tasksTool.execute(
    { action: "list" },
    mockCtx(leadSession.id),
  )
  assert(listResult.metadata.count === 5, "List shows 5 tasks")
  assert(listResult.output.includes("t1"), "List includes t1")

  // Complete t1 (already claimed by researcher)
  await TeamTasks.complete("full-team", "t1")
  let tasks = await TeamTasks.list("full-team")
  assert(tasks.find((t) => t.id === "t1")!.status === "completed", "t1 completed")
  assert(tasks.find((t) => t.id === "t2")!.status === "pending", "t2 unblocked (dep on t1)")
  assert(tasks.find((t) => t.id === "t4")!.status === "pending", "t4 unblocked (dep on t1)")
  assert(tasks.find((t) => t.id === "t3")!.status === "blocked", "t3 still blocked (dep on t2)")
  assert(tasks.find((t) => t.id === "t5")!.status === "blocked", "t5 still blocked (dep on t2, t4)")

  // Concurrent claim race — two members try to claim t2
  const team = await Team.get("full-team")
  const reviewerSid = team!.members.find((m) => m.name === "reviewer")!.sessionID
  const implSid = team!.members.find((m) => m.name === "implementer")!.sessionID

  const [claim1, claim2] = await Promise.all([
    TeamTasks.claim("full-team", "t2", "reviewer"),
    TeamTasks.claim("full-team", "t2", "implementer"),
  ])
  const winners = [claim1, claim2].filter(Boolean).length
  assert(winners === 1, `Concurrent claim: exactly 1 winner (got ${winners})`)

  tasks = await TeamTasks.list("full-team")
  const t2 = tasks.find((t) => t.id === "t2")!
  assert(t2.status === "in_progress", "t2 in_progress after claim")
  assert(t2.assignee === "reviewer" || t2.assignee === "implementer", `t2 assigned to winner: ${t2.assignee}`)

  // Cannot claim already-taken task via tool
  const loserSid = t2.assignee === "reviewer" ? implSid : reviewerSid
  const loserName = t2.assignee === "reviewer" ? "implementer" : "reviewer"
  const doubleClaimResult = await claimTool.execute(
    { task_id: "t2" },
    mockCtx(loserSid),
  )
  assert(doubleClaimResult.title === "Claim failed", "Double claim via tool fails")

  // Cannot claim blocked task
  const blockedClaimResult = await claimTool.execute(
    { task_id: "t3" },
    mockCtx(loserSid),
  )
  assert(blockedClaimResult.title === "Claim failed", "Blocked task claim fails")

  // Claim t4 (now pending)
  const t4Claim = await TeamTasks.claim("full-team", "t4", loserName)
  assert(t4Claim === true, `${loserName} claimed t4`)

  // Complete t2 and t4 — should unblock t5 (diamond pattern: t5 depends on t2 AND t4)
  await TeamTasks.complete("full-team", "t2")
  tasks = await TeamTasks.list("full-team")
  assert(tasks.find((t) => t.id === "t3")!.status === "pending", "t3 unblocked after t2 done")
  assert(tasks.find((t) => t.id === "t5")!.status === "blocked", "t5 still blocked (t4 not done)")

  await TeamTasks.complete("full-team", "t4")
  tasks = await TeamTasks.list("full-team")
  assert(tasks.find((t) => t.id === "t5")!.status === "pending", "t5 unblocked after t2+t4 done (diamond)")

  // Add more tasks via tool
  const addResult = await tasksTool.execute(
    {
      action: "add",
      tasks: [
        { id: "t6", content: "Documentation", status: "pending", priority: "low" },
        { id: "t7", content: "Deploy", status: "pending", priority: "high", depends_on: ["t5", "t6"] },
      ],
    },
    mockCtx(leadSession.id),
  )
  assert(addResult.title.includes("Added 2"), "Added 2 new tasks")
  tasks = await TeamTasks.list("full-team")
  assert(tasks.length === 7, "Now 7 tasks total")
  assert(tasks.find((t) => t.id === "t7")!.status === "blocked", "t7 blocked (deps on t5, t6)")

  // Complete task via tool
  const completeResult = await tasksTool.execute(
    { action: "complete", task_id: "t3" },
    mockCtx(leadSession.id),
  )
  assert(completeResult.title.includes("Completed"), "Complete via tool works")

  // Update (replace) task list via tool
  const updateResult = await tasksTool.execute(
    {
      action: "update",
      tasks: [
        { id: "t5", content: "Integration testing (updated)", status: "pending", priority: "high" },
        { id: "t6", content: "Documentation (updated)", status: "completed", priority: "low" },
      ],
    },
    mockCtx(leadSession.id),
  )
  assert(updateResult.title === "Task list updated", "Update replaces full list")
  tasks = await TeamTasks.list("full-team")
  assert(tasks.length === 2, "Task list replaced with 2 items")

  // Restore original tasks for later tests
  await TeamTasks.update("full-team", [
    { id: "t1", content: "Research", status: "completed", priority: "high" },
    { id: "t2", content: "Implement", status: "completed", priority: "high" },
    { id: "t3", content: "Tests", status: "completed", priority: "medium" },
    { id: "t4", content: "Review", status: "completed", priority: "high" },
    { id: "t5", content: "Integration", status: "pending", priority: "low" },
  ])
}

async function testBusEvents(leadSession: Session.Info) {
  console.log("\n========== 8. Bus Events ==========")

  const events: string[] = []
  const unsubs = [
    Bus.subscribe(TeamEvent.Created, () => events.push("created")),
    Bus.subscribe(TeamEvent.MemberSpawned, () => events.push("spawned")),
    Bus.subscribe(TeamEvent.MemberStatusChanged, () => events.push("status_changed")),
    Bus.subscribe(TeamEvent.TaskUpdated, () => events.push("task_updated")),
    Bus.subscribe(TeamEvent.TaskClaimed, () => events.push("task_claimed")),
    Bus.subscribe(TeamEvent.Message, () => events.push("message")),
    Bus.subscribe(TeamEvent.Broadcast, () => events.push("broadcast")),
    Bus.subscribe(TeamEvent.Cleaned, () => events.push("cleaned")),
  ]

  // Trigger events
  const evtSession = await Session.create({ parentID: leadSession.id })
  await seedUserMessage(evtSession.id)
  await Team.addMember("full-team", { name: "evt-worker", sessionID: evtSession.id, agent: "general", status: "busy" })
  await new Promise((r) => setTimeout(r, 50))
  assert(events.includes("spawned"), "MemberSpawned event fired")

  await Team.setMemberStatus("full-team", "evt-worker", "ready")
  await new Promise((r) => setTimeout(r, 50))
  assert(events.includes("status_changed"), "MemberStatusChanged event fired")

  await TeamTasks.add("full-team", [{ id: "evt-task", content: "event test", status: "pending", priority: "low" }])
  await new Promise((r) => setTimeout(r, 50))
  assert(events.includes("task_updated"), "TaskUpdated event fired")

  await TeamTasks.claim("full-team", "evt-task", "evt-worker")
  await new Promise((r) => setTimeout(r, 50))
  assert(events.includes("task_claimed"), "TaskClaimed event fired")

  await TeamMessaging.send({ teamName: "full-team", from: "evt-worker", to: "lead", text: "event test" })
  await new Promise((r) => setTimeout(r, 50))
  assert(events.includes("message"), "Message event fired")

  await TeamMessaging.broadcast({ teamName: "full-team", from: "lead", text: "event broadcast test" })
  await new Promise((r) => setTimeout(r, 50))
  assert(events.includes("broadcast"), "Broadcast event fired")

  for (const unsub of unsubs) unsub()

  // Cleanup evt-worker
  await Team.setMemberStatus("full-team", "evt-worker", "shutdown")
  await Team.removeMember("full-team", "evt-worker")
}

async function testShutdownAndCleanup(leadSession: Session.Info) {
  console.log("\n========== 9. Shutdown and Cleanup ==========")

  const shutdownTool = await TeamShutdownTool.init()
  const cleanupTool = await TeamCleanupTool.init()

  // Verify current members
  let team = await Team.get("full-team")
  const activeMembers = team!.members.filter((m) => m.status !== "shutdown")
  console.log(`  Active/idle members: ${activeMembers.map((m) => `${m.name}(${m.status})`).join(", ")}`)

  // Shutdown each teammate via tool
  for (const member of activeMembers) {
    const result = await shutdownTool.execute(
      { name: member.name },
      mockCtx(leadSession.id),
    )
    assert(result.title.includes("Shutdown"), `Shutdown sent to ${member.name}`)
  }

  // Verify all shutdown
  team = await Team.get("full-team")
  const stillActive = team!.members.filter((m) => m.status !== "shutdown" && m.status !== "ready")
  assert(stillActive.length === 0, "All members shutdown or idle")

  // Set all to shutdown for cleanup
  for (const member of team!.members) {
    if (member.status !== "shutdown") {
      await Team.setMemberStatus("full-team", member.name, "shutdown")
    }
  }

  // Shutdown tool on already-shutdown member
  const alreadyShutResult = await shutdownTool.execute(
    { name: team!.members[0].name },
    mockCtx(leadSession.id),
  )
  assert(alreadyShutResult.title === "Already shutdown", "Already shutdown member handled")

  // Shutdown tool on non-existent member
  const ghostResult = await shutdownTool.execute(
    { name: "ghost-member" },
    mockCtx(leadSession.id),
  )
  assert(ghostResult.title === "Error", "Non-existent member shutdown fails")

  // Cleanup
  const cleanupResult = await cleanupTool.execute(
    { name: "full-team" },
    mockCtx(leadSession.id),
  )
  assert(cleanupResult.title.includes("cleaned up"), "Team cleaned up successfully")

  // Verify gone
  team = await Team.get("full-team")
  assert(team === undefined, "Team no longer exists on disk")

  // Cleanup non-existent team
  const cleanupGhostResult = await cleanupTool.execute(
    { name: "ghost-team" },
    mockCtx(leadSession.id),
  )
  assert(cleanupGhostResult.title === "Cleanup failed", "Cleanup non-existent team fails gracefully")
}

async function testToolValidation() {
  console.log("\n========== 10. Tool Definition Validation ==========")

  const tools = [
    { name: "team_create", tool: TeamCreateTool },
    { name: "team_spawn", tool: TeamSpawnTool },
    { name: "team_message", tool: TeamMessageTool },
    { name: "team_broadcast", tool: TeamBroadcastTool },
    { name: "team_tasks", tool: TeamTasksTool },
    { name: "team_claim", tool: TeamClaimTool },
    { name: "team_shutdown", tool: TeamShutdownTool },
    { name: "team_cleanup", tool: TeamCleanupTool },
  ]

  for (const { name, tool } of tools) {
    assert(tool.id === name, `${name} has correct ID`)
    const init = await tool.init()
    assert(typeof init.description === "string" && init.description.length > 10, `${name} has description`)
    assert(init.parameters !== undefined, `${name} has parameters schema`)
    assert(typeof init.execute === "function", `${name} has execute function`)
  }
}

// ---------- Main ----------
async function main() {
  console.log("\n" + "=".repeat(60))
  console.log("  Agent Teams Comprehensive Integration Test")
  console.log("  Real Anthropic API via Claude Max Auth Plugin")
  console.log("=".repeat(60))

  const tmpDir = await createTmpDir()
  console.log(`\nWorking directory: ${tmpDir}`)

  try {
    await Instance.provide({
      directory: tmpDir,
      init: async () => {
        await Plugin.init()
      },
      fn: async () => {
        // Create lead session
        const leadSession = await Session.create({})
        console.log(`Lead session: ${leadSession.id}`)

        // Run all test sections in order
        await testTeamCreation(leadSession)
        await testConstraintEnforcement(leadSession)
        const researcherSessionID = await testTeamSpawnWithRealLoop(leadSession)
        const { reviewerSessionID, implementerSessionID } = await testMultipleTeammatesConcurrent(leadSession)

        const teammateSessionIDs = {
          researcher: researcherSessionID,
          reviewer: reviewerSessionID,
          implementer: implementerSessionID,
        }

        await testMessaging(leadSession, teammateSessionIDs)
        await testBroadcast(leadSession, teammateSessionIDs)
        await testTaskCoordination(leadSession)
        await testBusEvents(leadSession)
        await testShutdownAndCleanup(leadSession)
        await testToolValidation()
      },
    })
  } catch (err: any) {
    console.error(`\nFATAL ERROR: ${err.message}`)
    console.error(err.stack)
    failed++
    errors.push(`Fatal: ${err.message}`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }

  // ---------- Summary ----------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log("\n" + "=".repeat(60))
  console.log(`  Results: ${passed} passed, ${failed} failed (${elapsed}s)`)
  if (errors.length) {
    console.log("\n  Failures:")
    for (const e of errors) {
      console.log(`    - ${e}`)
    }
  }
  console.log("=".repeat(60) + "\n")

  process.exit(failed > 0 ? 1 : 0)
}

main()
