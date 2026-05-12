/**
 * Standalone runtime test for the Agent Teams feature.
 * Exercises the core team/team.ts logic using real filesystem operations
 * to prove create → addTask → claimTask → completeTask → messaging all work.
 *
 * Run: bun run test/team/team.test.ts
 */
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Effect } from "effect"
import * as Team from "@/team/team"

const tmpDir = path.join(os.tmpdir(), `opencode-team-test-${Date.now()}`)
await fs.mkdir(tmpDir, { recursive: true })

// Minimal fs interface that satisfies what team.ts functions need
const testFs = {
  ensureDir: (dir: string) => Effect.promise(() => fs.mkdir(dir, { recursive: true })),
  writeFileString: (filePath: string, content: string) =>
    Effect.promise(() => fs.writeFile(filePath, content, "utf-8")),
  existsSafe: (filePath: string) =>
    Effect.promise(async () => {
      try {
        await fs.access(filePath)
        return true
      } catch {
        return false
      }
    }),
  readFileStringSafe: (filePath: string) =>
    Effect.promise(async () => {
      try {
        return await fs.readFile(filePath, "utf-8")
      } catch {
        return undefined
      }
    }),
  readDirectoryEntries: (dir: string) =>
    Effect.promise(async () => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? ("directory" as const) : ("file" as const) }))
    }),
}

console.log("=== Agent Teams Runtime Test ===\n")

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

// --- Test 1: Create a team ---
console.log("1. Creating a team...")
const team = await Effect.runPromise(
  Team.createTeam(testFs as any, tmpDir, { leadSessionID: "session-lead-001" }),
)
assert(!!team.id, `Team created with id: ${team.id}`)
assert(team.lead === "session-lead-001", `Lead is session-lead-001`)
assert(team.teammates.length === 0, `No teammates yet`)

// Verify files on disk
const teamJsonPath = path.join(tmpDir, ".opencode", "teams", team.id, "team.json")
let teamJsonExists = false
try {
  await fs.access(teamJsonPath)
  teamJsonExists = true
} catch {}
assert(teamJsonExists, `team.json written to disk`)

// --- Test 2: Add tasks ---
console.log("\n2. Adding tasks...")
const task1 = await Effect.runPromise(
  Team.addTask(testFs as any, tmpDir, { teamID: team.id, description: "Build the API routes" }),
)
const task2 = await Effect.runPromise(
  Team.addTask(testFs as any, tmpDir, { teamID: team.id, description: "Design the database schema" }),
)
const task3 = await Effect.runPromise(
  Team.addTask(testFs as any, tmpDir, { teamID: team.id, description: "Write unit tests" }),
)
assert(task1.status === "pending", `Task 1 created: "${task1.description}"`)
assert(task2.status === "pending", `Task 2 created: "${task2.description}"`)
assert(task3.status === "pending", `Task 3 created: "${task3.description}"`)

// --- Test 3: List tasks ---
console.log("\n3. Listing tasks...")
const allTasks = await Effect.runPromise(
  Team.listTasks(testFs as any, tmpDir, team.id),
)
assert(allTasks.length === 3, `Listed ${allTasks.length} tasks (expected 3)`)

// --- Test 4: Add teammate ---
console.log("\n4. Adding a teammate...")
const updatedTeam = await Effect.runPromise(
  Team.addTeammate(testFs as any, tmpDir, { teamID: team.id, sessionID: "session-teammate-002" }),
)
assert(updatedTeam.teammates.includes("session-teammate-002"), `Teammate added`)

// --- Test 5: Claim a task ---
console.log("\n5. Claiming a task...")
const claimedTask = await Effect.runPromise(
  Team.claimTask(testFs as any, tmpDir, {
    teamID: team.id,
    taskID: task1.id,
    sessionID: "session-teammate-002",
  }),
)
assert(claimedTask.status === "claimed", `Task status → claimed`)
assert(claimedTask.assignee === "session-teammate-002", `Assignee set correctly`)

// --- Test 6: Prevent double-claiming ---
console.log("\n6. Preventing double-claim...")
let doubleClaimed = false
try {
  await Effect.runPromise(
    Team.claimTask(testFs as any, tmpDir, {
      teamID: team.id,
      taskID: task1.id,
      sessionID: "session-teammate-003",
    }),
  )
  doubleClaimed = true
} catch (err: any) {
  assert(true, `Double-claim correctly rejected`)
}
if (doubleClaimed) {
  assert(false, `Double-claim should have been rejected!`)
}

// --- Test 7: Complete a task ---
console.log("\n7. Completing a task...")
const completedTask = await Effect.runPromise(
  Team.completeTask(testFs as any, tmpDir, {
    teamID: team.id,
    taskID: task1.id,
    result: "API routes created: GET /users, POST /users, DELETE /users/:id",
  }),
)
assert(completedTask.status === "done", `Task status → done`)
assert(completedTask.result!.includes("API routes"), `Result recorded`)

// --- Test 8: Send messages ---
console.log("\n8. Sending messages...")
const msg1 = await Effect.runPromise(
  Team.sendMessage(testFs as any, tmpDir, {
    teamID: team.id,
    from: "session-teammate-002",
    to: "session-lead-001",
    content: "I finished the API routes.",
  }),
)
assert(!!msg1.id, `Direct message sent: ${msg1.id}`)

const msg2 = await Effect.runPromise(
  Team.sendMessage(testFs as any, tmpDir, {
    teamID: team.id,
    from: "session-lead-001",
    to: "*",
    content: "Great work everyone!",
  }),
)
assert(msg2.to === "*", `Broadcast message sent`)

// --- Test 9: Read messages ---
console.log("\n9. Reading messages...")
const leadMessages = await Effect.runPromise(
  Team.readMessages(testFs as any, tmpDir, {
    teamID: team.id,
    sessionID: "session-lead-001",
  }),
)
assert(leadMessages.length >= 1, `Lead received ${leadMessages.length} message(s)`)
assert(
  leadMessages.some((m) => m.content.includes("finished the API routes")),
  `Lead received the direct message`,
)

const teammateMessages = await Effect.runPromise(
  Team.readMessages(testFs as any, tmpDir, {
    teamID: team.id,
    sessionID: "session-teammate-002",
  }),
)
assert(
  teammateMessages.some((m) => m.content.includes("Great work")),
  `Teammate received the broadcast`,
)

// --- Test 10: Final status ---
console.log("\n10. Final task status...")
const finalTasks = await Effect.runPromise(
  Team.listTasks(testFs as any, tmpDir, team.id),
)
const pendingCount = finalTasks.filter((t) => t.status === "pending").length
const doneCount = finalTasks.filter((t) => t.status === "done").length
assert(pendingCount === 2, `2 tasks still pending`)
assert(doneCount === 1, `1 task completed`)

// --- Test 11: Get team info ---
console.log("\n11. Getting team info...")
const teamInfo = await Effect.runPromise(
  Team.getTeam(testFs as any, tmpDir, team.id),
)
assert(teamInfo!.id === team.id, `Team info retrieved`)
assert(teamInfo!.teammates.length === 1, `1 teammate registered`)

// Non-existent team returns undefined
const noTeam = await Effect.runPromise(
  Team.getTeam(testFs as any, tmpDir, "team_nonexistent"),
)
assert(noTeam === undefined, `Non-existent team returns undefined`)

// --- Cleanup ---
await fs.rm(tmpDir, { recursive: true, force: true })

// --- Summary ---
console.log(`\n${"=".repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log(`${"=".repeat(40)}`)

if (failed > 0) {
  process.exit(1)
}
